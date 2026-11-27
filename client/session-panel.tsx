import { AppearanceEditor } from "./agent-appearance.js";
import { useCallback, useMemo, useRef, useState, type ReactNode, type SetStateAction } from "react";
import {
  Text,
  View,
  type LayoutChangeEvent,
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
import { useFollowEnd } from "./follow-end.js";
import { hasTouchScreen, readPointer } from "./office-surface.js";
import { PermissionActions } from "./permission-actions.js";
import { AskCard } from "./ask-card.js";
import {
  SessionButton,
  SessionDetailTabs,
  SessionHeading,
  SessionMetadata,
  SubagentRow,
  type SessionDetailTab,
} from "./session-panel-detail.js";
import {
  ANSWER_IN_WORKSPACE,
  CANNOT_ANSWER_HERE,
  EARLIER_FAILED,
  LOADING,
  SENDING_DENIES,
  UNLISTED_LINE,
  composerPlaceholder,
} from "./session-text.js";
import { SessionTranscript } from "./session-transcript.js";
import type { OfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";
import { useConversation, type Conversation } from "./use-conversation.js";
import { useUiCards } from "./use-ui-cards.js";

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
  /** The workspace dialog already provides a close control. */
  hideClose?: boolean;
  inSheet?: boolean;
  subagents?: readonly OfficeAgent[];
  onOpenSubagent?(id: string): void;
}

type KeyPress = NativeSyntheticEvent<
  TextInputKeyPressEventData & { shiftKey?: boolean; isComposing?: boolean }
>;

function Header({
  agent,
  room,
  onOpenWorkspace,
  onClose,
  hideClose,
  inSheet,
  styles,
}: Pick<
  SessionPanelProps,
  "agent" | "room" | "onOpenWorkspace" | "onClose" | "hideClose" | "inSheet" | "styles"
>) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const [editing, setEditing] = useState(false);
  const edit = useCallback(() => setEditing(true), []);
  const closeEditor = useCallback(() => setEditing(false), []);
  if (inSheet) {
    return (
      <View style={styles.sessions.sheetTools}>
        {!agent && <Text style={styles.muted}>{UNLISTED_LINE}</Text>}
        <View style={styles.sessions.sheetActionRow}>
          {onOpenWorkspace && (
            <SessionButton
              label="Open in workspace"
              icon="PanelsTopLeft"
              caption="button"
              onPress={onOpenWorkspace}
              styles={styles}
            />
          )}
          {agent && (
            <SessionButton
              label="Session details"
              icon={expanded ? "ChevronUp" : "ChevronDown"}
              expanded={expanded}
              caption="plain"
              onPress={toggle}
              styles={styles}
            />
          )}
        </View>
        {expanded && agent && (
          <View style={styles.sessions.sheetDetails}>
            <SessionMetadata agent={agent} styles={styles} />
            <SessionButton
              label="Customize agent"
              icon="Pencil"
              caption="plain"
              onPress={edit}
              styles={styles}
            />
          </View>
        )}
        {agent && editing && (
          <AppearanceEditor key={agent.id} agent={agent} styles={styles} close={closeEditor} />
        )}
      </View>
    );
  }
  return (
    <View style={styles.sessions.deskHead}>
      <View style={styles.sessions.identityRow}>
        {agent === null ? (
          <View style={styles.columnBody}>
            <Text style={styles.muted}>{UNLISTED_LINE}</Text>
          </View>
        ) : (
          <View style={styles.sessions.identity}>
            <SessionHeading agent={agent} room={room} styles={styles} />
            <SessionMetadata agent={agent} styles={styles} />
          </View>
        )}
        {agent && (
          <SessionButton label="Customize agent" icon="Pencil" onPress={edit} styles={styles} />
        )}
        {agent && editing && (
          <AppearanceEditor key={agent.id} agent={agent} styles={styles} close={closeEditor} />
        )}
        {!hideClose && <SessionButton label="Close" icon="X" onPress={onClose} styles={styles} />}
      </View>
      {onOpenWorkspace && (
        <SessionButton
          label="Open in workspace"
          icon="ArrowUpRight"
          caption="plain"
          onPress={onOpenWorkspace}
          styles={styles}
        />
      )}
    </View>
  );
}

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
  appearance?: OfficeAgent["appearance"];
  conversation: Conversation;
  steps: boolean;
  name: string;
  uiCards: boolean;
  styles: OfficeStyles;
}

/** What the list holds: its state while it has none, else Show earlier and the rows. */
function Rows({ conversation, steps, name, appearance, uiCards, styles }: RowsProps): ReactNode {
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
      <SessionTranscript
        appearance={appearance}
        rows={rows}
        steps={steps}
        name={name}
        uiCards={uiCards}
        styles={styles}
      />
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
      <AskCard
        key={permission.id}
        agentId={agent.id}
        permission={permission}
        actions={actions}
        fallback={canOpenWorkspace ? ANSWER_IN_WORKSPACE : CANNOT_ANSWER_HERE}
        styles={styles}
      />
    ),
  );
}

interface ComposerProps {
  agent: OfficeAgent;
  draft: ReplyDraft;
  actions: AgentActions;
  touchScreen: boolean;
  styles: OfficeStyles;
  focused: boolean;
  setFocused(value: boolean): void;
}

function Composer({
  agent,
  draft,
  actions,
  touchScreen,
  styles,
  focused,
  setFocused,
}: ComposerProps) {
  const { text, setText } = draft;
  const [error, setError] = useState<string | null>(null);
  // Enter and the Send button can both fire before the first send returns.
  const sending = useRef(false);
  const [pending, setPending] = useState(false);
  const focus = useCallback(() => setFocused(true), [setFocused]);
  const blur = useCallback(() => setFocused(false), [setFocused]);
  const shell = useMemo(
    () => [styles.sessions.replyShell, focused && styles.sessions.replyFocused],
    [styles, focused],
  );
  const agentId = agent.id;
  const send = useCallback(async () => {
    const sent = text.trim();
    if (sent === "" || sending.current) return;
    sending.current = true;
    setPending(true);
    try {
      // A reply to a working agent joins its turn: a plain send makes the daemon interrupt it.
      await actions.send(agentId, sent, { activeTurnBehavior: "steer" });
      setError(null);
      setText((current) => textAfterSend(current, sent));
    } catch (failure) {
      setError(failureText("Send", failure));
    }
    sending.current = false;
    setPending(false);
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
    <View style={styles.sessions.deskComposer}>
      <View style={shell}>
        <TextInput
          accessibilityLabel="Message"
          placeholder={composerPlaceholder(agent)}
          placeholderTextColor={styles.placeholderColor}
          value={text}
          onChangeText={setText}
          onKeyPress={onKeyPress}
          onFocus={focus}
          onBlur={blur}
          multiline
          numberOfLines={Math.min(4, text.split("\n", 4).length)}
          style={styles.sessions.replyInput}
        />
        {agent.status === "running" && actions.cancel !== null && (
          <ActionButton label="Stop" pendingLabel="Stopping..." onPress={stop} styles={styles} />
        )}
        <SessionButton
          label={pending ? "Sending..." : "Send"}
          icon={pending ? "Ellipsis" : "ArrowUp"}
          onPress={send}
          disabled={text.trim() === "" || pending}
          primary
          styles={styles}
        />
      </View>
      {agent.permissions.length > 0 && <Text style={styles.composerWarning}>{SENDING_DENIES}</Text>}
      {error !== null && (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {error}
        </Text>
      )}
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
  hideClose,
  inSheet,
  subagents,
  onOpenSubagent,
}: SessionPanelProps) {
  const conversation = useConversation(agentId);
  const uiCards = useUiCards();
  const [tab, setTab] = useState<SessionDetailTab>("chat");
  const { scroller, onScroll, followEnd } = useFollowEnd();
  const touchScreen = useMemo(
    () => hasTouchScreen(layout.platform, layout.platform === "web" ? readPointer() : null),
    [layout.platform],
  );
  const nativeDialog = inSheet && layout.platform !== "web";
  const [focused, setFocused] = useState(false);
  const [short, setShort] = useState(false);
  const measureBody = useCallback((event: LayoutChangeEvent) => {
    // Keep room for the transcript and a four-line draft on a short keyboard-open sheet.
    setShort(event.nativeEvent.layout.height < 280);
  }, []);
  const name = agent === null ? `Agent ${agentId.slice(0, 8)}` : agentTitle(agent);
  const requests = agent && (
    <Asks
      agent={agent}
      actions={actions}
      canOpenWorkspace={onOpenWorkspace !== undefined}
      styles={styles}
    />
  );
  return (
    <View style={styles.screen} onLayout={nativeDialog ? measureBody : undefined}>
      <View style={short && focused ? styles.hidden : undefined}>
        <Header
          agent={agent}
          room={room}
          onOpenWorkspace={onOpenWorkspace}
          onClose={onClose}
          hideClose={hideClose}
          inSheet={inSheet}
          styles={styles}
        />
        <SessionDetailTabs
          tab={tab}
          setTab={setTab}
          childCount={onOpenSubagent ? subagents?.length : undefined}
          styles={styles}
        />
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
          <Rows
            appearance={agent?.appearance}
            conversation={conversation}
            steps={tab === "steps"}
            name={name}
            uiCards={uiCards}
            styles={styles}
          />
        )}
        {nativeDialog && requests}
      </ScrollView>
      {agent === null ? null : (
        <>
          {!nativeDialog && requests}
          <Composer
            focused={focused}
            setFocused={setFocused}
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
