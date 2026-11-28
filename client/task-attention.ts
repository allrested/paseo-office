import type { Post } from "../shared/contracts.js";
import type { OfficeModel } from "../shared/model.js";
import { authorName, textPreview } from "./board-text.js";

/** Why a task is on the Tasks card. Each kind has its own words and its own way on. */
export type TaskAttentionKind = "blocked" | "stalled" | "merged";

export interface TaskAttentionRow {
  kind: TaskAttentionKind;
  post: Post;
  /** The board it is on, by name: the room's, "Lobby", or "Duty board" for a duty. */
  board: string;
  /** Who holds the task, by name; null when nobody does. */
  holder: string | null;
  /** What the holder needs, in its own words; null for a kind without one. */
  reason: string | null;
  /** Why a stalled claim is listed: its holder stopped on an error, has been idle, or is at home. */
  cause?: StallCause;
  /** A merged row's pull request as "#42 Fix the ledger total"; absent when the model has neither. */
  pullRequest?: string;
}

export type StallCause = "error" | "idle" | "home";

/**
 * What the rows are worked out from: the rooms' boards and the duty board, and who holds what, in
 * the office or at home.
 */
export type TaskAttentionModel = Pick<
  OfficeModel,
  "rooms" | "duties" | "agents" | "home" | "roomOfAgent"
>;

/** What a duty's row calls its board: the duty board is no room, and has no name of its own. */
export const DUTY_BOARD_NAME = "Duty board";

/** The order of the kinds on the card. */
const KIND_ORDER: readonly TaskAttentionKind[] = ["blocked", "stalled", "merged"];

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

/**
 * Why a claim nobody works on is stalled, or null while its holder is at it or is not an agent
 * here. A holder at home keeps its claim and does nothing until it is woken, so it is listed at once.
 */
function stallCause(
  post: Post,
  now: number,
  { agents, home }: Pick<TaskAttentionModel, "agents" | "home">,
): StallCause | null {
  if (post.kind !== "task" || post.state !== "claimed" || post.blocked !== undefined) return null;
  if (post.claimedBy === undefined) return null;
  if (home.has(post.claimedBy)) return "home";
  const status = agents.get(post.claimedBy)?.status;
  if (status === "error") return "error";
  return status === "idle" && now - Date.parse(post.updatedAt) >= STALL_MS ? "idle" : null;
}

/**
 * A claim whose holder's pull request is merged, as "#42 Fix the ledger total": the work is in, so
 * the task is likely done. Null while the holder is no agent here, sits in the lobby or has none
 * merged. One workspace can hold several tasks, so this only offers; it never marks anything.
 */
function mergedPullRequest(
  post: Post,
  model: Pick<OfficeModel, "rooms" | "agents" | "roomOfAgent">,
): string | null {
  if (post.kind !== "task" || post.state !== "claimed" || post.claimedBy === undefined) return null;
  if (!model.agents.has(post.claimedBy)) return null;
  const roomId = model.roomOfAgent.get(post.claimedBy);
  const pullRequest = model.rooms.find((room) => room.id === roomId)?.workspace?.pullRequest;
  if (pullRequest?.state !== "merged") return null;
  const name = [pullRequest.number === null ? "" : `#${pullRequest.number}`, pullRequest.title]
    .filter((part) => part !== "")
    .join(" ");
  return name;
}

/** A board whose posts are looked through: a room's, or the duty board's duties. */
interface Board {
  name: string;
  lobby: boolean;
  posts: readonly Post[];
}

interface Found {
  board: Board;
  post: Post;
  kind: TaskAttentionKind;
  cause?: StallCause;
  pullRequest?: string;
}

/**
 * Rows across every board of the model, the duty board included, blocked first, then stalled, then
 * merged, each oldest first. A lobby task and its copy on the claimer's board carry the same mark,
 * so the copy is left out while its lobby task is listed. `now` is for the kinds that go by age.
 */
export function taskAttentionRows(model: TaskAttentionModel, now: number): TaskAttentionRow[] {
  // A holder at home is named as it is in the office.
  const holderName = (id: string) => authorName(id, model.home.has(id) ? model.home : model.agents);
  const boards: Board[] = [
    ...model.rooms.map((room) => ({ name: room.name, lobby: room.lobby, posts: room.posts })),
    { name: DUTY_BOARD_NAME, lobby: false, posts: model.duties.map((row) => row.post) },
  ];
  const found = boards.flatMap((board) =>
    board.posts.flatMap((post): Found[] => {
      if (isBlocked(post)) return [{ board, post, kind: "blocked" }];
      const cause = stallCause(post, now, model);
      if (cause !== null) return [{ board, post, kind: "stalled", cause }];
      const pullRequest = mergedPullRequest(post, model);
      return pullRequest === null
        ? []
        : [{ board, post, kind: "merged", ...(pullRequest === "" ? {} : { pullRequest }) }];
    }),
  );
  const listedInLobby = new Set(
    found.filter(({ board }) => board.lobby).map(({ post }) => post.id),
  );
  const rows: TaskAttentionRow[] = [];
  for (const { board, post, kind, cause, pullRequest } of found) {
    if (!board.lobby && post.link !== undefined && listedInLobby.has(post.link)) continue;
    rows.push({
      kind,
      post,
      board: board.name,
      holder: post.claimedBy === undefined ? null : holderName(post.claimedBy),
      reason: post.blocked ?? null,
      ...(cause === undefined ? {} : { cause }),
      ...(pullRequest === undefined ? {} : { pullRequest }),
    });
  }
  return rows.sort(
    (left, right) =>
      KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind) ||
      left.post.createdAt.localeCompare(right.post.createdAt) ||
      left.post.seq - right.post.seq,
  );
}

/** The card in a few words, for the strip: "2 need you · 1 stalled · 2 merged"; null when nothing is on it. */
export function taskAttentionNote(rows: readonly TaskAttentionRow[]): string | null {
  const count = (kind: TaskAttentionKind) => rows.filter((row) => row.kind === kind).length;
  const blocked = count("blocked");
  const stalled = count("stalled");
  const merged = count("merged");
  const parts: string[] = [];
  if (blocked > 0) parts.push(blocked === 1 ? "1 needs you" : `${blocked} need you`);
  if (stalled > 0) parts.push(`${stalled} stalled`);
  if (merged > 0) parts.push(`${merged} merged`);
  return parts.length === 0 ? null : parts.join(" · ");
}

/** A blocked row's line: "Builder needs: Which region?". */
export function blockedLine(row: Pick<TaskAttentionRow, "holder" | "reason">): string {
  const reason = row.reason ?? "";
  return row.holder === null ? `Needs you: ${reason}` : `${row.holder} needs: ${reason}`;
}

/** A stalled row's line: "Builder stopped on an error", "Builder is idle" or "Builder is at home". */
export function stalledLine(row: Pick<TaskAttentionRow, "holder" | "cause">): string {
  const holder = row.holder ?? "Nobody";
  if (row.cause === "home") return `${holder} is at home`;
  return row.cause === "error" ? `${holder} stopped on an error` : `${holder} is idle`;
}

/** A merged row's line: "Builder's pull request is merged: #42 Fix the ledger total". */
export function mergedLine(row: Pick<TaskAttentionRow, "holder" | "pullRequest">): string {
  const line = `${row.holder ?? "Nobody"}'s pull request is merged`;
  return row.pullRequest === undefined ? line : `${line}: ${row.pullRequest}`;
}

/** A task's text as the card shows it. */
export function taskPreview(text: string): string {
  return textPreview(text, TASK_LINES, TASK_CHARS).shown;
}
