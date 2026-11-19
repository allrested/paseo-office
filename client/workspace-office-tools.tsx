import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { agentTitle } from "../shared/model.js";
import { WorkspaceOverlay } from "./workspace-overlay.js";
import { ActionButton } from "./action-button.js";
import type { SessionContext } from "./session-pane.js";
import { SessionPane, sessionChildren, sessionOf } from "./session-pane.js";
import type { OfficeSurfaceProps } from "./office-surface.js";
import type { OfficeStyles } from "./styles.js";

interface Options {
  workspaceId: string | null;
  agentId: string | null;
  session: SessionContext;
  onSelect(agentId: string): void;
  onBoard(id: string): void;
  onClose(): void;
  styles: OfficeStyles;
  layout: OfficeSurfaceProps["layout"];
}

/** Work on this session or its room's board on clients without an embeddable web workspace. */
export function WorkspaceOfficeTools({
  workspaceId,
  agentId,
  session,
  styles,
  layout,
  onSelect,
  onBoard,
  onClose,
}: Options) {
  const room = session.model.rooms.find((r) => r.id === workspaceId);
  const openBoard = useCallback(() => {
    if (room) onBoard(room.id);
  }, [onBoard, room]);
  const context = useMemo(
    () => ({ actions: session.actions, closeSession: onClose }),
    [session.actions, onClose],
  );
  const selected = agentId ? sessionOf(session.model, agentId) : null;
  return (
    <View style={styles.columnBody}>
      {room && (
        <View style={styles.actions}>
          <ActionButton
            label="Workspace board"
            pendingLabel="Opening..."
            onPress={openBoard}
            styles={styles}
          />
        </View>
      )}
      {selected && agentId ? (
        <SessionPane
          subagents={sessionChildren(session.model, agentId)}
          onOpenSubagent={onSelect}
          agentId={agentId}
          agent={selected.agent}
          room={selected.room}
          reply={session.replies.texts.get(agentId) ?? ""}
          setReply={session.replies.setText}
          context={context}
          styles={styles}
          layout={layout}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.sessionList}>
          {room?.rows.length ? (
            room.rows.map(({ agent }) => (
              <WorkspaceAgent
                key={agent.id}
                id={agent.id}
                title={agentTitle(agent)}
                styles={styles}
                onSelect={onSelect}
              />
            ))
          ) : (
            <Text style={styles.muted}>No sessions in this workspace.</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}
function WorkspaceAgent({
  id,
  title,
  styles,
  onSelect,
}: {
  id: string;
  title: string;
  styles: OfficeStyles;
  onSelect(id: string): void;
}) {
  const open = useCallback(() => onSelect(id), [id, onSelect]);
  return <ActionButton label={title} pendingLabel="Opening..." styles={styles} onPress={open} />;
}

export type WorkspaceSelection = Pick<Options, "agentId" | "workspaceId">;
export function OfficeWorkspace({
  selection,
  hostId,
  ...tools
}: Omit<Options, keyof WorkspaceSelection> & {
  selection: WorkspaceSelection | null;
  hostId: string;
}) {
  if (!selection) return null;
  const room = tools.session.model.rooms.find((item) => item.id === selection.workspaceId);
  const title = room
    ? [...new Set([room.subtitle, room.name].filter(Boolean))].join(" · ")
    : "Workspace";
  return (
    <WorkspaceOverlay
      open
      hostId={hostId}
      {...selection}
      title={title}
      platform={tools.layout.platform}
      styles={tools.styles}
      onClose={tools.onClose}
    >
      <WorkspaceOfficeTools {...tools} {...selection} />
    </WorkspaceOverlay>
  );
}
