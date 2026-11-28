import { randomUUID } from "node:crypto";
import {
  BOARD_POST_MAX,
  DONE_TASK_TTL_MS,
  DUTY,
  LOBBY,
  POST_TEXT_MAX,
  READ_POST_MAX,
  USER_AUTHOR,
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
  /** The task this answers: the post becomes a note on that task's board, for its holder. */
  replyTo?: string;
  /** An agent id, or "user". */
  author: string;
}

export interface PostUpdate {
  id: string;
  action: UpdateAction;
  actor: string;
  /** With `done`: what came of the task, kept as its result. With `block`: what the holder needs. */
  note?: string;
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
  /** The workspace an agent works in, or null for none; its board gets the agent's lobby claims. */
  workspaceOf(agentId: string): Promise<string | null>;
  /** Why this update of this post is refused, before the claim rules; null when it is not. */
  refuse?(post: Post, input: PostUpdate): string | null;
}

/** What the duty board is brought up to: the list, the board's day, and the duties due now. */
export interface DutySync {
  duties: readonly Duty[];
  /** The board's day (YYYY-MM-DD): done duties of earlier days leave the board. */
  day: string;
  /** Posted for `day` unless the duty has a post of that day or later, an owed one, or one finished that day. */
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
  finishLobbyClaim(claim: Post, result?: string): Promise<void>;
  remove(id: string): Promise<DeleteResult>;
  /** Deletes every done task of `board`. */
  clearDone(board: string): Promise<DeleteResult>;
  read(board: string, since: number | null): ReadResult;
  removeBoard(board: string): Promise<void>;
  setWakesPaused(paused: boolean): Promise<void>;
  prune(): Promise<void>;
  /** Brings the duty board up to the list and the day, in one save. */
  syncDuties(plan: DutySync): Promise<void>;
  /**
   * Reopens every task `agentId` still holds, as the user would, in one save: the agent is closed or
   * archived and will not finish them. Returns the ids left open (a pair's lobby task), in order.
   */
  releaseClaims(agentId: string): Promise<string[]>;
  /** A pretend duty the 3D office acted out: done by that agent. Once done, it stays as it is. */
  actDuty(id: string, agentId: string): Promise<PostResult>;
}

/** The boards whose tasks the office hands to idle agents. */
const PICKUP_BOARDS: ReadonlySet<string> = new Set([LOBBY, DUTY]);

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

const VERBS: Record<UpdateAction, string> = {
  claim: "claim",
  done: "finish",
  reopen: "reopen",
  block: "block",
};

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
  if (post.namedPickup) next.namedPickup = true;
  if (post.state !== undefined) next.state = post.state;
  if (post.duty !== undefined) next.duty = post.duty;
  // A reopened task has no result: the next finish brings its own.
  return next;
}

function isDutyTask(post: Post): boolean {
  return post.board === DUTY && post.kind === "task" && post.duty !== undefined;
}

/** The board's day a done duty was finished on: an owed one is finished on a later day than its own. */
function finishedDay(post: Post, plan: DutySync): string {
  return plan.dayOf(Date.parse(post.updatedAt));
}

/** The weekday of a day (YYYY-MM-DD), 0 for Sunday. */
function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00.000Z`).getUTCDay();
}

/**
 * Off the board at a sync: a duty of an earlier day finished on an earlier day (a move of the
 * notes' zone west can put either day after the plan's), and an open duty nobody holds that is no
 * longer listed, or whose day is the plan's and no longer one of its weekdays.
 */
function leavesAtSync(post: Post, plan: DutySync, listed: ReadonlyMap<string, Duty>): boolean {
  if (!isDutyTask(post) || post.duty === undefined) return false;
  if (post.state === "done") return post.duty.day < plan.day && finishedDay(post, plan) < plan.day;
  if (post.state !== "open" || post.claimedBy !== undefined) return false;
  const duty = listed.get(post.duty.id);
  return (
    duty === undefined || (post.duty.day === plan.day && !duty.days.includes(weekdayOf(plan.day)))
  );
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

  /** Drops each link whose post is gone, and adds the boards of the posts it changes. */
  function withoutDeadLinks(next: BoardsFile, touched: string[]): BoardsFile {
    const ids = new Set(next.posts.map((item) => item.id));
    if (next.posts.every((item) => item.link === undefined || ids.has(item.link))) return next;
    const posts = next.posts.map((item) => {
      if (item.link === undefined || ids.has(item.link)) return item;
      touched.push(item.board);
      const unlinked = { ...item };
      delete unlinked.link;
      return unlinked;
    });
    return { ...next, posts };
  }

  /** Drops each reply whose task is gone, and adds the boards of the posts it drops. */
  function withoutOrphanReplies(next: BoardsFile, touched: string[]): BoardsFile {
    let posts = next.posts;
    for (;;) {
      const ids = new Set(posts.map((item) => item.id));
      const orphans = posts.filter((item) => item.replyTo !== undefined && !ids.has(item.replyTo));
      if (orphans.length === 0) break;
      for (const item of orphans) touched.push(item.board);
      posts = posts.filter((item) => !orphans.includes(item));
    }
    return posts === next.posts ? next : { ...next, posts };
  }

  /** Saves `next`, then makes it current and announces the touched boards. */
  async function commit(proposed: BoardsFile, changed: readonly string[]): Promise<Outcome<null>> {
    const touched = [...changed];
    const next = withoutOrphanReplies(withoutDeadLinks(proposed, touched), touched);
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

  /** The task a reply answers: past other replies, and from a copy to its lobby task. */
  function rootOf(id: string): Post | undefined {
    let target = data.posts.find((item) => item.id === id);
    // Bounded, so a loop in a hand-edited file ends.
    for (let step = 0; target !== undefined && step <= data.posts.length; step++) {
      if (target.replyTo !== undefined) {
        target = data.posts.find((item) => item.id === target?.replyTo);
        continue;
      }
      if (target.kind !== "task") return undefined;
      const partner = partnerOf(target);
      return partner?.board === LOBBY ? partner : target;
    }
    return undefined;
  }

  /** An answer from anyone but the holder unblocks the task, and its partner, in the reply's save. */
  function unblocked(
    root: Post | undefined,
    author: string,
    posts: Post[],
    seq: number,
    stamp: string,
  ): { posts: Post[]; seq: number; boards: string[] } {
    if (root?.blocked === undefined || author === root.claimedBy) return { posts, seq, boards: [] };
    const partner = partnerOf(root);
    const ids = new Set([root.id, ...(partner === undefined ? [] : [partner.id])]);
    const boards = partner === undefined ? [] : [partner.board];
    const cleared = posts.map((item) => {
      if (!ids.has(item.id)) return item;
      const resumed: Post = { ...item, seq: seq++, updatedAt: stamp };
      delete resumed.blocked;
      return resumed;
    });
    return { posts: cleared, seq, boards };
  }

  async function createPost(input: NewPost): Promise<PostResult> {
    const text = validText(input.text);
    if (!text.ok) return text;
    const root = input.replyTo === undefined ? undefined : rootOf(input.replyTo);
    if (input.replyTo !== undefined && root === undefined)
      return { ok: false, error: `Unable to post: no task ${input.replyTo}` };
    const board = root?.board ?? input.board;
    const kind = root === undefined ? input.kind : "note";
    const seq = data.nextSeq;
    const stamp = now();
    const created: Post = {
      id: `p${seq}`,
      seq,
      board,
      kind,
      text: text.value,
      author: input.author,
      createdAt: stamp,
      updatedAt: stamp,
    };
    if (root !== undefined) {
      created.replyTo = root.id;
      // The holder is woken by a mention; a reply never names a lobby pickup.
      const holder = root.claimedBy;
      if (holder !== undefined && holder !== USER_AUTHOR && holder !== input.author)
        created.to = holder;
    } else if (input.to !== undefined) created.to = input.to;
    if (kind === "task") created.state = "open";
    if (board === LOBBY && kind === "task" && input.to && input.to !== input.author)
      created.namedPickup = true;
    // Make room among the existing posts, so the new one is never the one dropped.
    // A reply's task and that task's replies stay: the reply would go with them.
    const held = postsOf(board).filter(
      (item) => root !== undefined && (item.id === root.id || item.replyTo === root.id),
    );
    const heldIds = new Set(held.map((item) => item.id));
    const rest = postsOf(board).filter((item) => !heldIds.has(item.id));
    const kept = [...trimBoard(rest, BOARD_POST_MAX - 1 - held.length), ...held];
    if (kept.length >= BOARD_POST_MAX) {
      return { ok: false, error: "Unable to post: the board holds 200 open or claimed tasks" };
    }
    const all = [...data.posts.filter((item) => item.board !== board), ...kept, created];
    const answered = unblocked(root, input.author, all, seq + 1, stamp);
    const touched = [board, ...answered.boards.filter((item) => item !== board)];
    const saved = await commit({ ...data, nextSeq: answered.seq, posts: answered.posts }, touched);
    return saved.ok ? { ok: true, post: created } : saved;
  }

  /** The post linked with `post`, if it still exists and links back. */
  function partnerOf(post: Post): Post | undefined {
    if (post.link === undefined) return undefined;
    const other = data.posts.find((item) => item.id === post.link);
    return other?.link === post.id ? other : undefined;
  }

  /** A lookup that fails is logged: the claim stands without a copy. */
  async function roomOf(agentId: string): Promise<string | null> {
    try {
      return await ports.workspaceOf(agentId);
    } catch (error) {
      ports.log(`[office] no workspace for ${agentId}: ${errorMessage(error)}`);
      return null;
    }
  }

  /** `posts` with a copy of the lobby task on `room`, trimmed as a new post is; null when full. */
  function withCopy(
    posts: readonly Post[],
    task: Post,
    claimer: string,
    room: string,
    seq: number,
  ): { posts: Post[]; copy: Post } | null {
    const kept = trimBoard(
      posts.filter((item) => item.board === room),
      BOARD_POST_MAX - 1,
    );
    if (kept.length >= BOARD_POST_MAX) {
      ports.log(
        `[office] no copy of ${task.id} on ${room}: the board holds 200 open or claimed tasks`,
      );
      return null;
    }
    const stamp = now();
    const copy: Post = {
      id: `p${seq}`,
      seq,
      board: room,
      kind: "task",
      text: task.text,
      author: task.author,
      state: "claimed",
      claimedBy: claimer,
      link: task.id,
      createdAt: stamp,
      updatedAt: stamp,
    };
    return { posts: [...posts.filter((item) => item.board !== room), ...kept, copy], copy };
  }

  function blockState(post: Post, input: PostUpdate): Outcome<Post | null> {
    const refuse = (reason: string): Outcome<Post | null> => ({
      ok: false,
      error: `Unable to block ${post.id}: ${reason}`,
    });
    const reason = input.note?.trim();
    if (!reason) return refuse("say what you need in note");
    if (post.state === "done") return refuse("it is done");
    if (post.claimedBy === undefined) return refuse("claim it first");
    if (post.claimedBy !== input.actor) return refuse(`claimed by ${ports.label(post.claimedBy)}`);
    return post.blocked === reason
      ? { ok: true, value: null }
      : { ok: true, value: { ...post, blocked: reason } };
  }

  function claimState(post: Post, input: PostUpdate): Outcome<Post | null> {
    const refuse = (reason: string): Outcome<Post | null> => ({
      ok: false,
      error: `Unable to claim ${post.id}: ${reason}`,
    });
    if (post.state === "done") return refuse("it is done");
    if (post.state === "claimed" && post.claimedBy === input.actor) {
      // The one repeated claim that changes the post: the holder is back at work.
      if (post.blocked === undefined) return { ok: true, value: null };
      const resumed = { ...post };
      delete resumed.blocked;
      return { ok: true, value: resumed };
    }
    if (post.state === "claimed" && post.claimedBy !== undefined) {
      return refuse(`claimed by ${ports.label(post.claimedBy)}`);
    }
    return { ok: true, value: { ...post, state: "claimed", claimedBy: input.actor } };
  }

  function nextState(post: Post, input: PostUpdate): Outcome<Post | null> {
    const refuse = (reason: string): Outcome<Post | null> => ({
      ok: false,
      error: `Unable to ${VERBS[input.action]} ${post.id}: ${reason}`,
    });
    if (post.kind !== "task") return refuse("it is a note");
    const refusal = ports.refuse?.(post, input) ?? null;
    if (refusal !== null) return refuse(refusal);
    if (input.action === "block") return blockState(post, input);
    if (input.action === "claim") return claimState(post, input);
    if (input.action === "done") {
      const done = { ...post, state: "done" as const };
      delete done.pickupMessageId;
      delete done.blocked;
      const result = input.note?.trim();
      if (result) done.result = result;
      return post.state === "done" ? { ok: true, value: null } : { ok: true, value: done };
    }
    // Like a repeated claim: an open task that nobody holds is not changed by a reopen.
    if (post.state === "open" && post.claimedBy === undefined) return { ok: true, value: null };
    return { ok: true, value: { ...withoutClaim(post), state: "open" } };
  }

  /** `partner` finished along with `post`, with the same result. */
  function doneAs(partner: Post, post: Post, seq: number): Post {
    const done: Post = { ...partner, state: "done", seq, updatedAt: now() };
    delete done.pickupMessageId;
    delete done.blocked;
    if (post.result !== undefined) done.result = post.result;
    return done;
  }

  /** `partner` with the same block mark as `post`: a linked pair always agrees. */
  function markedAs(partner: Post, post: Post, seq: number): Post {
    const marked: Post = { ...partner, seq, updatedAt: now() };
    if (post.blocked === undefined) delete marked.blocked;
    else marked.blocked = post.blocked;
    return marked;
  }

  /** A lobby task newly claimed by an agent, with no copy yet, gets one on the agent's board. */
  function needsCopy(post: Post, next: Post, partner: Post | undefined, actor: string): boolean {
    return (
      partner === undefined &&
      post.board === LOBBY &&
      next.state === "claimed" &&
      actor !== USER_AUTHOR
    );
  }

  async function updatePost(input: PostUpdate, pickupMessageId?: string): Promise<PostResult> {
    const post = data.posts.find((item) => item.id === input.id);
    if (!post) return { ok: false, error: `Unable to update ${input.id}: no such post` };
    const next = nextState(post, input);
    if (!next.ok) return next;
    if (next.value === null) return { ok: true, post };
    const partner = partnerOf(post);
    if (partner?.board === LOBBY && next.value.state === "open")
      return reopenFromCopy(post, partner);
    const room = needsCopy(post, next.value, partner, input.actor)
      ? await roomOf(input.actor)
      : null;
    let seq = data.nextSeq;
    const changed: Post = { ...next.value, seq: seq++, updatedAt: now() };
    if (pickupMessageId) changed.pickupMessageId = pickupMessageId;
    let posts = data.posts.map((item) => (item.id === post.id ? changed : item));
    const touched = [post.board];
    if (partner !== undefined && changed.state === "open") {
      // The lobby task is free again: its copy goes, whatever its state.
      posts = posts.filter((item) => item.id !== partner.id);
      touched.push(partner.board);
    } else if (partner !== undefined && changed.state === "done" && partner.state !== "done") {
      const done = doneAs(partner, changed, seq++);
      posts = posts.map((item) => (item.id === partner.id ? done : item));
      touched.push(partner.board);
    } else if (partner !== undefined) {
      if (partner.blocked !== changed.blocked) {
        posts = posts.map((item) =>
          item.id === partner.id ? markedAs(partner, changed, seq++) : item,
        );
        touched.push(partner.board);
      }
    } else if (room !== null) {
      const added = withCopy(posts, changed, input.actor, room, seq);
      if (added !== null) {
        seq++;
        changed.link = added.copy.id;
        posts = added.posts;
        touched.push(room);
      }
    }
    const saved = await commit({ ...data, nextSeq: seq, posts }, touched);
    return saved.ok ? { ok: true, post: changed } : saved;
  }

  /** Reopening a copy reopens its lobby task and deletes the copy; the result is the lobby task. */
  async function reopenFromCopy(copy: Post, task: Post): Promise<PostResult> {
    // A linked lobby task is claimed or done, so a reopen always frees it.
    const reopened: Post = {
      ...withoutClaim(task),
      state: "open",
      seq: data.nextSeq,
      updatedAt: now(),
    };
    const posts = data.posts
      .filter((item) => item.id !== copy.id)
      .map((item) => (item.id === task.id ? reopened : item));
    const saved = await commit({ ...data, nextSeq: data.nextSeq + 1, posts }, [
      task.board,
      copy.board,
    ]);
    return saved.ok ? { ok: true, post: reopened } : saved;
  }

  /** A lobby task with its copy reopens as one; any other held task reopens in place. */
  async function releaseHeld(agentId: string): Promise<string[]> {
    const held = data.posts.filter(
      (item) => item.kind === "task" && item.state === "claimed" && item.claimedBy === agentId,
    );
    const handled = new Set<string>();
    const reopened = new Map<string, Post>();
    const gone = new Set<string>();
    const touched: string[] = [];
    const ids: string[] = [];
    let seq = data.nextSeq;
    for (const task of held) {
      if (handled.has(task.id)) continue;
      const partner = partnerOf(task);
      const pair = partner !== undefined && (task.board === LOBBY || partner.board === LOBBY);
      const target = pair && partner.board === LOBBY ? partner : task;
      handled.add(task.id);
      if (pair) {
        const copy = target === task ? partner : task;
        handled.add(partner.id);
        gone.add(copy.id);
        touched.push(copy.board);
      }
      reopened.set(target.id, {
        ...withoutClaim(target),
        state: "open",
        seq: seq++,
        updatedAt: now(),
      });
      touched.push(target.board);
      ids.push(target.id);
    }
    if (ids.length === 0) return [];
    const posts = data.posts
      .filter((item) => !gone.has(item.id))
      .map((item) => reopened.get(item.id) ?? item);
    const saved = await commit({ ...data, nextSeq: seq, posts }, touched);
    if (!saved.ok) throw new Error(saved.error);
    return ids;
  }

  /** Gives each lobby task claimed by an agent, without a copy, one on the agent's board. */
  async function copyClaims(): Promise<void> {
    let posts = data.posts;
    let seq = data.nextSeq;
    const touched: string[] = [];
    for (const task of postsOf(LOBBY)) {
      const claimer = task.claimedBy;
      if (task.kind !== "task" || task.state !== "claimed" || partnerOf(task)) continue;
      if (claimer === undefined || claimer === USER_AUTHOR) continue;
      const room = await roomOf(claimer);
      if (room === null) continue;
      const added = withCopy(posts, task, claimer, room, seq);
      if (added === null) continue;
      // The task keeps its seq, so the completion line of its assignment still matches.
      const linked = { ...task, link: added.copy.id };
      posts = added.posts.map((item) => (item.id === task.id ? linked : item));
      seq++;
      touched.push(LOBBY, room);
    }
    if (touched.length > 0) await commit({ ...data, nextSeq: seq, posts }, touched);
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
            post.duty.day >= plan.day ||
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
      if (leavesAtSync(post, plan, listed)) {
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
        await copyClaims();
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
          (task.to !== undefined && (!task.namedPickup || task.to !== agentId)) ||
          task.claimedBy !== undefined ||
          task.author === agentId
        )
          return null;
        if (pickup.some((post) => post.state === "claimed" && post.claimedBy === agentId))
          return null;
        if (ports.refuse?.(task, { id, actor: agentId, action: "claim" })) return null;
        return updateForPickup({ id, actor: agentId, action: "claim" }, randomUUID());
      }),
    finishLobbyClaim: (claim, result) =>
      exclusive(async () => {
        const current = data.posts.find((p) => p.id === claim.id && PICKUP_BOARDS.has(p.board));
        if (
          current?.state === "claimed" &&
          current.seq === claim.seq &&
          current.claimedBy &&
          current.claimedBy === claim.claimedBy
        ) {
          await updateForPickup({
            id: current.id,
            action: "done",
            actor: current.claimedBy,
            ...(result === undefined ? {} : { note: result }),
          });
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
        // A lobby task takes its copy with it; a deleted copy only unlinks its lobby task.
        const partner = post.board === LOBBY ? partnerOf(post) : undefined;
        const gone = new Set([id, ...(partner ? [partner.id] : [])]);
        const posts = data.posts.filter((item) => !gone.has(item.id));
        const saved = await commit({ ...data, posts }, [
          post.board,
          ...(partner ? [partner.board] : []),
        ]);
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
    releaseClaims: (agentId) => exclusive(() => releaseHeld(agentId)),
    actDuty: (id, agentId) => exclusive(() => recordActed(id, agentId)),
  };
}
