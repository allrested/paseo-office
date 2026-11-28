import { DUTY, LOBBY, USER_AUTHOR, type Post } from "../shared/contracts.js";
import { assignmentFooter } from "../shared/lobby-assignment.js";
import type { BoardService } from "./board-service.js";
import { errorMessage } from "./errors.js";
import type { MentionQueue } from "./mention-queue.js";
import type { OfficeAgentPorts } from "./office.js";
import { indented, oneLine } from "./prompt-text.js";
import type { Clock } from "./timers.js";

// Some transitions to idle (e.g. clearing a permission) don't produce a turn-end hook.
export const LOBBY_RETRY_MS = 30_000;

export interface LobbyPickup {
  refresh(): void;
  stop(): Promise<void>;
}

interface PickupPorts {
  service: BoardService;
  agents: OfficeAgentPorts;
  queue: MentionQueue;
  clock: Clock;
  enabled(): boolean;
  /** A duty post that is handed out: one with instructions. A pretend duty is acted out in 3D. */
  instructed(post: Post): boolean;
  log(message: string): void;
}

function awaitingPickup(task: Post): boolean {
  return (
    task.kind === "task" &&
    task.state === "open" &&
    (!task.to || !!task.namedPickup) &&
    !task.claimedBy
  );
}

/** The first line of an assignment: whose task it is, or the duty board's. */
function assignmentHeading(task: Post): string {
  if (task.board === DUTY) return `The office assigned you duty ${task.id} from the duty board.`;
  const author = task.author === USER_AUTHOR ? "the user" : `agent ${oneLine(task.author)}`;
  return `The office assigned you lobby task ${task.id} from ${author}.`;
}

export function createLobbyPickup(ports: PickupPorts): LobbyPickup {
  const { service, agents, queue, clock } = ports;
  let stopped = false;
  let scanning: Promise<void> | null = null;
  let cancel: (() => void) | undefined;

  const active = () => !stopped && !service.wakesPaused();
  const canDispatch = (task: Post) => Boolean(task.namedPickup) || ports.enabled();

  /**
   * The lobby's tasks and the duties handed out: what the office hands to idle agents. A duty
   * already claimed, or with a delivery under way, stays even once it has lost its instructions,
   * so its delivery is recovered and its agent is not left holding it unseen.
   */
  function pickupPosts(): Post[] {
    const handedOut = (post: Post) =>
      ports.instructed(post) || post.state === "claimed" || Boolean(post.pickupMessageId);
    return [...service.postsOf(LOBBY), ...service.postsOf(DUTY).filter(handedOut)];
  }

  function hasWork(): boolean {
    return (
      active() &&
      pickupPosts().some(
        (task) => canDispatch(task) && (awaitingPickup(task) || Boolean(task.pickupMessageId)),
      )
    );
  }

  function currentClaim(claim: Post): boolean {
    return pickupPosts().some(
      (post) =>
        post.id === claim.id &&
        post.seq === claim.seq &&
        post.pickupMessageId === claim.pickupMessageId,
    );
  }

  async function dispatch(task: Post, agentId: string, available: () => boolean): Promise<boolean> {
    const eligible = () =>
      task.namedPickup
        ? agents.status(agentId).then((status) => status === "wakeable")
        : agents.lobbyEligible(agentId);
    if (task.namedPickup && !(await eligible())) return false;
    const recovering = Boolean(task.pickupMessageId);
    const claim = recovering ? task : await service.claimLobbyTask(task.id, agentId, task.seq);
    if (!claim?.pickupMessageId) return false;
    // Check again after saving the claim. Never reassign an earlier send whose receipt was lost.
    if (!(await eligible()) || !canDispatch(task) || !active() || !available()) {
      if (!recovering) await service.releaseLobbyTask(claim);
      return false;
    }
    if (!currentClaim(claim)) return false;
    const source = task.author === USER_AUTHOR ? null : task.author;
    const prompt = [
      assignmentHeading(task),
      `  ${indented(task.text)}`,
      assignmentFooter(claim),
    ].join("\n");
    // The daemon deduplicates this ID even after a network failure or a plugin restart.
    await agents.send(agentId, prompt, source, claim.pickupMessageId);
    await service.confirmLobbyDelivery(claim);
    return true;
  }

  /** A task for a team still on the roster goes to that team's agents; else it is anyone's. */
  const forTeam = (task: Post, team: string | null) =>
    task.team === undefined || agents.teamName(task.team) === null || task.team === team;

  /** The roster team of the agent's teammate; a failed lookup is logged and counts as none. */
  async function teamOf(agentId: string): Promise<string | null> {
    try {
      return await agents.teamOf(agentId);
    } catch (error) {
      ports.log(`[office] no team for ${agentId}: ${errorMessage(error)}`);
      return null;
    }
  }

  /** `team` is the agent's roster team, read once per scan: a team's task waits for its own. */
  function nextFor(agentId: string, automatic: boolean, team: string | null): Post | undefined {
    const board = pickupPosts();
    const existing = board.find((p) => p.state === "claimed" && p.claimedBy === agentId);
    if (existing) return existing.pickupMessageId && canDispatch(existing) ? existing : undefined;
    return board
      .filter(
        (p) =>
          awaitingPickup(p) &&
          p.author !== agentId &&
          (p.to ? p.to === agentId : automatic && forTeam(p, team)),
      )
      .sort(
        (a, b) =>
          Number(Boolean(b.to)) - Number(Boolean(a.to)) ||
          a.createdAt.localeCompare(b.createdAt) ||
          Number(a.id.slice(1)) - Number(b.id.slice(1)),
      )[0];
  }

  async function scan(): Promise<void> {
    const named = service
      .postsOf(LOBBY)
      .flatMap((p) =>
        p.namedPickup && p.to && (awaitingPickup(p) || p.pickupMessageId) ? [p.to] : [],
      );
    const automatic = new Set(ports.enabled() ? await agents.lobbyCandidates() : []);
    for (const agentId of new Set([...named, ...automatic])) {
      if (!hasWork()) break;
      const teamWork = pickupPosts().some((p) => p.team !== undefined && awaitingPickup(p));
      const team = automatic.has(agentId) && teamWork ? await teamOf(agentId) : null;
      const next = nextFor(agentId, automatic.has(agentId), team);
      if (!next) continue;
      try {
        await queue.tryPickup(agentId, (available) => dispatch(next, agentId, available));
      } catch (error) {
        ports.log(`[office] lobby pickup for ${agentId} failed: ${errorMessage(error)}`);
      }
    }
  }

  function schedule(delay: number): void {
    cancel?.();
    cancel = undefined;
    if (scanning || !hasWork()) return;
    cancel = clock.setTimeout(() => {
      cancel = undefined;
      scanning = scan()
        .catch((error: unknown) =>
          ports.log(`[office] lobby pickup failed: ${errorMessage(error)}`),
        )
        .finally(() => {
          scanning = null;
          schedule(LOBBY_RETRY_MS);
        });
    }, delay);
  }

  return {
    refresh: () => schedule(0),
    async stop() {
      stopped = true;
      cancel?.();
      await scanning;
    },
  };
}
