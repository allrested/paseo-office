import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import { COLUMN_SESSIONS_MAX, officeColumnSettings } from "../shared/settings.js";
import {
  COLUMN_DEFAULT,
  NO_SESSIONS,
  closeSession as closeTab,
  openSession as openTab,
  showTab,
  type ColumnTab,
  type ColumnView,
} from "./column-model.js";

interface ColumnValues {
  width: number;
  collapsed: boolean;
  /** The open session tabs, kept so a reload brings them back. */
  sessions?: string[];
}

const DEFAULTS: ColumnValues = { width: COLUMN_DEFAULT, collapsed: false };

export interface ColumnState {
  /** What the column shows: a fixed tab or an open session. */
  view: ColumnView;
  /** The open sessions' agent ids, in the order they were opened. */
  sessions: readonly string[];
  /** The stored width, not yet clamped to a surface. */
  width: number;
  collapsed: boolean;
  /** Selects the tab and, on a wide surface, opens a collapsed column. */
  show(tab: ColumnTab): void;
  /** Opens the agent's session as a tab, or selects it; on a wide surface opens a collapsed column. */
  openSession(agentId: string): void;
  closeSession(agentId: string): void;
  setCollapsed(next: boolean): void;
  setWidth(next: number): void;
}

/**
 * The column's state. The open sessions and the chosen tab live as long as the surface; the width
 * and collapsed are the device's. A change shows at once and is saved behind it; one the device
 * refuses holds until the office is closed. On a compact surface `collapsed` has no effect, so
 * opening a tab or a session there leaves the saved one as the wide layout left it.
 */
export function useColumn(compact: boolean): ColumnState {
  const settings = useSettings(officeColumnSettings);
  const stored = settings.status === "ready" ? settings.values : null;
  const revision =
    settings.status === "ready" || settings.status === "invalid" ? settings.revision : null;
  const { save } = settings;
  const [local, setLocal] = useState<Partial<ColumnValues>>({});
  const [tabs, setTabs] = useState(NO_SESSIONS);
  const width = local.width ?? stored?.width ?? DEFAULTS.width;
  const collapsed = local.collapsed ?? stored?.collapsed ?? DEFAULTS.collapsed;
  // The tabs a reload left behind come back once, when the device's document is first read.
  const restored = useRef(false);
  useEffect(() => {
    if (stored === null || restored.current) return;
    restored.current = true;
    const kept = stored.sessions ?? [];
    if (kept.length > 0)
      setTabs((current) => (current.open.length > 0 ? current : { ...current, open: kept }));
  }, [stored]);
  const change = useCallback(
    (patch: Partial<ColumnValues>) => {
      setLocal((current) => ({ ...current, ...patch }));
      if (revision === null) return;
      // Every save writes the document whole: the tabs go along with the width, and the width with the tabs.
      const sessions = (patch.sessions ?? tabs.open).slice(-COLUMN_SESSIONS_MAX);
      void save({ width, collapsed, ...patch, sessions }, revision);
    },
    [save, revision, width, collapsed, tabs.open],
  );
  const show = useCallback(
    (next: ColumnTab) => {
      setTabs((current) => showTab(current, next));
      if (collapsed && !compact) change({ collapsed: false });
    },
    [collapsed, compact, change],
  );
  const openSession = useCallback(
    (agentId: string) => {
      const next = openTab(tabs, agentId);
      setTabs(next);
      change({
        sessions: [...next.open],
        ...(collapsed && !compact ? { collapsed: false } : {}),
      });
    },
    [tabs, collapsed, compact, change],
  );
  const closeSession = useCallback(
    (agentId: string) => {
      const next = closeTab(tabs, agentId);
      setTabs(next);
      if (next !== tabs) change({ sessions: [...next.open] });
    },
    [tabs, change],
  );
  const setCollapsed = useCallback((next: boolean) => change({ collapsed: next }), [change]);
  const setWidth = useCallback((next: number) => change({ width: next }), [change]);
  return useMemo(
    () => ({
      view: tabs.view,
      sessions: tabs.open,
      width,
      collapsed,
      show,
      openSession,
      closeSession,
      setCollapsed,
      setWidth,
    }),
    [tabs, width, collapsed, show, openSession, closeSession, setCollapsed, setWidth],
  );
}
