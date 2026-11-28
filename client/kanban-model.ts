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

/** The column a post belongs in. The whole board is passed for later changes that read it. */
export function columnOf(post: Post, _posts: readonly Post[]): KanbanColumnId {
  if (post.kind === "note") return "notes";
  if (post.state === "done") return "done";
  if (post.state === "claimed") return "progress";
  return "todo";
}

/** The board's columns in order; empty ones left out except To do and In progress. */
export function kanbanColumns(posts: readonly Post[]): KanbanColumn[] {
  const bySeq = [...posts].sort((a, b) => a.seq - b.seq);
  const grouped = new Map<KanbanColumnId, Post[]>();
  for (const post of bySeq) {
    const id = columnOf(post, posts);
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
