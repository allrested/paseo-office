import type { Post } from "../shared/contracts.js";
import type { OfficeModel } from "../shared/model.js";
import { authorName, textPreview } from "./board-text.js";

/** Why a task is on the Tasks card. Each kind has its own words and its own way on. */
export type TaskAttentionKind = "blocked"; // Change 4 adds "stalled", Change 9 "merged"

export interface TaskAttentionRow {
  kind: TaskAttentionKind;
  post: Post;
  /** The board it is on, by name: the room's, or "Lobby". */
  board: string;
  /** Who holds the task, by name; null when nobody does. */
  holder: string | null;
  /** What the holder needs, in its own words; null for a kind without one. */
  reason: string | null;
}

/** The order of the kinds on the card. */
const KIND_ORDER: readonly TaskAttentionKind[] = ["blocked"];

/** A task's text on the card: two lines at most, cut by its text. The board has the rest. */
export const TASK_LINES = 2;
export const TASK_CHARS = 120;

function isBlocked(post: Post): boolean {
  return post.kind === "task" && post.state === "claimed" && post.blocked !== undefined;
}

/**
 * Rows across every board of the model, blocked first, oldest first. A blocked lobby task and its
 * copy on the claimer's board carry the same mark, so the copy is left out while its lobby task
 * is listed. `now` is for kinds that go by age.
 */
export function taskAttentionRows(
  model: Pick<OfficeModel, "rooms" | "agents">,
  _now: number,
): TaskAttentionRow[] {
  const blocked = model.rooms.flatMap((room) =>
    room.posts.filter(isBlocked).map((post) => ({ room, post })),
  );
  const blockedLobby = new Set(blocked.filter(({ room }) => room.lobby).map(({ post }) => post.id));
  const rows: TaskAttentionRow[] = [];
  for (const { room, post } of blocked) {
    if (!room.lobby && post.link !== undefined && blockedLobby.has(post.link)) continue;
    rows.push({
      kind: "blocked",
      post,
      board: room.name,
      holder: post.claimedBy === undefined ? null : authorName(post.claimedBy, model.agents),
      reason: post.blocked ?? null,
    });
  }
  return rows.sort(
    (left, right) =>
      KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind) ||
      left.post.createdAt.localeCompare(right.post.createdAt) ||
      left.post.seq - right.post.seq,
  );
}

/** The card in a few words, for the strip; null when no task needs you. */
export function taskAttentionNote(rows: readonly TaskAttentionRow[]): string | null {
  if (rows.length === 0) return null;
  return rows.length === 1 ? "1 needs you" : `${rows.length} need you`;
}

/** A blocked row's line: "Builder needs: Which region?". */
export function blockedLine(row: Pick<TaskAttentionRow, "holder" | "reason">): string {
  const reason = row.reason ?? "";
  return row.holder === null ? `Needs you: ${reason}` : `${row.holder} needs: ${reason}`;
}

/** A task's text as the card shows it. */
export function taskPreview(text: string): string {
  return textPreview(text, TASK_LINES, TASK_CHARS).shown;
}
