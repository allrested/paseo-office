import { memo, useCallback, useMemo, type SetStateAction } from "react";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { OfficeAgent } from "../shared/contracts.js";
import { agentTitle, dotTone, type OfficeModel } from "../shared/model.js";
import type { ColumnSession } from "./office-column.js";
import { SessionPanel } from "./session-panel.js";
import type { OfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";
import type { ReplyDrafts } from "./use-reply-drafts.js";

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

/** What the surface holds for its sessions: the model, and what a pane takes of it. */
export interface SessionContext extends SessionPaneContext {
  model: OfficeModel;
  replies: ReplyDrafts;
}

/** What a pane takes from the surface, the same for every session; never the office model. */
export interface SessionPaneContext {
  actions: AgentActions;
  showWorkspace?(agentId: string): void;
  closeSession(agentId: string): void;
}

/** One agent as the office lists it, and the name of its room: all a session's panel reads of the model. */
export function sessionOf(
  model: OfficeModel,
  agentId: string,
): { agent: OfficeAgent | null; room: string | null } {
  const roomId = model.roomOfAgent.get(agentId);
  return {
    agent: model.agents.get(agentId) ?? null,
    room: model.rooms.find((candidate) => candidate.id === roomId)?.name ?? null,
  };
}

export function sessionChildren(model: OfficeModel, agentId: string): OfficeAgent[] {
  return [...model.agents.values()].filter((agent) => agent.parentAgentId === agentId);
}

export interface SessionPaneProps {
  agentId: string;
  hideClose?: boolean;
  inSheet?: boolean;
  subagents?: readonly OfficeAgent[];
  onOpenSubagent?(id: string): void;
  /** The agent as the office lists it; null when it does not. */
  agent: OfficeAgent | null;
  room: string | null;
  /** What is typed in this session's reply box, and where a change to it goes. */
  reply: string;
  setReply: ReplyDrafts["setText"];
  context: SessionPaneContext;
  styles: OfficeStyles;
  layout: PluginSurfaceProps["layout"];
}

/**
 * The office's agents arrive as new objects with every update, so the pane compares its agent by
 * what it holds: another agent's change, or the same agent again, does not draw it.
 */
function samePane(before: SessionPaneProps, after: SessionPaneProps): boolean {
  return (
    before.agentId === after.agentId &&
    before.room === after.room &&
    before.inSheet === after.inSheet &&
    before.hideClose === after.hideClose &&
    before.reply === after.reply &&
    before.setReply === after.setReply &&
    before.context.actions === after.context.actions &&
    before.context.showWorkspace === after.context.showWorkspace &&
    before.context.closeSession === after.context.closeSession &&
    before.onOpenSubagent === after.onOpenSubagent &&
    JSON.stringify(before.subagents) === JSON.stringify(after.subagents) &&
    before.styles === after.styles &&
    before.layout === after.layout &&
    JSON.stringify(before.agent) === JSON.stringify(after.agent)
  );
}

/** One open session as the column or the sheet shows it. */
export const SessionPane = memo(function SessionPane({
  agentId,
  hideClose,
  inSheet,
  subagents,
  onOpenSubagent,
  agent,
  room,
  reply,
  setReply,
  context,
  styles,
  layout,
}: SessionPaneProps) {
  const { actions, showWorkspace, closeSession } = context;
  const draft = useMemo(
    () => ({ text: reply, setText: (next: SetStateAction<string>) => setReply(agentId, next) }),
    [reply, setReply, agentId],
  );
  const onOpenWorkspace = useMemo(
    () => (showWorkspace ? () => showWorkspace(agentId) : undefined),
    [showWorkspace, agentId],
  );
  const onClose = useCallback(() => closeSession(agentId), [closeSession, agentId]);
  return (
    <SessionPanel
      key={agentId}
      agent={agent}
      agentId={agentId}
      room={room}
      subagents={subagents}
      onOpenSubagent={onOpenSubagent}
      draft={draft}
      actions={actions}
      styles={styles}
      layout={layout}
      onOpenWorkspace={onOpenWorkspace}
      hideClose={hideClose}
      inSheet={inSheet}
      onClose={onClose}
    />
  );
}, samePane);
