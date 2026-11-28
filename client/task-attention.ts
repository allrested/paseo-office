import type { Post } from "../shared/contracts.js";
import type { OfficeModel, OfficeRoom } from "../shared/model.js";
import { authorName, textPreview } from "./board-text.js";

/** Why a task is on the Tasks card. Each kind has its own words and its own way on. */
export type TaskAttentionKind = "blocked" | "stalled"; // Change 9 adds "merged"

export interface TaskAttentionRow {
  kind: TaskAttentionKind;
  post: Post;
  /** The board it is on, by name: the room's, or "Lobby". */
  board: string;
  /** Who holds the task, by name; null when nobody does. */
  holder: string | null;
  /** What the holder needs, in its own words; null for a kind without one. */
  reason: string | null;
  /** Why a stalled claim is listed: its holder stopped on an error, or has been idle. */
  cause?: "error" | "idle";
}

/** The order of the kinds on the card. */
const KIND_ORDER: readonly TaskAttentionKind[] = ["blocked", "stalled"];

/** How long an idle holder may sit on a claim before the card lists it. */
export const STALL_MS = 120_000;

/** What Nudge says: a reply from the user, which wakes an idle holder. */
export const NUDGE_TEXT =
  "Status check: finish with office_update done and a short result, or block with what you need.";

/** A task's text on the card: two lines at most, cut by its text. The board has the rest. */
export const TASK_LINES = 2;
export const TASK_CHARS = 120;

function isBlocked(post: Post): boolean {
  return post.kind === "task" && post.state === "claimed" && post.blocked !== undefined;
}

/** Why a claim nobody works on is stalled, or null while its holder is at it or is not an agent here. */
function stallCause(
  post: Post,
  now: number,
  agents: OfficeModel["agents"],
): "error" | "idle" | null {
  if (post.kind !== "task" || post.state !== "claimed" || post.blocked !== undefined) return null;
  const status = post.claimedBy === undefined ? undefined : agents.get(post.claimedBy)?.status;
  if (status === "error") return "error";
  return status === "idle" && now - Date.parse(post.updatedAt) >= STALL_MS ? "idle" : null;
}

interface Found {
  room: OfficeRoom;
  post: Post;
  kind: TaskAttentionKind;
  cause?: "error" | "idle";
}

/**
 * Rows across every board of the model, blocked first, then stalled, each oldest first. A lobby
 * task and its copy on the claimer's board carry the same mark, so the copy is left out while its
 * lobby task is listed. `now` is for the kinds that go by age.
 */
export function taskAttentionRows(
  model: Pick<OfficeModel, "rooms" | "agents">,
  now: number,
): TaskAttentionRow[] {
  const found = model.rooms.flatMap((room) =>
    room.posts.flatMap((post): Found[] => {
      if (isBlocked(post)) return [{ room, post, kind: "blocked" }];
      const cause = stallCause(post, now, model.agents);
      return cause === null ? [] : [{ room, post, kind: "stalled", cause }];
    }),
  );
  const listedInLobby = new Set(found.filter(({ room }) => room.lobby).map(({ post }) => post.id));
  const rows: TaskAttentionRow[] = [];
  for (const { room, post, kind, cause } of found) {
    if (!room.lobby && post.link !== undefined && listedInLobby.has(post.link)) continue;
    rows.push({
      kind,
      post,
      board: room.name,
      holder: post.claimedBy === undefined ? null : authorName(post.claimedBy, model.agents),
      reason: post.blocked ?? null,
      ...(cause === undefined ? {} : { cause }),
    });
  }
  return rows.sort(
    (left, right) =>
      KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind) ||
      left.post.createdAt.localeCompare(right.post.createdAt) ||
      left.post.seq - right.post.seq,
  );
}

/** The card in a few words, for the strip: "2 need you · 1 stalled"; null when nothing is on it. */
export function taskAttentionNote(rows: readonly TaskAttentionRow[]): string | null {
  const count = (kind: TaskAttentionKind) => rows.filter((row) => row.kind === kind).length;
  const blocked = count("blocked");
  const stalled = count("stalled");
  const parts: string[] = [];
  if (blocked > 0) parts.push(blocked === 1 ? "1 needs you" : `${blocked} need you`);
  if (stalled > 0) parts.push(`${stalled} stalled`);
  return parts.length === 0 ? null : parts.join(" · ");
}

/** A blocked row's line: "Builder needs: Which region?". */
export function blockedLine(row: Pick<TaskAttentionRow, "holder" | "reason">): string {
  const reason = row.reason ?? "";
  return row.holder === null ? `Needs you: ${reason}` : `${row.holder} needs: ${reason}`;
}

/** A stalled row's line: "Builder stopped on an error" or "Builder is idle". */
export function stalledLine(row: Pick<TaskAttentionRow, "holder" | "cause">): string {
  const holder = row.holder ?? "Nobody";
  return row.cause === "error" ? `${holder} stopped on an error` : `${holder} is idle`;
}

/** A task's text as the card shows it. */
export function taskPreview(text: string): string {
  return textPreview(text, TASK_LINES, TASK_CHARS).shown;
}
