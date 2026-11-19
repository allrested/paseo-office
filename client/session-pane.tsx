import { useCallback, useMemo } from "react";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { agentTitle, dotTone, type OfficeModel } from "../shared/model.js";
import type { ColumnSession } from "./office-column.js";
import { SessionPanel } from "./session-panel.js";
import type { OfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";

/** The tab for an open session; one whose agent has left keeps a tab that names its id. */
export function sessionTabsOf(
  agentIds: readonly string[],
  agents: OfficeModel["agents"],
): ColumnSession[] {
  return agentIds.map((agentId) => {
    const agent = agents.get(agentId);
    return agent === undefined
      ? { agentId, title: `Agent ${agentId.slice(0, 8)}`, tone: "idle" }
      : { agentId, title: agentTitle(agent), tone: dotTone(agent) };
  });
}

/** What a session's panel takes from the surface it is drawn in. */
export interface SessionContext {
  model: OfficeModel;
  actions: AgentActions;
  navigation: PluginSurfaceProps["navigation"];
  closeSession(agentId: string): void;
}

export interface SessionPaneProps {
  agentId: string;
  context: SessionContext;
  styles: OfficeStyles;
  layout: PluginSurfaceProps["layout"];
}

/** One open session as the column or the sheet shows it. */
export function SessionPane({ agentId, context, styles, layout }: SessionPaneProps) {
  const { model, actions, navigation, closeSession } = context;
  const agent = model.agents.get(agentId) ?? null;
  const roomId = model.roomOfAgent.get(agentId);
  const room = model.rooms.find((candidate) => candidate.id === roomId)?.name ?? null;
  const onOpenWorkspace = useMemo(
    () => (navigation ? () => navigation.openAgent({ agentId }) : undefined),
    [navigation, agentId],
  );
  const onClose = useCallback(() => closeSession(agentId), [closeSession, agentId]);
  return (
    <SessionPanel
      key={agentId}
      agent={agent}
      agentId={agentId}
      room={room}
      actions={actions}
      styles={styles}
      layout={layout}
      onOpenWorkspace={onOpenWorkspace}
      onClose={onClose}
    />
  );
}
