import type { ChecklistStep, OfficeAgent, Post, WakeState } from "../shared/contracts.js";
import { LOBBY, USER_AUTHOR } from "../shared/names.js";
import {
  agentTitle,
  attentionReason,
  waitingOnText,
  type AgentTaskGroup,
  type OfficeRoom,
  type OfficeRow,
} from "../shared/model.js";
import { tabOf } from "./list-text.js";

/** How many posts a room card shows before it counts the rest. The board sheet shows them all. */
export const CARD_POSTS = 3;

/** The user sees their own posts as "You". */
export function authorName(author: string, agents: ReadonlyMap<string, OfficeAgent>): string {
  if (author === USER_AUTHOR) return "You";
  const agent = agents.get(author);
  return agent ? agentTitle(agent) : `Agent ${author.slice(0, 8)}`;
}

export function postStateLabel(post: Post, name: (author: string) => string): string {
  if (post.kind === "note") return "Note";
  if (post.state === "claimed" && post.claimedBy !== undefined) {
    return `Task · claimed by ${name(post.claimedBy)}`;
  }
  return `Task · ${post.state ?? "open"}`;
}

/** Where a claimed lobby task's copy is, or which lobby task a copy came from; null for neither. */
export function linkLabel(post: Post, name: (author: string) => string): string | null {
  if (post.link === undefined) return null;
  if (post.board !== LOBBY) return `from lobby task ${post.link}`;
  return post.claimedBy === undefined ? null : `on ${name(post.claimedBy)}'s board`;
}

/** Spec: a post that names an agent shows "from → to". */
export function postMeta(post: Post, name: (author: string) => string): string {
  const people =
    post.to === undefined ? name(post.author) : `${name(post.author)} → ${name(post.to)}`;
  const link = linkLabel(post, name);
  return `${postStateLabel(post, name)} · ${people}${link === null ? "" : ` · ${link}`}`;
}

/** Who claimed a to-do and whom it names; null when neither. A done to-do is no longer claimed. */
export function todoMeta(post: Post, name: (author: string) => string): string | null {
  const parts: string[] = [];
  if (post.state === "claimed" && post.claimedBy !== undefined) {
    parts.push(`claimed by ${name(post.claimedBy)}`);
  }
  if (post.to !== undefined) parts.push(`for ${name(post.to)}`);
  const link = linkLabel(post, name);
  if (link !== null) parts.push(link);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** A board's posts without the replies: a reply shows under its task, never on its own. */
export function topLevel(posts: readonly Post[]): Post[] {
  return posts.filter((post) => post.replyTo === undefined);
}

/** The notes under a task, oldest first. */
export function repliesOf(task: Post, posts: readonly Post[]): Post[] {
  return posts
    .filter((post) => post.kind === "note" && post.replyTo === task.id)
    .sort((left, right) => left.seq - right.seq);
}

/** A result's start, as a card shows it until More: the first three lines and 160 characters. */
export const RESULT_LINES = 3;
export const RESULT_CHARS = 160;

export interface ResultPreview {
  /** What the card shows; ends with "…" when some of the result is left out. */
  shown: string;
  /** Some was left out, so the card offers More. */
  cut: boolean;
}

/**
 * The start of a result, cut by its text rather than clamped by the layout: what is left out is
 * always behind More, and More shows only when something is.
 */
export function resultPreview(result: string): ResultPreview {
  const lines = result.split("\n");
  const head = lines.slice(0, RESULT_LINES).join("\n");
  if (lines.length <= RESULT_LINES && head.length <= RESULT_CHARS) {
    return { shown: result, cut: false };
  }
  return { shown: `${head.slice(0, RESULT_CHARS).trimEnd()}…`, cut: true };
}

/** What "Clear finished" asks before it deletes the done to-dos. */
export function clearQuestion(count: number): string {
  return count === 1 ? "Delete 1 finished to-do?" : `Delete ${count} finished to-dos?`;
}

function rank(post: Post): number {
  if (post.kind === "note") return 2;
  return post.state === "claimed" ? 1 : 0;
}

/** Open tasks, then claimed tasks, then notes; oldest first within each. */
export function orderBoardPosts(posts: readonly Post[]): Post[] {
  return [...posts].sort(
    (left, right) =>
      rank(left) - rank(right) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.seq - right.seq,
  );
}

export interface BoardPreview {
  shown: Post[];
  /** Posts the card leaves to the board sheet. */
  more: number;
}

/**
 * What a room card shows of its board: the first posts in board order, and how many are left.
 * Replies are counted with their task, so they are neither shown nor counted.
 */
export function boardPreview(posts: readonly Post[], max: number = CARD_POSTS): BoardPreview {
  const top = topLevel(posts);
  const shown = orderBoardPosts(top).slice(0, max);
  return { shown, more: top.length - shown.length };
}

/** What the lobby's card shows of its to-dos: the first unfinished ones, and how many are left. */
export function todoPreview(todos: readonly Post[], max: number = CARD_POSTS): BoardPreview {
  const unfinished = todos.filter((post) => post.state !== "done");
  const shown = unfinished.slice(0, max);
  return { shown, more: unfinished.length - shown.length };
}

/** The mark before an agent's checklist step: in progress, or waiting. */
export function stepMark(status: ChecklistStep["status"]): string {
  return status === "in_progress" ? "◐" : "○";
}

/**
 * What an agent is at, in words: who needs the user first, then who waits on sub-agents, then the
 * "doing now" line. The 3D whiteboard says the same of the person at the desk (`boardText` in
 * world/adapter.ts); a test holds the two together.
 */
export function workText(row: OfficeRow): string {
  const reason = attentionReason(row.agent);
  if (reason === "error") return "Stopped on an error";
  if (reason === "permission") return "Waiting for your answer";
  if (row.waitingOn > 0) return waitingOnText(row.waitingOn);
  const { status } = row.agent;
  return status === "running" || status === "initializing"
    ? (row.activity ?? "Working")
    : "Resting";
}

/** An agent as a board shows it: its row, and the unfinished steps of its own checklist. */
export interface BoardAgent {
  row: OfficeRow;
  steps: readonly ChecklistStep[];
}

/** A room's agents on the lobby's board. */
export interface BoardTeam {
  room: OfficeRoom;
  agents: BoardAgent[];
}

const NO_STEPS: readonly ChecklistStep[] = [];

function agentsOf(
  room: OfficeRoom,
  steps: ReadonlyMap<string, readonly ChecklistStep[]>,
): BoardAgent[] {
  return room.rows.map((row) => ({ row, steps: steps.get(row.agent.id) ?? NO_STEPS }));
}

function stepsByAgent(
  agentTasks: readonly AgentTaskGroup[],
): Map<string, readonly ChecklistStep[]> {
  return new Map(agentTasks.map((group) => [group.agentId, group.steps]));
}

/** Every agent of a room in the room's own order, for its board: whoever sits there is on it. */
export function roomAgents(room: OfficeRoom, agentTasks: readonly AgentTaskGroup[]): BoardAgent[] {
  return agentsOf(room, stepsByAgent(agentTasks));
}

/**
 * The lobby's board, room by room: whoever is at work or needs the user, and whoever has steps
 * left of a checklist. An agent that rests with nothing left is not on it, nor a room of only those.
 */
export function officeWork(
  rooms: readonly OfficeRoom[],
  agentTasks: readonly AgentTaskGroup[],
): BoardTeam[] {
  const steps = stepsByAgent(agentTasks);
  const teams: BoardTeam[] = [];
  for (const room of rooms) {
    const agents = agentsOf(room, steps).filter(
      (entry) => tabOf(entry.row) !== "resting" || entry.steps.length > 0,
    );
    if (agents.length > 0) teams.push({ room, agents });
  }
  return teams;
}

export function queuedWakes(wake: WakeState): number {
  return Object.values(wake.queued).reduce((sum, count) => sum + count, 0);
}

/**
 * The words beside the "Wake agents" switch: how many posts wait for their agents, or nothing.
 * That wakes are paused is the switch's own position, so it is not said again.
 */
export function wakeSummary(wake: WakeState): string | null {
  const queued = queuedWakes(wake);
  return queued > 0 ? `${queued} waiting` : null;
}
