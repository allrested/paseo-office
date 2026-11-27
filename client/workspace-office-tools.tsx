import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { Text } from "./text.js";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import type { OfficeRoom } from "../shared/model.js";
import { WorkspaceOverlay } from "./workspace-overlay.js";
import { SubagentRow } from "./session-panel-detail.js";
import { NO_REPLY_IMAGES } from "./reply-send.js";
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
function WorkspaceOfficeTools({
  room,
  agentId,
  session,
  styles,
  layout,
  onSelect,
  onClose,
}: Omit<Options, "workspaceId" | "onBoard"> & { room: OfficeRoom | undefined }) {
  const context = useMemo(
    () => ({ actions: session.actions, closeSession: onClose }),
    [session.actions, onClose],
  );
  const selected = agentId ? sessionOf(session.model, agentId) : null;
  return (
    <View style={styles.columnBody}>
      {selected && agentId ? (
        <SessionPane
          hideClose
          subagents={sessionChildren(session.model, agentId)}
          onOpenSubagent={onSelect}
          agentId={agentId}
          agent={selected.agent}
          room={selected.room}
          reply={session.replies.texts.get(agentId) ?? ""}
          setReply={session.replies.setText}
          replyImages={session.replies.images.get(agentId) ?? NO_REPLY_IMAGES}
          setReplyImages={session.replies.setImages}
          context={context}
          styles={styles}
          layout={layout}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.sessionList}>
          {room?.rows.length ? (
            room.rows.map(({ agent }) => (
              <SubagentRow key={agent.id} agent={agent} onOpen={onSelect} styles={styles} />
            ))
          ) : (
            <Text style={styles.muted}>No sessions in this workspace.</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}
export type WorkspaceSelection = Pick<Options, "agentId" | "workspaceId">;
export function OfficeWorkspace({
  selection,
  hostId,
  onBoard,
  ...tools
}: Omit<Options, keyof WorkspaceSelection> & {
  selection: WorkspaceSelection | null;
  hostId: string;
}) {
  const room = tools.session.model.rooms.find((item) => item.id === selection?.workspaceId);
  const boardId = room?.id;
  const openBoard = useCallback(() => {
    if (boardId) onBoard(boardId);
  }, [onBoard, boardId]);
  if (!selection) return null;
  const title = room
    ? [...new Set([room.subtitle, room.name].filter(Boolean))].join(" · ")
    : "Workspace";
  return (
    <WorkspaceOverlay
      key={selection.workspaceId ?? hostId}
      dockRequest={selection}
      onBoard={room ? openBoard : undefined}
      hostId={hostId}
      {...selection}
      title={title}
      platform={tools.layout.platform}
      styles={tools.styles}
      onClose={tools.onClose}
    >
      <WorkspaceOfficeTools {...tools} room={room} agentId={selection.agentId} />
    </WorkspaceOverlay>
  );
}
