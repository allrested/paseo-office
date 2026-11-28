import type { AgentToolDefinition } from "@getpaseo/plugin/server";
import {
  DUTY,
  LOBBY,
  POST_TEXT_MAX,
  USER_AUTHOR,
  type AgentStatus,
  type DeleteResult,
  type Duty,
  type Post,
  type PostKind,
  type PostResult,
  type UpdateAction,
  type WakeState,
} from "../shared/contracts.js";
import { officeTools, type ToolAgent } from "./agent-tools.js";
import { createBoardService, type DutySync, type PostUpdate } from "./board-service.js";
import type { BoardStore } from "./board-store.js";
import { errorMessage } from "./errors.js";
import type { Hub } from "./hub.js";
import { createMentionQueue, type MentionQueue, type WakeTarget } from "./mention-queue.js";
import { waitingOn } from "../shared/board-rules.js";
import { completionLine } from "../shared/lobby-assignment.js";
import { createLobbyPickup, type LobbyPickup } from "./lobby-pickup.js";
import { oneLine } from "./prompt-text.js";
import type { Clock } from "./timers.js";

export const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

const PRETEND = "it is a pretend duty, which the 3D office acts out";

export interface OfficeAgentPorts {
  lobbyCandidates(): Promise<string[]>;
  lobbyEligible(agentId: string): Promise<boolean>;
  status(agentId: string): Promise<WakeTarget>;
  /** The full id of the agent that `agentId` names or starts, or null when it can get no post. */
  resolve(agentId: string): Promise<string | null>;
  /** The agent's workspace id, or null when it has none. */
  workspaceOf(agentId: string): Promise<string | null>;
  /** `source` is the agent whose posts the prompt carries, or null for a prompt as from the user. */
  send(agentId: string, prompt: string, source: string | null, messageId?: string): Promise<void>;
  /** The roster team, by id, of the teammate the agent holds; null with the roster off or none held. */
  teamOf(agentId: string): Promise<string | null>;
  /** The id of the roster team an id or a name (any case) names; null for none or the roster off. */
  findTeam(nameOrId: string): Promise<string | null>;
  /** A roster team's name by its id; null once it is gone or the roster is off. */
  teamName(teamId: string): string | null;
  /** What the agent's turns have cost so far, as the directory last had it; undefined when unknown. */
  costOf(agentId: string): number | undefined;
  /** Whether the agent is in a turn now, as the directory last had it; false when unknown. */
  working(agentId: string): boolean;
}

export type OfficeHub = Pick<Hub, "setBoards" | "setBoard" | "removeBoard" | "setWake">;

export interface OfficeDeps {
  store: BoardStore;
  clock: Clock;
  hub: OfficeHub;
  agents: OfficeAgentPorts;
  log(message: string): void;
}

export interface Office {
  /** Settles once boards.json is loaded; never rejects (a failure is logged). */
  ready: Promise<void>;
  lobbyPosts(): readonly Post[] | null;
  tools: AgentToolDefinition[];
  noteAgent(agent: ToolAgent): void;
  post(input: {
    board: string;
    kind: PostKind;
    text: string;
    to?: string;
    replyTo?: string;
    team?: string;
    after?: string[];
  }): Promise<PostResult>;
  update(input: { id: string; action: UpdateAction; note?: string }): Promise<PostResult>;
  remove(id: string): Promise<DeleteResult>;
  clearDone(board: string): Promise<DeleteResult>;
  setWakesPaused(paused: boolean): Promise<WakeState>;
  setPickupEnabled(enabled: boolean): void;
  /** The duty list: a duty with instructions is handed out, one without is pretend. */
  setDuties(duties: readonly Duty[]): void;
  /** Brings the duty board up to the list and the day (see BoardService.syncDuties). */
  syncDuties(plan: DutySync): Promise<void>;
  /** The 3D office acted out a pretend duty with this agent's figure. */
  actDuty(id: string, agentId: string): Promise<PostResult>;
  turnEnded(agentId: string): void;
  checkCompletion(agentId: string, lastAnswer: () => Promise<string | null>): Promise<void>;
  /**
   * From the close and the archive hooks. A closed session is at home and a reply wakes it, so it
   * keeps its claims; only an archived one has them released.
   */
  agentGone(agentId: string, how: "closed" | "archived"): void;
  /**
   * The directory's view: each agent's status. An agent holding done tasks whose cost waits for
   * its turn to end, and no longer in one, has them settled with the view's figure; one gone from
   * the view or closed there has the wait dropped with no figure.
   */
  settleSpentOf(statuses: ReadonlyMap<string, AgentStatus>): Promise<void>;
  workspaceArchived(workspaceId: string): Promise<void>;
  stop(): Promise<void>;
}

/** How a wake prompt names a post's author; the id lets the woken agent answer with `to`. */
export function wakeAuthorLabel(author: string, title: string | undefined): string {
  if (author === USER_AUTHOR) return "the user";
  return title ? `${title} (${author})` : `agent ${author}`;
}

export function createOffice(deps: OfficeDeps): Office {
  const { clock, hub, log } = deps;
  // Filled by the session-open and turn-end hooks and by tool calls. After a daemon restart an
  // agent is named by its bare id until one of those sees it again.
  const titles = new Map<string, string>();
  let queue: MentionQueue | null = null;
  let pickup: LobbyPickup | null = null;
  let pickupEnabled = false;
  let stopped = false;
  let cancelPrune: (() => void) | null = null;
  let duties: readonly Duty[] = [];
  // Tasks that name an agent and still wait on others, by id: each wakes its agent at its release.
  const held = new Set<string>();

  const label = (author: string) =>
    author === USER_AUTHOR ? "the user" : (titles.get(author) ?? author);
  const teamLabel = (teamId: string) => deps.agents.teamName(teamId) ?? teamId;

  /** A duty post whose duty has instructions; a duty that left the list has none. */
  function instructed(post: Post): boolean {
    const duty = duties.find((candidate) => candidate.id === post.duty?.id);
    return post.board === DUTY && duty !== undefined && duty.instructions.trim() !== "";
  }

  /**
   * On the duty board nobody claims a pretend duty: the 3D office acts it out, and the owner ticks
   * it. An agent finishes or reopens only a duty it holds; the owner's hand marks any.
   */
  function refuse(post: Post, input: PostUpdate): string | null {
    if (input.action === "block" && input.actor === USER_AUTHOR)
      return "only the agent holding it blocks it";
    if (post.board !== DUTY) return null;
    const pretend = !instructed(post);
    if (input.action === "claim") return pretend ? PRETEND : null;
    if (input.actor === USER_AUTHOR) return null;
    if (post.state === "claimed" && post.claimedBy === input.actor) return null;
    if (pretend) return PRETEND;
    if (post.state === "done") return "it is done";
    return post.claimedBy === undefined ? "claim it first" : `claimed by ${label(post.claimedBy)}`;
  }

  const service = createBoardService({
    store: deps.store,
    clock,
    log,
    label,
    onBoard: (board, posts) => {
      hub.setBoard(board, posts);
      // Any board: a lobby task can wait on a room's task, and is handed out once that is done. A
      // save the pickup makes while it scans does not start another scan.
      pickup?.refresh();
      wakeReleased();
    },
    onBoardRemoved: (board) => {
      hub.removeBoard(board);
      // The board's tasks are gone, and a task that is gone holds no other.
      wakeReleased();
    },
    workspaceOf: (agentId) => deps.agents.workspaceOf(agentId),
    refuse,
    teamOf: (agentId) => deps.agents.teamOf(agentId),
    findTeam: (nameOrId) => deps.agents.findTeam(nameOrId),
    teamName: (teamId) => deps.agents.teamName(teamId),
    costOf: (agentId) => deps.agents.costOf(agentId),
    working: (agentId) => deps.agents.working(agentId),
  });

  function noteAgent(agent: ToolAgent): void {
    // One line, so a name cannot start a line that reads as another post or another entry.
    const title = oneLine(agent.title ?? "");
    if (title) titles.set(agent.id, title);
  }

  /** Every board's posts: a task waits while a task of its `after`, on any board, is not done. */
  const allPosts = () => Object.values(service.boards()).flat();

  /** A task for an agent whose wake is held: open, nobody's yet, and still waiting on another. */
  function waitsForRelease(post: Post, posts: readonly Post[]): boolean {
    return (
      post.kind === "task" &&
      post.to !== undefined &&
      !post.namedPickup &&
      post.state === "open" &&
      post.claimedBy === undefined &&
      waitingOn(post, posts).length > 0
    );
  }

  function wakeFor(agentId: string, post: Post): void {
    queue?.enqueue(agentId, {
      postId: post.id,
      author: post.author,
      authorLabel: wakeAuthorLabel(post.author, titles.get(post.author)),
      text: post.text,
      ...(post.replyTo === undefined ? {} : { replyTo: post.replyTo }),
    });
  }

  function mentioned(post: Post): void {
    if (post.to === undefined || post.namedPickup || queue === null) return;
    // The agent cannot claim a task that still waits: it is told when nothing holds the task.
    if (waitsForRelease(post, allPosts())) {
      held.add(post.id);
      return;
    }
    wakeFor(post.to, post);
  }

  /**
   * After any board's change: each held task that no longer waits wakes its agent. One that was
   * deleted, claimed or done first is only dropped.
   */
  function wakeReleased(): void {
    if (held.size === 0) return;
    const posts = allPosts();
    for (const id of held) {
      const post = posts.find((item) => item.id === id);
      if (post !== undefined && waitsForRelease(post, posts)) continue;
      held.delete(id);
      const free = post?.state === "open" && post.claimedBy === undefined;
      if (post?.to !== undefined && free) wakeFor(post.to, post);
    }
  }

  function schedulePrune(): void {
    if (stopped) return;
    cancelPrune = clock.setTimeout(() => {
      cancelPrune = null;
      service
        .prune()
        .catch((error: unknown) => log(`[office] prune failed: ${errorMessage(error)}`))
        .finally(schedulePrune);
    }, PRUNE_INTERVAL_MS);
  }

  async function begin(): Promise<void> {
    try {
      await service.start();
      if (stopped) return;
      queue = createMentionQueue(
        {
          clock,
          status: (agentId) => deps.agents.status(agentId),
          send: (agentId, prompt, source) => deps.agents.send(agentId, prompt, source),
          log,
          onChange: (wake) => hub.setWake(wake),
        },
        service.wakesPaused(),
      );
      // What waited when the office stopped still waits: its wake goes out at its release. A task
      // already free was told before, and is not held.
      const loaded = allPosts();
      for (const post of loaded) if (waitsForRelease(post, loaded)) held.add(post.id);
      pickup = createLobbyPickup({
        service,
        agents: deps.agents,
        queue,
        clock,
        enabled: () => pickupEnabled,
        instructed,
        log,
      });
      pickup.refresh();
      hub.setBoards(service.boards());
      hub.setWake(queue.state());
      schedulePrune();
    } catch (error) {
      log(`[office] unable to start the boards: ${errorMessage(error)}`);
    }
  }

  const ready = begin();

  async function requireQueue(): Promise<MentionQueue> {
    await ready;
    if (queue === null) throw new Error("The office boards did not start");
    return queue;
  }

  return {
    ready,
    lobbyPosts: () => (queue === null ? null : service.postsOf("lobby")),
    tools: officeTools({
      service,
      resolveAgent: (id) => deps.agents.resolve(id),
      mentioned,
      seen: noteAgent,
      label,
      teamLabel,
    }),
    noteAgent,
    async post(input) {
      await ready;
      // A reply goes to its task's board, so the duty board takes it though it takes no other post.
      if (input.board === DUTY && input.replyTo === undefined) {
        return {
          ok: false,
          error: "Unable to post: the duty board takes its duties from the duty list",
        };
      }
      const result = await service.post({ ...input, author: USER_AUTHOR });
      if (result.ok) mentioned(result.post);
      return result;
    },
    async update(input) {
      await ready;
      return service.update({ ...input, actor: USER_AUTHOR });
    },
    async remove(id) {
      await ready;
      return service.remove(id);
    },
    async clearDone(board) {
      await ready;
      return service.clearDone(board);
    },
    async setWakesPaused(paused) {
      const wakeQueue = await requireQueue();
      await service.setWakesPaused(paused);
      wakeQueue.setPaused(paused);
      pickup?.refresh();
      return wakeQueue.state();
    },
    setPickupEnabled(enabled) {
      pickupEnabled = enabled;
      pickup?.refresh();
    },
    setDuties(next) {
      duties = [...next];
      pickup?.refresh();
    },
    async syncDuties(plan) {
      await ready;
      await service.syncDuties(plan);
    },
    async actDuty(id, agentId) {
      await ready;
      const post = service.postsOf(DUTY).find((candidate) => candidate.id === id);
      if (post !== undefined && instructed(post)) {
        return { ok: false, error: `Unable to record ${id}: an agent is handed this duty` };
      }
      // The 3D office's word is not taken for who it was: the agent must be one of the office's.
      const agent = await deps.agents.resolve(agentId);
      if (agent === null)
        return { ok: false, error: `Unable to record ${id}: no agent ${agentId}` };
      return service.actDuty(id, agent);
    },
    turnEnded(agentId) {
      queue?.turnEnded(agentId);
      pickup?.refresh();
    },
    async checkCompletion(agentId, lastAnswer) {
      await ready;
      const claims = [...service.postsOf(LOBBY), ...service.postsOf(DUTY)].filter(
        (p) => p.state === "claimed" && p.claimedBy === agentId,
      );
      if (!claims.length) return;
      const text = await lastAnswer();
      const line = text?.trimEnd().split("\n").at(-1)?.trim();
      const claim = claims.find((p) => completionLine(p) === line);
      if (!claim) return;
      // What the reply says before the line is the task's result.
      const result = (text ?? "").trimEnd().split("\n").slice(0, -1).join("\n").trim();
      await service.finishLobbyClaim(claim, result.slice(0, POST_TEXT_MAX) || undefined);
    },
    async settleSpentOf(statuses) {
      await ready;
      for (const agentId of service.spentPendingAgents()) {
        const status = statuses.get(agentId);
        if (status === "running" || status === "initializing") continue;
        try {
          await service.settleSpent(agentId, status !== undefined && status !== "closed");
        } catch (error) {
          log(`[office] unable to settle the cost of ${agentId}: ${errorMessage(error)}`);
        }
      }
    },
    agentGone(agentId, how) {
      queue?.agentGone(agentId);
      void ready
        .then(() => service.settleSpent(agentId, false))
        .catch((error: unknown) =>
          log(`[office] unable to settle the cost of ${agentId}: ${errorMessage(error)}`),
        );
      // Paseo closes an idle session's runtime, and a reply or a task starts it again: what it
      // holds, and what it asked, wait for it.
      if (how === "closed") return;
      // An archived agent never finishes what it held: the tasks go back to the pickup.
      void ready
        .then(() => service.releaseClaims(agentId))
        .then((ids) => {
          if (ids.length > 0) log(`[office] released ${ids.join(", ")} held by ${agentId}`);
          // The promise lint rule wants every then() to return.
          return ids;
        })
        .catch((error: unknown) =>
          log(`[office] unable to release the claims of ${agentId}: ${errorMessage(error)}`),
        );
    },
    async workspaceArchived(workspaceId) {
      await ready;
      await service.removeBoard(workspaceId);
    },
    async stop() {
      stopped = true;
      cancelPrune?.();
      cancelPrune = null;
      queue?.stop();
      await pickup?.stop();
    },
  };
}
