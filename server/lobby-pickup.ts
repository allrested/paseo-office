import { waitingOn } from "../shared/board-rules.js";
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
/** One waited-on task's result in an assignment: five of them never make a huge prompt. */
export const WAITED_RESULT_MAX = 600;

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

/** `posts` are every board's: a task waits while a task of its `after`, on any board, is not done. */
function awaitingPickup(task: Post, posts: readonly Post[]): boolean {
  return (
    task.kind === "task" &&
    task.state === "open" &&
    (!task.to || !!task.namedPickup) &&
    !task.claimedBy &&
    waitingOn(task, posts).length === 0
  );
}

/**
 * The results of the tasks an assignment's task waited on, as lines of its indented body; a task
 * that is gone is left out, and with none left there are no lines.
 */
function waitedOnLines(task: Post, posts: readonly Post[]): string[] {
  const waited = (task.after ?? []).flatMap((id) => {
    const done = posts.find((item) => item.id === id && item.kind === "task");
    if (done === undefined) return [];
    const result = done.result ?? "no result given";
    const cut =
      result.length > WAITED_RESULT_MAX ? `${result.slice(0, WAITED_RESULT_MAX - 1)}…` : result;
    // Further lines sit under their entry, so none reads as another task's.
    return [`  ${id}: ${indented(indented(cut))}`];
  });
  return waited.length === 0 ? [] : ["  It waited on:", ...waited];
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
  // A refresh during a scan, from a change the scan did not make itself: scan again when it ends.
  let rescan = false;
  // While above zero the scan is in its own board call, whose save announces its own change.
  let own = 0;

  async function mine<T>(work: () => Promise<T>): Promise<T> {
    own += 1;
    try {
      return await work();
    } finally {
      own -= 1;
    }
  }

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

  /** Every board's posts, which say whether a task still waits. */
  const allPosts = () => Object.values(service.boards()).flat();

  function hasWork(): boolean {
    if (!active()) return false;
    const posts = allPosts();
    return pickupPosts().some(
      (task) => canDispatch(task) && (awaitingPickup(task, posts) || Boolean(task.pickupMessageId)),
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
    const claim = recovering
      ? task
      : await mine(() => service.claimLobbyTask(task.id, agentId, task.seq));
    if (!claim?.pickupMessageId) return false;
    // Check again after saving the claim. Never reassign an earlier send whose receipt was lost.
    if (!(await eligible()) || !canDispatch(task) || !active() || !available()) {
      if (!recovering) await mine(() => service.releaseLobbyTask(claim));
      return false;
    }
    if (!currentClaim(claim)) return false;
    const source = task.author === USER_AUTHOR ? null : task.author;
    const prompt = [
      assignmentHeading(task),
      `  ${indented(task.text)}`,
      ...waitedOnLines(task, allPosts()),
      assignmentFooter(claim),
    ].join("\n");
    // The daemon deduplicates this ID even after a network failure or a plugin restart.
    await agents.send(agentId, prompt, source, claim.pickupMessageId);
    await mine(() => service.confirmLobbyDelivery(claim));
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
    const posts = allPosts();
    const existing = board.find((p) => p.state === "claimed" && p.claimedBy === agentId);
    if (existing) return existing.pickupMessageId && canDispatch(existing) ? existing : undefined;
    return board
      .filter(
        (p) =>
          awaitingPickup(p, posts) &&
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
    const posts = allPosts();
    const named = service
      .postsOf(LOBBY)
      .flatMap((p) =>
        p.namedPickup && p.to && (awaitingPickup(p, posts) || p.pickupMessageId) ? [p.to] : [],
      );
    const automatic = new Set(ports.enabled() ? await agents.lobbyCandidates() : []);
    for (const agentId of new Set([...named, ...automatic])) {
      if (!hasWork()) break;
      const current = allPosts();
      const teamWork = pickupPosts().some(
        (p) => p.team !== undefined && awaitingPickup(p, current),
      );
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
          const again = rescan;
          rescan = false;
          schedule(again ? 0 : LOBBY_RETRY_MS);
        });
    }, delay);
  }

  return {
    refresh() {
      if (scanning && own === 0) rescan = true;
      schedule(0);
    },
    async stop() {
      stopped = true;
      cancel?.();
      await scanning;
    },
  };
}
