import { randomUUID } from "node:crypto";
import {
  BOARD_POST_MAX,
  DONE_TASK_TTL_MS,
  DUTY,
  LOBBY,
  USER_AUTHOR,
  POST_TEXT_MAX,
  READ_POST_MAX,
  type DeleteResult,
  type Duty,
  type Post,
  type PostKind,
  type PostResult,
  type UpdateAction,
} from "../shared/contracts.js";
import { dutyPostText } from "../shared/duties.js";
import type { BoardStore, BoardsFile } from "./board-store.js";
import { errorMessage } from "./errors.js";
import type { Clock } from "./timers.js";

export interface NewPost {
  board: string;
  kind: PostKind;
  text: string;
  to?: string;
  /** An agent id, or "user". */
  author: string;
}

export interface PostUpdate {
  id: string;
  action: UpdateAction;
  actor: string;
}

export interface ReadResult {
  posts: Post[];
  /** The highest seq returned; pass it as `since` for newer posts only. */
  cursor: number;
  /** More posts after `cursor` than one read returns. */
  more: boolean;
}

export interface BoardServicePorts {
  store: BoardStore;
  clock: Clock;
  log(message: string): void;
  /** A readable name for an agent id or "user". */
  label(author: string): string;
  onBoard(board: string, posts: readonly Post[]): void;
  onBoardRemoved(board: string): void;
  /** Why this update of this post is refused, before the claim rules; null when it is not. */
  refuse?(post: Post, input: PostUpdate): string | null;
}

/** What the duty board is brought up to: the list, the board's day, and the duties due now. */
export interface DutySync {
  duties: readonly Duty[];
  /** The board's day (YYYY-MM-DD): done duties of earlier days leave the board. */
  day: string;
  /** Posted for `day` unless the duty has a post of that day, an owed one, or one finished that day. */
  due: readonly Duty[];
  /** The board's day an instant falls on: a done duty is judged by the day it was finished. */
  dayOf(at: number): string;
}

export interface BoardService {
  start(): Promise<void>;
  boards(): Record<string, Post[]>;
  postsOf(board: string): Post[];
  wakesPaused(): boolean;
  post(input: NewPost): Promise<PostResult>;
  update(input: PostUpdate): Promise<PostResult>;
  /**
   * Claims a lobby task or a duty for an automatic assignment. Returns null if the task changed or
   * the agent can no longer pick it up: it holds one already, on either board.
   */
  claimLobbyTask(id: string, agentId: string, expectedSeq: number): Promise<Post | null>;
  /** Reopens only this revision of the claim after its dispatch failed. */
  releaseLobbyTask(claim: Post): Promise<void>;
  confirmLobbyDelivery(claim: Post): Promise<void>;
  finishLobbyClaim(claim: Post): Promise<void>;
  remove(id: string): Promise<DeleteResult>;
  /** Deletes every done task of `board`. */
  clearDone(board: string): Promise<DeleteResult>;
  read(board: string, since: number | null): ReadResult;
  removeBoard(board: string): Promise<void>;
  setWakesPaused(paused: boolean): Promise<void>;
  prune(): Promise<void>;
  /** Brings the duty board up to the list and the day, in one save. */
  syncDuties(plan: DutySync): Promise<void>;
  /** A pretend duty the 3D office acted out: done by that agent. Once done, it stays as it is. */
  actDuty(id: string, agentId: string): Promise<PostResult>;
}

/** The boards whose tasks the office hands to idle agents. */
const PICKUP_BOARDS: ReadonlySet<string> = new Set([LOBBY, DUTY]);

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

const VERBS: Record<UpdateAction, string> = { claim: "claim", done: "finish", reopen: "reopen" };

function byAge(left: Post, right: Post): number {
  return left.createdAt.localeCompare(right.createdAt) || left.seq - right.seq;
}

/** Drops the oldest done tasks, then the oldest notes, until `max` posts are left or none can go. */
export function trimBoard(posts: readonly Post[], max: number): Post[] {
  if (posts.length <= max) return [...posts];
  const done = posts.filter((item) => item.kind === "task" && item.state === "done").sort(byAge);
  const notes = posts.filter((item) => item.kind === "note").sort(byAge);
  const drop = new Set([...done, ...notes].slice(0, posts.length - max).map((item) => item.id));
  return posts.filter((item) => !drop.has(item.id));
}

function withoutClaim(post: Post): Post {
  const next: Post = {
    id: post.id,
    seq: post.seq,
    board: post.board,
    kind: post.kind,
    text: post.text,
    author: post.author,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
  if (post.to !== undefined) next.to = post.to;
  if (post.state !== undefined) next.state = post.state;
  if (post.duty !== undefined) next.duty = post.duty;
  return next;
}

function isDutyTask(post: Post): boolean {
  return post.board === DUTY && post.kind === "task" && post.duty !== undefined;
}

/** The board's day a done duty was finished on: an owed one is finished on a later day than its own. */
function finishedDay(post: Post, plan: DutySync): string {
  return plan.dayOf(Date.parse(post.updatedAt));
}

/** Off the board at a sync: a duty finished on an earlier day, and an open duty no longer listed. */
function leavesAtSync(post: Post, plan: DutySync, listed: ReadonlySet<string>): boolean {
  if (!isDutyTask(post) || post.duty === undefined) return false;
  if (post.state === "done") return finishedDay(post, plan) < plan.day;
  return post.state === "open" && post.claimedBy === undefined && !listed.has(post.duty.id);
}

export function createBoardService(ports: BoardServicePorts): BoardService {
  let data: BoardsFile = { version: 1, nextSeq: 1, wakesPaused: false, posts: [] };
  let chain: Promise<unknown> = Promise.resolve();

  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = chain.then(work);
    chain = run.catch(() => undefined);
    return run;
  }

  function postsOf(board: string): Post[] {
    return data.posts
      .filter((item) => item.board === board)
      .sort((left, right) => left.seq - right.seq);
  }

  function now(): string {
    return new Date(ports.clock.now()).toISOString();
  }

  /** A listener that throws is logged: the change is saved and stands. */
  function tell(listener: () => void): void {
    try {
      listener();
    } catch (error) {
      ports.log(`[office] board listener failed: ${errorMessage(error)}`);
    }
  }

  /** Saves `next`, then makes it current and announces the touched boards. */
  async function commit(next: BoardsFile, touched: readonly string[]): Promise<Outcome<null>> {
    try {
      await ports.store.save(next);
    } catch (error) {
      ports.log(`[office] unable to save the board: ${errorMessage(error)}`);
      return { ok: false, error: `Unable to save the board: ${errorMessage(error)}` };
    }
    data = next;
    for (const board of new Set(touched)) tell(() => ports.onBoard(board, postsOf(board)));
    return { ok: true, value: null };
  }

  function validText(text: string): Outcome<string> {
    const trimmed = text.trim();
    if (trimmed.length === 0) return { ok: false, error: "Unable to post: the text is empty" };
    if (trimmed.length > POST_TEXT_MAX) {
      return { ok: false, error: "Unable to post: the text is longer than 2,000 characters" };
    }
    return { ok: true, value: trimmed };
  }

  async function createPost(input: NewPost): Promise<PostResult> {
    const text = validText(input.text);
    if (!text.ok) return text;
    const seq = data.nextSeq;
    const stamp = now();
    const created: Post = {
      id: `p${seq}`,
      seq,
      board: input.board,
      kind: input.kind,
      text: text.value,
      author: input.author,
      createdAt: stamp,
      updatedAt: stamp,
    };
    if (input.to !== undefined) created.to = input.to;
    if (input.kind === "task") created.state = "open";
    // Make room among the existing posts, so the new one is never the one dropped.
    const kept = trimBoard(postsOf(input.board), BOARD_POST_MAX - 1);
    if (kept.length >= BOARD_POST_MAX) {
      return { ok: false, error: "Unable to post: the board holds 200 open or claimed tasks" };
    }
    const others = data.posts.filter((item) => item.board !== input.board);
    const posts = [...others, ...kept, created];
    const saved = await commit({ ...data, nextSeq: seq + 1, posts }, [input.board]);
    return saved.ok ? { ok: true, post: created } : saved;
  }

  function nextState(post: Post, input: PostUpdate): Outcome<Post | null> {
    const refuse = (reason: string): Outcome<Post | null> => ({
      ok: false,
      error: `Unable to ${VERBS[input.action]} ${post.id}: ${reason}`,
    });
    if (post.kind !== "task") return refuse("it is a note");
    const refusal = ports.refuse?.(post, input) ?? null;
    if (refusal !== null) return refuse(refusal);
    if (input.action === "claim") {
      if (post.state === "done") return refuse("it is done");
      if (post.state === "claimed" && post.claimedBy === input.actor)
        return { ok: true, value: null };
      if (post.state === "claimed" && post.claimedBy !== undefined) {
        return refuse(`claimed by ${ports.label(post.claimedBy)}`);
      }
      return { ok: true, value: { ...post, state: "claimed", claimedBy: input.actor } };
    }
    if (input.action === "done") {
      const done = { ...post, state: "done" as const };
      delete done.pickupMessageId;
      return post.state === "done" ? { ok: true, value: null } : { ok: true, value: done };
    }
    // Like a repeated claim: an open task that nobody holds is not changed by a reopen.
    if (post.state === "open" && post.claimedBy === undefined) return { ok: true, value: null };
    return { ok: true, value: { ...withoutClaim(post), state: "open" } };
  }

  async function updatePost(input: PostUpdate, pickupMessageId?: string): Promise<PostResult> {
    const post = data.posts.find((item) => item.id === input.id);
    if (!post) return { ok: false, error: `Unable to update ${input.id}: no such post` };
    const next = nextState(post, input);
    if (!next.ok) return next;
    if (next.value === null) return { ok: true, post };
    const changed: Post = { ...next.value, seq: data.nextSeq, updatedAt: now() };
    if (pickupMessageId) changed.pickupMessageId = pickupMessageId;
    const posts = data.posts.map((item) => (item.id === post.id ? changed : item));
    const saved = await commit({ ...data, nextSeq: data.nextSeq + 1, posts }, [post.board]);
    return saved.ok ? { ok: true, post: changed } : saved;
  }

  async function updateForPickup(input: PostUpdate, pickupMessageId?: string): Promise<Post> {
    const result = await updatePost(input, pickupMessageId);
    if (!result.ok) throw new Error(result.error);
    return result.post;
  }

  async function prunePosts(): Promise<void> {
    const cutoff = ports.clock.now() - DONE_TASK_TTL_MS;
    const expired = data.posts.filter(
      (item) =>
        item.kind === "task" && item.state === "done" && Date.parse(item.updatedAt) < cutoff,
    );
    if (expired.length === 0) return;
    const gone = new Set(expired.map((item) => item.id));
    const boards = expired.map((item) => item.board);
    await commit({ ...data, posts: data.posts.filter((item) => !gone.has(item.id)) }, boards);
  }

  /** Today's duties not yet posted, each as a new open post. */
  function newDutyPosts(plan: DutySync, kept: readonly Post[], firstSeq: number): Post[] {
    const stamp = now();
    const held = (duty: Duty) =>
      kept.some(
        (post) =>
          isDutyTask(post) &&
          post.duty?.id === duty.id &&
          (post.state !== "done" ||
            post.duty.day === plan.day ||
            finishedDay(post, plan) === plan.day),
      );
    return plan.due
      .filter((duty) => !held(duty))
      .map((duty, index) => ({
        id: `p${firstSeq + index}`,
        seq: firstSeq + index,
        board: DUTY,
        kind: "task" as const,
        text: dutyPostText(duty),
        author: USER_AUTHOR,
        state: "open" as const,
        duty: { id: duty.id, day: plan.day },
        createdAt: stamp,
        updatedAt: stamp,
      }));
  }

  async function syncDutyBoard(plan: DutySync): Promise<void> {
    const listed = new Map(plan.duties.map((duty) => [duty.id, duty]));
    let seq = data.nextSeq;
    let changed = false;
    const kept: Post[] = [];
    for (const post of data.posts) {
      if (leavesAtSync(post, plan, new Set(listed.keys()))) {
        changed = true;
        continue;
      }
      const duty = post.duty === undefined ? undefined : listed.get(post.duty.id);
      const text = duty === undefined ? post.text : dutyPostText(duty);
      const editable = isDutyTask(post) && post.state === "open" && post.claimedBy === undefined;
      if (editable && text !== post.text) {
        kept.push({ ...post, text, seq, updatedAt: now() });
        seq += 1;
        changed = true;
      } else kept.push(post);
    }
    const added = newDutyPosts(plan, kept, seq);
    if (!changed && added.length === 0) return;
    const saved = await commit(
      { ...data, nextSeq: seq + added.length, posts: [...kept, ...added] },
      [DUTY],
    );
    if (!saved.ok) throw new Error(saved.error);
  }

  async function recordActed(id: string, agentId: string): Promise<PostResult> {
    const post = data.posts.find((item) => item.id === id);
    const refuse = (reason: string): PostResult => ({
      ok: false,
      error: `Unable to record ${id}: ${reason}`,
    });
    if (!post) return refuse("no such post");
    if (!isDutyTask(post)) return refuse("it is not a duty");
    if (post.state === "done") return { ok: true, post };
    if (post.claimedBy !== undefined) return refuse(`claimed by ${ports.label(post.claimedBy)}`);
    const acted: Post = {
      ...post,
      state: "done",
      claimedBy: agentId,
      seq: data.nextSeq,
      updatedAt: now(),
    };
    const posts = data.posts.map((item) => (item.id === id ? acted : item));
    const saved = await commit({ ...data, nextSeq: data.nextSeq + 1, posts }, [DUTY]);
    return saved.ok ? { ok: true, post: acted } : saved;
  }

  return {
    // Queued like every mutation, so a post made while the file loads waits for it.
    start: () =>
      exclusive(async () => {
        data = await ports.store.load();
        await prunePosts();
      }),
    postsOf,
    boards() {
      const grouped: Record<string, Post[]> = {};
      for (const board of new Set(data.posts.map((item) => item.board)))
        grouped[board] = postsOf(board);
      return grouped;
    },
    wakesPaused: () => data.wakesPaused,
    post: (input) => exclusive(() => createPost(input)),
    update: (input) => exclusive(() => updatePost(input)),
    claimLobbyTask: (id, agentId, expectedSeq) =>
      exclusive(async () => {
        const pickup = data.posts.filter((post) => PICKUP_BOARDS.has(post.board));
        const task = pickup.find((post) => post.id === id);
        if (
          data.wakesPaused ||
          task?.seq !== expectedSeq ||
          task.kind !== "task" ||
          task.state !== "open" ||
          task.to !== undefined ||
          task.claimedBy !== undefined ||
          task.author === agentId
        )
          return null;
        if (pickup.some((post) => post.state === "claimed" && post.claimedBy === agentId))
          return null;
        if (ports.refuse?.(task, { id, actor: agentId, action: "claim" })) return null;
        return updateForPickup({ id, actor: agentId, action: "claim" }, randomUUID());
      }),
    finishLobbyClaim: (claim) =>
      exclusive(async () => {
        const current = data.posts.find((p) => p.id === claim.id && PICKUP_BOARDS.has(p.board));
        if (
          current?.state === "claimed" &&
          current.seq === claim.seq &&
          current.claimedBy &&
          current.claimedBy === claim.claimedBy
        ) {
          await updateForPickup({ id: current.id, action: "done", actor: current.claimedBy });
        }
      }),
    confirmLobbyDelivery: (claim) =>
      exclusive(async () => {
        const current = data.posts.find((post) => post.id === claim.id);
        if (
          !current?.pickupMessageId ||
          current.seq !== claim.seq ||
          current.pickupMessageId !== claim.pickupMessageId
        )
          return;
        const delivered = { ...current };
        delete delivered.pickupMessageId;
        const saved = await commit(
          { ...data, posts: data.posts.map((p) => (p.id === claim.id ? delivered : p)) },
          [],
        );
        if (!saved.ok) throw new Error(saved.error);
      }),
    releaseLobbyTask: (claim) =>
      exclusive(async () => {
        const task = data.posts.find((post) => post.id === claim.id);
        if (
          task !== undefined &&
          PICKUP_BOARDS.has(task.board) &&
          !!task.pickupMessageId &&
          task.pickupMessageId === claim.pickupMessageId &&
          task.seq === claim.seq &&
          task.state === "claimed" &&
          claim.claimedBy !== undefined &&
          task.claimedBy === claim.claimedBy
        ) {
          await updateForPickup({ id: task.id, actor: claim.claimedBy, action: "reopen" });
        }
      }),
    remove: (id) =>
      exclusive(async (): Promise<DeleteResult> => {
        const post = data.posts.find((item) => item.id === id);
        if (!post) return { ok: false, error: `Unable to delete ${id}: no such post` };
        const posts = data.posts.filter((item) => item.id !== id);
        const saved = await commit({ ...data, posts }, [post.board]);
        return saved.ok ? { ok: true } : saved;
      }),
    clearDone: (board) =>
      exclusive(async (): Promise<DeleteResult> => {
        const posts = data.posts.filter(
          (item) => item.board !== board || item.kind !== "task" || item.state !== "done",
        );
        if (posts.length === data.posts.length) return { ok: true };
        const saved = await commit({ ...data, posts }, [board]);
        return saved.ok ? { ok: true } : saved;
      }),
    read(board, since) {
      const posts = postsOf(board);
      if (since === null) {
        const page = posts.slice(-READ_POST_MAX);
        return { posts: page, cursor: page.at(-1)?.seq ?? 0, more: false };
      }
      const newer = posts.filter((item) => item.seq > since);
      const page = newer.slice(0, READ_POST_MAX);
      return { posts: page, cursor: page.at(-1)?.seq ?? since, more: newer.length > page.length };
    },
    removeBoard: (board) =>
      exclusive(async () => {
        const posts = data.posts.filter((item) => item.board !== board);
        if (posts.length !== data.posts.length) {
          const saved = await commit({ ...data, posts }, []);
          if (!saved.ok) return;
        }
        tell(() => ports.onBoardRemoved(board));
      }),
    setWakesPaused: (paused) =>
      exclusive(async () => {
        const saved = await commit({ ...data, wakesPaused: paused }, []);
        if (!saved.ok) throw new Error(saved.error);
      }),
    prune: () => exclusive(prunePosts),
    syncDuties: (plan) => exclusive(() => syncDutyBoard(plan)),
    actDuty: (id, agentId) => exclusive(() => recordActed(id, agentId)),
  };
}
