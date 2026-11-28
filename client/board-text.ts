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
import { isWaiting } from "./kanban-model.js";
import { waitingOn } from "../shared/board-rules.js";

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

/** A roster team's name by its id; the id itself once the team is gone. */
export type TeamNamer = (teamId: string) => string;

/** Spec: a post that names an agent shows "from → to"; a lobby task for a team says which. */
export function postMeta(
  post: Post,
  name: (author: string) => string,
  teamName: TeamNamer,
): string {
  const people =
    post.to === undefined ? name(post.author) : `${name(post.author)} → ${name(post.to)}`;
  const forTeam = post.team === undefined ? "" : ` · for team ${teamName(post.team)}`;
  const link = linkLabel(post, name);
  return `${postStateLabel(post, name)} · ${people}${forTeam}${link === null ? "" : ` · ${link}`}`;
}

/** Who claimed a to-do and whom or which team it names; null when none. A done to-do is no longer claimed. */
export function todoMeta(
  post: Post,
  name: (author: string) => string,
  teamName: TeamNamer,
): string | null {
  const parts: string[] = [];
  if (post.state === "claimed" && post.claimedBy !== undefined) {
    parts.push(`claimed by ${name(post.claimedBy)}`);
  }
  if (post.to !== undefined) parts.push(`for ${name(post.to)}`);
  if (post.team !== undefined) parts.push(`for team ${teamName(post.team)}`);
  const link = linkLabel(post, name);
  if (link !== null) parts.push(link);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The posts of every board: what a task that waits needs to find the tasks it waits on. */
export function allPosts(rooms: readonly OfficeRoom[]): Post[] {
  const byId = new Map<string, Post>();
  for (const room of rooms) {
    for (const post of [...room.posts, ...room.todos, ...room.done]) byId.set(post.id, post);
  }
  return [...byId.values()];
}

/**
 * The line over a task's thread that says where it stands after another: "Waiting on p12, p13"
 * (the ones still holding it) while it waits, "After p12, p13" once it is released, so where it
 * came from stays visible. Null for a task that is after none.
 */
export function afterLine(post: Post, all: readonly Post[]): string | null {
  if (post.after === undefined || post.after.length === 0) return null;
  return isWaiting(post, all)
    ? `Waiting on ${waitingOn(post, all).join(", ")}`
    : `After ${post.after.join(", ")}`;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A span as "under a minute", "23 min", "1 h 5 min" or "1 d 3 h"; the smaller unit left out at 0. */
function spanText(ms: number): string {
  if (ms < MINUTE_MS) return "under a minute";
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)} min`;
  if (ms < DAY_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
    return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
  }
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  return hours === 0 ? `${days} d` : `${days} d ${hours} h`;
}

/**
 * What a done task took: "took 23 min · $0.42", from its holder's claim to done, with what the
 * holder spent when the provider reported a cost. Null unless the task is done and both times read.
 */
export function taskSpent(post: Post): string | null {
  if (post.state !== "done" || post.claimedAt === undefined || post.doneAt === undefined) {
    return null;
  }
  const from = Date.parse(post.claimedAt);
  const to = Date.parse(post.doneAt);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  const time = `took ${spanText(Math.max(0, to - from))}`;
  const cost = post.spentUsd;
  if (cost === undefined || cost <= 0) return time;
  return `${time} · ${cost < 0.01 ? "under $0.01" : `$${cost.toFixed(2)}`}`;
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

/** The start of a text: its first `lines` lines and `chars` characters, and "…" when cut. */
export function textPreview(text: string, lines: number, chars: number): ResultPreview {
  const all = text.split("\n");
  const head = all.slice(0, lines).join("\n");
  if (all.length <= lines && head.length <= chars) return { shown: text, cut: false };
  return { shown: `${head.slice(0, chars).trimEnd()}…`, cut: true };
}

/**
 * The start of a result, cut by its text rather than clamped by the layout: what is left out is
 * always behind More, and More shows only when something is.
 */
export function resultPreview(result: string): ResultPreview {
  return textPreview(result, RESULT_LINES, RESULT_CHARS);
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
