import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
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
import { SegmentPill } from "./segment-pill.js";
import { SessionIdentity, SubagentRow } from "./session-panel-detail.js";
import {
  ANSWER_IN_WORKSPACE,
  CANNOT_ANSWER_HERE,
  EARLIER_FAILED,
  LOADING,
  NOTHING_SAID,
  SENDING_DENIES,
  UNLISTED_LINE,
  composerPlaceholder,
  rowLabel,
} from "./session-text.js";
import type { OfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";
import { useConversation, type Conversation } from "./use-conversation.js";

/** What is typed in the reply box, kept by the surface. */
export interface ReplyDraft {
  text: string;
  /** Takes an updater as well: a send that returns keeps what was typed while it was away. */
  setText(next: SetStateAction<string>): void;
}

export interface SessionPanelProps {
  /** Null while the office does not list the agent: the panel says so, with Close and the way on. */
  agent: OfficeAgent | null;
  agentId: string;
  /** The reply box's text: the surface's, so it outlives the panel. */
  draft: ReplyDraft;
  /** The room's name, for the header. */
  room: string | null;
  actions: AgentActions;
  styles: OfficeStyles;
  layout: PluginSurfaceProps["layout"];
  /** Leaves the office for the agent's workspace; absent where the host cannot. */
  onOpenWorkspace: (() => void) | undefined;
  onClose(): void;
  subagents?: readonly OfficeAgent[];
  onOpenSubagent?(id: string): void;
}

type SessionDetailTab = "chat" | "steps" | "subagents";

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
        <Text style={styles.muted}>{UNLISTED_LINE}</Text>
      ) : (
        <SessionIdentity agent={agent} room={room} styles={styles} />
      )}
      <View style={styles.actions}>
        {onOpenWorkspace ? (
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
      style={row.kind === "you" ? styles.chatRowMine : styles.chatRow}
    >
      <View style={row.kind === "you" ? styles.chatBubbleMine : styles.chatBubble}>
        {row.kind === "you" || row.kind === "agent" ? (
          <Text style={styles.chatName}>{row.kind === "you" ? "You" : name}</Text>
        ) : null}
        <Text selectable style={words}>
          {row.text}
        </Text>
      </View>
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
  steps: boolean;
  name: string;
  styles: OfficeStyles;
}

/** What the list holds: its state while it has none, else Show earlier and the rows. */
function Rows({ conversation, steps, name, styles }: RowsProps): ReactNode {
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
  const shown = steps ? rows.filter((row) => row.kind === "tool" || row.kind === "notice") : rows;
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
      {shown.length === 0 ? (
        <Text style={styles.muted}>{steps ? "No steps in the loaded history." : NOTHING_SAID}</Text>
      ) : null}
      {shown.map((row) => (
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
  draft: ReplyDraft;
  actions: AgentActions;
  touchScreen: boolean;
  styles: OfficeStyles;
}

function Composer({ agent, draft, actions, touchScreen, styles }: ComposerProps) {
  const { text, setText } = draft;
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
  }, [text, setText, actions, agentId]);
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
      {agent.permissions.length > 0 ? (
        <Text style={styles.composerWarning}>{SENDING_DENIES}</Text>
      ) : null}
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
  draft,
  room,
  actions,
  styles,
  layout,
  onOpenWorkspace,
  onClose,
  subagents,
  onOpenSubagent,
}: SessionPanelProps) {
  const conversation = useConversation(agentId);
  const [tab, setTab] = useState<SessionDetailTab>("chat");
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
      <View style={styles.segments} role="group" aria-label="Session details">
        <SegmentPill<SessionDetailTab>
          value="chat"
          name="Session chat"
          text="Chat"
          on={tab === "chat"}
          disabled={false}
          onPress={setTab}
          styles={styles}
        />
        <SegmentPill<SessionDetailTab>
          value="steps"
          name="Session steps"
          text="Steps"
          on={tab === "steps"}
          disabled={false}
          onPress={setTab}
          styles={styles}
        />
        {subagents && onOpenSubagent && (
          <SegmentPill<SessionDetailTab>
            value="subagents"
            name="Session subagents"
            text={subagents.length ? `Subagents · ${subagents.length}` : "Subagents"}
            on={tab === "subagents"}
            disabled={false}
            onPress={setTab}
            styles={styles}
          />
        )}
      </View>
      <ScrollView
        ref={scroller}
        contentContainerStyle={styles.sessionList}
        onScroll={onScroll}
        onContentSizeChange={followEnd}
        onLayout={followEnd}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
      >
        {tab === "subagents" && subagents && onOpenSubagent ? (
          <>
            {subagents.length === 0 && (
              <Text style={styles.muted}>No subagents in this session.</Text>
            )}
            {subagents.map((child) => (
              <SubagentRow key={child.id} agent={child} onOpen={onOpenSubagent} styles={styles} />
            ))}
          </>
        ) : (
          <Rows conversation={conversation} steps={tab === "steps"} name={name} styles={styles} />
        )}
      </ScrollView>
      {agent === null ? null : (
        <>
          <Asks
            agent={agent}
            actions={actions}
            canOpenWorkspace={onOpenWorkspace !== undefined}
            styles={styles}
          />
          <Composer
            agent={agent}
            draft={draft}
            actions={actions}
            touchScreen={touchScreen}
            styles={styles}
          />
        </>
      )}
    </View>
  );
}
