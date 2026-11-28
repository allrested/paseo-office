import { waitingOn } from "../shared/board-rules.js";
import type { Post } from "../shared/contracts.js";

/** The kanban columns, in the order they show left to right. */
export type KanbanColumnId = "waiting" | "todo" | "progress" | "needs" | "done" | "notes";

export interface KanbanColumn {
  id: KanbanColumnId;
  title: string;
  /** In board order (by seq). */
  posts: Post[];
}

const TITLES: Record<KanbanColumnId, string> = {
  waiting: "Waiting",
  todo: "To do",
  progress: "In progress",
  needs: "Needs you",
  done: "Done",
  notes: "Notes",
};

const ORDER: readonly KanbanColumnId[] = ["waiting", "todo", "progress", "needs", "done", "notes"];

/** To do and In progress stay on the board even when empty, so the lanes never vanish. */
const ALWAYS_SHOWN: ReadonlySet<KanbanColumnId> = new Set(["todo", "progress"]);

/**
 * Whether a task waits: it is open, and a task it is after is not done. A claimed or done task
 * never waits, whatever its `after`: the user, or an agent already holding it, went ahead.
 */
export function isWaiting(post: Post, all: readonly Post[]): boolean {
  return post.kind === "task" && post.state === "open" && waitingOn(post, all).length > 0;
}

/**
 * The column a post belongs in. `all` is the posts of every board, not only this one's: what a
 * task waits on can be a task on another.
 */
export function columnOf(post: Post, all: readonly Post[]): KanbanColumnId {
  if (post.kind === "note") return "notes";
  if (post.state === "done") return "done";
  if (post.state === "claimed") return post.blocked === undefined ? "progress" : "needs";
  return isWaiting(post, all) ? "waiting" : "todo";
}

/**
 * The board's columns in order; empty ones left out except To do and In progress. A reply is in
 * none of them: it shows on its task's card. `all` is the posts of every board (`allPosts`), for
 * the tasks that wait on one; it is the board's own when the board is all there is.
 */
export function kanbanColumns(
  posts: readonly Post[],
  all: readonly Post[] = posts,
): KanbanColumn[] {
  const bySeq = posts.filter((post) => post.replyTo === undefined).sort((a, b) => a.seq - b.seq);
  const grouped = new Map<KanbanColumnId, Post[]>();
  for (const post of bySeq) {
    const id = columnOf(post, all);
    const column = grouped.get(id);
    if (column === undefined) grouped.set(id, [post]);
    else column.push(post);
  }
  return ORDER.filter((id) => grouped.has(id) || ALWAYS_SHOWN.has(id)).map((id) => ({
    id,
    title: TITLES[id],
    posts: grouped.get(id) ?? [],
  }));
}

/** The width from which the board shows its columns side by side. */
export const KANBAN_WIDE = 720;

/** Whether a board this wide shows the kanban columns side by side. */
export function kanbanWide(width: number): boolean {
  return width >= KANBAN_WIDE;
}
