export type ColumnTab = "attention" | "sessions" | "activity" | "chat";

/** The column's tabs, in their order. The icons are Lucide names. */
export const COLUMN_TABS: readonly { tab: ColumnTab; label: string; icon: string }[] = [
  { tab: "attention", label: "Attention", icon: "Bell" },
  { tab: "sessions", label: "Sessions", icon: "Users" },
  { tab: "activity", label: "Activity", icon: "Activity" },
  { tab: "chat", label: "Chat", icon: "MessageCircle" },
];

export const COLUMN_MIN = 280;
export const COLUMN_MAX = 560;
export const COLUMN_DEFAULT = 360;
/** What the floor keeps beside the column, while the surface is wide enough for both. */
export const FLOOR_MIN = 320;

/**
 * The column's width on a surface of `surface` px. Zero is a surface not measured yet: only the
 * column's own limits apply then.
 */
export function clampColumn(width: number, surface: number): number {
  const room = surface > 0 ? surface - FLOOR_MIN : COLUMN_MAX;
  const most = Math.max(COLUMN_MIN, Math.min(COLUMN_MAX, room));
  return Math.round(Math.min(most, Math.max(COLUMN_MIN, width)));
}

/** A tab's badge: nothing at zero, and no more than two digits. */
export function countLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

/** What the column shows: one of its fixed tabs, or an open session. */
export type ColumnView = { kind: "tab"; tab: ColumnTab } | { kind: "session"; agentId: string };

export interface SessionTabs {
  /** Open sessions, in the order they were opened. */
  open: readonly string[];
  view: ColumnView;
}

export const NO_SESSIONS: SessionTabs = {
  open: [],
  view: { kind: "tab", tab: "sessions" },
};

/** Opens the agent's session, or selects its tab when it is open already. */
export function openSession(tabs: SessionTabs, agentId: string): SessionTabs {
  const open = tabs.open.includes(agentId) ? tabs.open : [...tabs.open, agentId];
  return { open, view: { kind: "session", agentId } };
}

/** Closes it. When it was showing, the tab to its left shows: a session, or Sessions. */
export function closeSession(tabs: SessionTabs, agentId: string): SessionTabs {
  const index = tabs.open.indexOf(agentId);
  if (index < 0) return tabs;
  const open = tabs.open.filter((each) => each !== agentId);
  const shown = tabs.view.kind === "session" && tabs.view.agentId === agentId;
  if (!shown) return { open, view: tabs.view };
  const next = open[Math.max(0, index - 1)];
  if (next === undefined) return NO_SESSIONS;
  return { open, view: { kind: "session", agentId: next } };
}

export function showTab(tabs: SessionTabs, tab: ColumnTab): SessionTabs {
  if (tabs.view.kind === "tab" && tabs.view.tab === tab) return tabs;
  return { open: tabs.open, view: { kind: "tab", tab } };
}
