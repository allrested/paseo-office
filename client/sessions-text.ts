import type { ChecklistProgress, OfficeAgent } from "../shared/contracts.js";
import { contextPercent } from "./context-text.js";
import { ACTIVITY_KINDS } from "../shared/names.js";
import { eventText } from "./activity-feed-text.js";
import { agentTask, agentTitle } from "../shared/model.js";
import type { OfficeModel, OfficeRoom, OfficeRow } from "../shared/model.js";
import { matchesQuery, tabOf, type ListTab } from "./list-text.js";

export const NO_AGENTS = "No agents yet.";

export interface SessionRow {
  row: OfficeRow;
  room: OfficeRoom;
}

const GROUP_ORDER: Record<Exclude<ListTab, "all">, number> = {
  attention: 0,
  working: 1,
  resting: 2,
};

/** When the agent last changed: its turn's end, else its last prompt, else its start. */
function changedAt(row: OfficeRow): number {
  const { agent } = row;
  const at = Date.parse(agent.idleSince ?? agent.promptedAt ?? agent.createdAt);
  return Number.isFinite(at) ? at : 0;
}

function byGroupThenNewest(left: SessionRow, right: SessionRow): number {
  return (
    GROUP_ORDER[tabOf(left.row)] - GROUP_ORDER[tabOf(right.row)] ||
    changedAt(right.row) - changedAt(left.row)
  );
}

/**
 * The Sessions panel's one list, across rooms: Needs you, then Working, then Resting, the newest
 * change first in each. A sub-agent follows its parent, indented, when the parent is shown; a
 * sub-agent whose parent the filter dropped stands on its own in its own place.
 */
export function sessionRows(model: OfficeModel, tab: ListTab, query: string): SessionRow[] {
  const matching: SessionRow[] = [];
  for (const room of model.rooms) {
    for (const row of room.rows) {
      if ((tab === "all" || tabOf(row) === tab) && matchesQuery(row, room, query)) {
        matching.push({ row, room });
      }
    }
  }
  matching.sort(byGroupThenNewest);
  const kept = new Set(matching.map(({ row }) => row.agent.id));
  const children = new Map<string, SessionRow[]>();
  const tops: SessionRow[] = [];
  for (const entry of matching) {
    const { agent } = entry.row;
    const parent = agent.parentAgentId;
    // The model's depth is per room; this list spans rooms, and a sub-agent in its own worktree
    // sits in another room than its parent.
    if (parent !== null && parent !== agent.id && kept.has(parent)) {
      const child = { ...entry, row: { ...entry.row, depth: 1 as const } };
      children.set(parent, [...(children.get(parent) ?? []), child]);
    } else {
      tops.push(entry.row.depth === 0 ? entry : { ...entry, row: { ...entry.row, depth: 0 } });
    }
  }
  const shown: SessionRow[] = [];
  const seen = new Set<string>();
  function visit(entry: SessionRow): void {
    if (seen.has(entry.row.agent.id)) return;
    seen.add(entry.row.agent.id);
    shown.push(entry);
    for (const child of children.get(entry.row.agent.id) ?? []) visit(child);
  }
  for (const entry of tops) visit(entry);
  // A parent chain that loops has no top row; its rows stand on their own rather than vanish.
  for (const entry of matching) visit({ ...entry, row: { ...entry.row, depth: 0 } });
  return shown;
}

/** The list's sections: the three the filters name, and the agents at home under them. */
export type SessionGroup = Exclude<ListTab, "all"> | "home";
export interface GroupedSession extends SessionRow {
  /** Levels of visible parents in this same status section. */
  level: number;
  parentTitle: string | null;
}

/** Keep approvals ahead of other work even when a sub-agent's parent has a different status. */
export function sessionSections(model: OfficeModel, tab: ListTab, query: string) {
  const sections: Record<SessionGroup, GroupedSession[]> = {
    attention: [],
    working: [],
    resting: [],
    home: [],
  };
  const levels = new Map<string, { group: SessionGroup; level: number }>();
  for (const entry of sessionRows(model, tab, query)) {
    const group = tabOf(entry.row);
    const parentId = entry.row.agent.parentAgentId;
    const parent =
      parentId && parentId !== entry.row.agent.id ? model.agents.get(parentId) : undefined;
    const above = parent ? levels.get(parent.id) : undefined;
    const level = above?.group === group ? above.level + 1 : 0;
    const parentTitle = parent && level === 0 ? agentTitle(parent) : null;
    sections[group].push({ ...entry, level, parentTitle });
    levels.set(entry.row.agent.id, { group, level });
  }
  // Those at home are in no room's rows. They rest, so All and Resting list them, the one that
  // left last first.
  if (tab === "all" || tab === "resting") {
    const lobby = model.rooms.find((room) => room.lobby);
    for (const agent of model.home.values()) {
      const roomId = model.roomOfAgent.get(agent.id);
      const room = model.rooms.find((candidate) => candidate.id === roomId) ?? lobby;
      if (room === undefined) continue;
      const row: OfficeRow = { agent, depth: 0, activity: null, step: null, waitingOn: 0 };
      if (!matchesQuery(row, room, query)) continue;
      sections.home.push({ row, room, level: 0, parentTitle: null });
    }
    sections.home.sort((left, right) => changedAt(right.row) - changedAt(left.row));
  }
  return sections;
}

/** A request, current activity or task is more useful than repeating "Idle" under Resting. */
export function sessionDetail({ row, room, parentTitle }: GroupedSession): string {
  const { agent } = row;
  const request = agent.permissions[0];
  if (request)
    return eventText("permission", { permissionKind: request.kind, title: request.title });
  if (agent.status === "error") return "Session error";
  if (row.waitingOn)
    return `Waiting on ${row.waitingOn} sub-agent${row.waitingOn === 1 ? "" : "s"}`;
  if (row.step) return eventText(row.step.kind, { failed: row.step.result === "failed" });
  if (row.activity) {
    const kind = ACTIVITY_KINDS.find((name) => name === row.activity);
    return kind ? eventText(kind) : row.activity;
  }
  if (parentTitle) return `Sub-agent of ${parentTitle}`;
  const task = agentTask(agent);
  if (task) return task;
  if (agent.status === "initializing") return "Starting session";
  if (agent.status === "closed") return "At home · a task or a reply brings it back";
  return room.workspace?.branch || agent.model || "";
}

export function avatarInitials(name: string): string {
  const words = name
    .trim()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((word) => Array.from(word)[0])
      .join("") || "•"
  ).toUpperCase();
}

/** Prefer reported task completion; a provider's context percentage has its own label and color. */
export function sessionMeter(agent: OfficeAgent, progress?: ChecklistProgress) {
  if (progress && progress.total > 0) {
    const { completed, total } = progress;
    return {
      kind: "tasks" as const,
      label: `${completed}/${total} tasks`,
      percent: Math.min(100, Math.round((100 * completed) / total)),
    };
  }
  const percent = contextPercent(agent);
  return percent === null
    ? null
    : { kind: "context" as const, label: `Context ${percent}%`, percent };
}
