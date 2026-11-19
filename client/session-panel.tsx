import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import type { OfficeAgent } from "../shared/contracts.js";
import { agentTitle, answerableInOffice } from "../shared/model.js";
import { ActionButton, failureText } from "./action-button.js";
import { textAfterSend } from "./agent-card.js";
import { enterSends } from "./chat-text.js";
import type { ConversationRow } from "./conversation-model.js";
import { useFollowEnd } from "./follow-end.js";
import { hasTouchScreen, readPointer } from "./office-surface.js";
import { PermissionActions } from "./permission-actions.js";
import {
  ANSWER_IN_WORKSPACE,
  CANNOT_ANSWER_HERE,
  EARLIER_FAILED,
  GONE_LINE,
  LOADING,
  NOTHING_SAID,
  composerPlaceholder,
  rowLabel,
  statusLine,
} from "./session-text.js";
import type { OfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";
import { useConversation, type Conversation } from "./use-conversation.js";

export interface SessionPanelProps {
  /** Null once the agent has left the office: the panel says so and offers Close. */
  agent: OfficeAgent | null;
  agentId: string;
  /** The room's name, for the header. */
  room: string | null;
  actions: AgentActions;
  styles: OfficeStyles;
  layout: PluginSurfaceProps["layout"];
  /** Leaves the office for the agent's workspace; absent where the host cannot. */
  onOpenWorkspace: (() => void) | undefined;
  onClose(): void;
}

type KeyPress = NativeSyntheticEvent<
  TextInputKeyPressEventData & { shiftKey?: boolean; isComposing?: boolean }
>;

interface HeaderProps {
  agent: OfficeAgent | null;
  room: string | null;
  onOpenWorkspace: (() => void) | undefined;
  onClose(): void;
  styles: OfficeStyles;
}

function Header({ agent, room, onOpenWorkspace, onClose, styles }: HeaderProps) {
  return (
    <View style={styles.sessionHead}>
      {agent === null ? (
        <Text style={styles.muted}>{GONE_LINE}</Text>
      ) : (
        <>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {agentTitle(agent)}
          </Text>
          <Text style={styles.chatMeta}>{statusLine(agent, room)}</Text>
        </>
      )}
      <View style={styles.actions}>
        {onOpenWorkspace && agent !== null ? (
          <ActionButton
            label="Open in workspace"
            pendingLabel="Opening..."
            onPress={onOpenWorkspace}
            styles={styles}
          />
        ) : null}
        <ActionButton label="Close" pendingLabel="Closing..." onPress={onClose} styles={styles} />
      </View>
    </View>
  );
}

interface RowProps {
  row: ConversationRow;
  name: string;
  styles: OfficeStyles;
}

/** The rows are new objects each time the list is read, so a row is compared by what it shows. */
function sameRow(before: RowProps, after: RowProps): boolean {
  const [a, b] = [before.row, after.row];
  return (
    before.name === after.name &&
    before.styles === after.styles &&
    a.kind === b.kind &&
    a.key === b.key &&
    a.text === b.text &&
    (a.kind !== "notice" || (b.kind === "notice" && a.tone === b.tone))
  );
}

/** One line of the conversation; a streamed piece redraws only the row it changed. */
const Row = memo(function Row({ row, name, styles }: RowProps) {
  const label = rowLabel(row, name);
  if (row.kind === "tool") {
    return (
      <Text accessibilityLabel={label} selectable numberOfLines={1} style={styles.sessionTool}>
        {row.text}
      </Text>
    );
  }
  const danger = row.kind === "notice" && row.tone === "danger";
  let words = styles.chatText;
  if (row.kind === "notice") words = danger ? styles.bannerText : styles.chatMeta;
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={row.kind === "you" ? styles.sessionRowYou : styles.sessionRow}
    >
      {row.kind === "you" || row.kind === "agent" ? (
        <Text style={styles.chatName}>{row.kind === "you" ? "You" : name}</Text>
      ) : null}
      <Text selectable style={words}>
        {row.text}
      </Text>
    </View>
  );
}, sameRow);

function Alert({ text, styles }: { text: string; styles: OfficeStyles }) {
  return (
    <View style={styles.banner}>
      <Text accessibilityRole="alert" style={styles.bannerText}>
        {text}
      </Text>
    </View>
  );
}

interface RowsProps {
  conversation: Conversation;
  name: string;
  styles: OfficeStyles;
}

/** What the list holds: its state while it has none, else Show earlier and the rows. */
function Rows({ conversation, name, styles }: RowsProps): ReactNode {
  const { status, rows } = conversation;
  if (status === "loading") return <Text style={styles.muted}>{LOADING}</Text>;
  if (status === "error") {
    return (
      <>
        <Alert text={conversation.error ?? ""} styles={styles} />
        <ActionButton
          label="Retry"
          pendingLabel="Retrying..."
          onPress={conversation.retry}
          styles={styles}
        />
      </>
    );
  }
  return (
    <>
      {conversation.earlierFailed ? <Alert text={EARLIER_FAILED} styles={styles} /> : null}
      {conversation.hasEarlier ? (
        <View style={styles.actions}>
          <ActionButton
            label="Show earlier"
            pendingLabel="Loading..."
            onPress={conversation.loadEarlier}
            disabled={conversation.loadingEarlier}
            styles={styles}
          />
        </View>
      ) : null}
      {rows.length === 0 ? <Text style={styles.muted}>{NOTHING_SAID}</Text> : null}
      {rows.map((row) => (
        <Row key={row.key} row={row} name={name} styles={styles} />
      ))}
    </>
  );
}

interface AsksProps {
  agent: OfficeAgent;
  actions: AgentActions;
  /** Whether the panel can send the user to the agent's workspace. */
  canOpenWorkspace: boolean;
  styles: OfficeStyles;
}

/** The requests waiting on the agent: Approve and Deny where the office can answer. */
function Asks({ agent, actions, canOpenWorkspace, styles }: AsksProps) {
  return agent.permissions.map((permission) =>
    answerableInOffice(permission.kind) ? (
      <PermissionActions
        key={permission.id}
        agentId={agent.id}
        permission={permission}
        actions={actions}
        styles={styles}
      />
    ) : (
      <View key={permission.id} style={styles.permission}>
        <Text style={styles.permissionTitle}>{permission.title}</Text>
        {permission.detail === undefined ? null : (
          <Text style={styles.permissionDetail} numberOfLines={4}>
            {permission.detail}
          </Text>
        )}
        <Text style={styles.muted}>
          {canOpenWorkspace ? ANSWER_IN_WORKSPACE : CANNOT_ANSWER_HERE}
        </Text>
      </View>
    ),
  );
}

interface ComposerProps {
  agent: OfficeAgent;
  actions: AgentActions;
  touchScreen: boolean;
  styles: OfficeStyles;
}

function Composer({ agent, actions, touchScreen, styles }: ComposerProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Enter and the Send button can both fire before the first send returns.
  const sending = useRef(false);
  const agentId = agent.id;
  const send = useCallback(async () => {
    const sent = text.trim();
    if (sent === "" || sending.current) return;
    sending.current = true;
    try {
      // A reply to a working agent joins its turn: a plain send makes the daemon interrupt it.
      await actions.send(agentId, sent, { activeTurnBehavior: "steer" });
      setError(null);
      setText((current) => textAfterSend(current, sent));
    } catch (failure) {
      setError(failureText("Send", failure));
    }
    sending.current = false;
  }, [text, actions, agentId]);
  const stop = useCallback(() => actions.cancel?.(agentId), [actions, agentId]);
  const onKeyPress = useCallback(
    (event: KeyPress) => {
      const { nativeEvent } = event;
      // On a touch screen Enter is a new line; an IME's Enter picks a word.
      if (touchScreen || nativeEvent.isComposing === true || !enterSends(nativeEvent)) return;
      event.preventDefault();
      void send();
    },
    [touchScreen, send],
  );
  return (
    <View style={styles.sessionComposer}>
      <TextInput
        accessibilityLabel="Message"
        placeholder={composerPlaceholder(agent)}
        value={text}
        onChangeText={setText}
        onKeyPress={onKeyPress}
        multiline
        style={styles.input}
      />
      {error === null ? null : (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {error}
        </Text>
      )}
      <View style={styles.actions}>
        <ActionButton
          label="Send"
          pendingLabel="Sending..."
          onPress={send}
          disabled={text.trim() === ""}
          primary
          styles={styles}
        />
        {agent.status === "running" && actions.cancel !== null ? (
          <ActionButton label="Stop" pendingLabel="Stopping..." onPress={stop} styles={styles} />
        ) : null}
      </View>
    </View>
  );
}

/** One session in the column: its header, the conversation, the requests waiting, and a reply box. */
export function SessionPanel({
  agent,
  agentId,
  room,
  actions,
  styles,
  layout,
  onOpenWorkspace,
  onClose,
}: SessionPanelProps) {
  const conversation = useConversation(agentId);
  const { scroller, onScroll, followEnd } = useFollowEnd();
  const touchScreen = useMemo(
    () => hasTouchScreen(layout.platform, layout.platform === "web" ? readPointer() : null),
    [layout.platform],
  );
  const name = agent === null ? `Agent ${agentId.slice(0, 8)}` : agentTitle(agent);
  return (
    <View style={styles.screen}>
      <Header
        agent={agent}
        room={room}
        onOpenWorkspace={onOpenWorkspace}
        onClose={onClose}
        styles={styles}
      />
      <ScrollView
        ref={scroller}
        contentContainerStyle={styles.sessionList}
        onScroll={onScroll}
        onContentSizeChange={followEnd}
        onLayout={followEnd}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
      >
        <Rows conversation={conversation} name={name} styles={styles} />
      </ScrollView>
      {agent === null ? null : (
        <>
          <Asks
            agent={agent}
            actions={actions}
            canOpenWorkspace={onOpenWorkspace !== undefined}
            styles={styles}
          />
          <Composer agent={agent} actions={actions} touchScreen={touchScreen} styles={styles} />
        </>
      )}
    </View>
  );
}
