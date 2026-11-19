import { LOBBY, USER_AUTHOR, type Post } from "../shared/contracts.js";
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
  log(message: string): void;
}

// A session opened before a plugin reload may still have the previous tool registration.
export function completionLine(claim: Post): string {
  return `Completed office task ${claim.id} (assignment ${claim.seq}).`;
}

function unassigned(task: Post): boolean {
  return task.kind === "task" && task.state === "open" && !task.to && !task.claimedBy;
}

export function createLobbyPickup(ports: PickupPorts): LobbyPickup {
  const { service, agents, queue, clock } = ports;
  let stopped = false;
  let scanning: Promise<void> | null = null;
  let cancel: (() => void) | undefined;

  const active = () => !stopped && ports.enabled();

  function hasWork(): boolean {
    return (
      active() &&
      service.postsOf(LOBBY).some((task) => unassigned(task) || Boolean(task.pickupMessageId))
    );
  }

  function currentClaim(claim: Post): boolean {
    return service
      .postsOf(LOBBY)
      .some(
        (post) =>
          post.id === claim.id &&
          post.seq === claim.seq &&
          post.pickupMessageId === claim.pickupMessageId,
      );
  }

  async function dispatch(task: Post, agentId: string, available: () => boolean): Promise<boolean> {
    const recovering = Boolean(task.pickupMessageId);
    const claim = recovering ? task : await service.claimLobbyTask(task.id, agentId, task.seq);
    if (!claim?.pickupMessageId) return false;
    // Check again after saving the claim. Never reassign an earlier send whose receipt was lost.
    if (!(await agents.lobbyEligible(agentId)) || !active() || !available()) {
      if (!recovering) await service.releaseLobbyTask(claim);
      return false;
    }
    if (!currentClaim(claim)) return false;
    const source = task.author === USER_AUTHOR ? null : task.author;
    const author = source === null ? "the user" : `agent ${oneLine(source)}`;
    const prompt = [
      `The office assigned you lobby task ${task.id} from ${author}.`,
      `  ${indented(task.text)}`,
      `Work on this task. When it is complete, use office_update with id "${task.id}" and action "done". If you need input, leave it claimed and explain what you need.`,
      `If the tool is unavailable and you have finished, put this exact line at the end of your reply: ${completionLine(claim)}`,
    ].join("\n");
    // The daemon deduplicates this ID even after a network failure or a plugin restart.
    await agents.send(agentId, prompt, source, claim.pickupMessageId);
    await service.confirmLobbyDelivery(claim);
    return true;
  }

  function nextFor(agentId: string): Post | undefined {
    const board = service.postsOf(LOBBY);
    const existing = board.find((p) => p.state === "claimed" && p.claimedBy === agentId);
    if (existing) return existing.pickupMessageId ? existing : undefined;
    return board
      .filter((p) => unassigned(p) && p.author !== agentId)
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || Number(a.id.slice(1)) - Number(b.id.slice(1)),
      )[0];
  }

  async function scan(): Promise<void> {
    for (const agentId of await agents.lobbyCandidates()) {
      if (!hasWork()) break;
      const next = nextFor(agentId);
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
