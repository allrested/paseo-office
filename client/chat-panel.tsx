import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from "react";
import {
  Pressable,
  Image,
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type ViewStyle,
} from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { CHAT_TEXT_MAX, chatRpc, type ChatMessage, type ChatRequest } from "../shared/contracts.js";
import { agentTitle, buildOfficeModel } from "../shared/model.js";
import { failureText } from "./action-button.js";
import { ChatHeader } from "./chat-chrome.js";
import { PromptCoach } from "./prompt-coach.js";
import { tabOf } from "./list-text.js";
import type { ChatShortcuts } from "./chat-more.js";
import { ComposeTools } from "./chat-compose-tools.js";
import { messengerTheme } from "./messenger-styles.js";
import { loadProblem } from "./activity-panel.js";
import {
  CHAT_EMPTY,
  CHAT_RECALLED,
  REACTION_CHOICES,
  RECALL_MS,
  SHOW_MORE_LINES,
  STICKERS,
  avatarOf,
  canRecall,
  counterText,
  enterSends,
  isLong,
  isYours,
  mentionAt,
  mentionOptions,
  pollRows,
  putMention,
  reactionRows,
  remindState,
  shows,
  timeLabel,
  typingText,
  type MentionOption,
} from "./chat-text.js";
import { getChatSeen, markChatSeen } from "./chat-seen.js";
import { useFollowEnd } from "./follow-end.js";
import type { ChatDraft, ColumnPanelProps, OfficeLink } from "./office-link.js";
import { hasTouchScreen, readPointer } from "./office-surface.js";
import { useOfficeStyles, type OfficeStyles } from "./styles.js";

/** Sends a request to the chat; false when it failed, and the error is then under the box. */
type Run = (input: ChatRequest) => Promise<boolean>;

/** On the web a key press carries the browser's keyboard event. */
type KeyPress = NativeSyntheticEvent<
  TextInputKeyPressEventData & { shiftKey?: boolean; isComposing?: boolean }
>;

/**
 * The box after a send went through: what was sent leaves the start of it, and what was typed
 * while the call ran stays. A box changed at its start is left as it is.
 */
function textAfterSend(current: string, sent: string): string {
  const rest = current.trimStart();
  return rest.startsWith(sent) ? rest.slice(sent.length).trimStart() : current;
}

/** A message's words where it is quoted: a sticker's own words, else its text. */
function quotedText(message: ChatMessage): string {
  return message.kind === "sticker" ? (STICKERS[message.sticker ?? 0] ?? "") : message.text;
}

/**
 * What a message's buttons tell it. A pressable row loses its hover to a pressable inside it
 * (docs/hover.md), so the buttons keep the row's actions shown while one has the pointer or the
 * focus.
 */
interface Keep {
  hover(on: boolean): void;
  focus(on: boolean): void;
}

interface ChatButtonProps<Value> {
  label: string;
  value: Value;
  onPress(value: Value): void;
  styles: OfficeStyles;
  /** A toggle says whether it is on: pressed for a button, checked for a radio. */
  on?: boolean;
  radio?: boolean;
  keep?: Keep;
  /** A message's small pill unless given, outlined while on. */
  style?: ViewStyle;
  /** The label in the pill unless given. */
  children?: ReactNode;
}

/** A pill in the chat: the view switch's hover and press fill over its style. */
function ChatButton<Value>({
  label,
  value,
  onPress,
  styles,
  on,
  radio = false,
  keep,
  style,
  children,
}: ChatButtonProps<Value>) {
  const press = useCallback(() => onPress(value), [onPress, value]);
  const [hovered, setHovered] = useState(false);
  // What this button holds of its message's Keep, given back when it leaves.
  const held = useRef({ hover: false, focus: false });
  const hoverIn = useCallback(() => {
    setHovered(true);
    held.current.hover = true;
    keep?.hover(true);
  }, [keep]);
  const hoverOut = useCallback(() => {
    setHovered(false);
    held.current.hover = false;
    keep?.hover(false);
  }, [keep]);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  const focus = useCallback(() => {
    held.current.focus = true;
    keep?.focus(true);
  }, [keep]);
  const blur = useCallback(() => {
    held.current.focus = false;
    keep?.focus(false);
  }, [keep]);
  // A button that leaves (Show more, a picked reaction, Recall running out) gets no hover-out or
  // blur.
  useEffect(() => {
    const now = held.current;
    return () => {
      if (now.hover) keep?.hover(false);
      if (now.focus) keep?.focus(false);
    };
  }, [keep]);
  return (
    <Pressable
      accessibilityRole={radio ? "radio" : "button"}
      accessibilityLabel={label}
      aria-pressed={radio ? undefined : on}
      aria-checked={radio ? on : undefined}
      onPress={press}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      onFocus={focus}
      onBlur={blur}
      style={style ?? (on === true ? styles.chatReactionOn : styles.chatReaction)}
    >
      {hovered || pressed ? <View style={styles.segmentHoverFill} /> : null}
      {children ?? <Text style={styles.chatMeta}>{label}</Text>}
    </Pressable>
  );
}

/** The sender's initials on a disc in their floor colour; the name beside it says who it is. */
function Avatar({
  initials,
  color,
  styles,
}: {
  initials: string;
  color: string;
  styles: OfficeStyles;
}) {
  const disc = useMemo(() => ({ ...styles.chatAvatar, backgroundColor: color }), [styles, color]);
  return (
    <View aria-hidden style={disc}>
      <Text style={styles.chatAvatarText}>{initials}</Text>
    </View>
  );
}

function Quote({ name, text, styles }: { name: string; text: string; styles: OfficeStyles }) {
  return (
    <View style={styles.chatQuote}>
      <Text style={styles.chatName} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.chatMeta} numberOfLines={2}>
        {text}
      </Text>
    </View>
  );
}

interface BodyProps {
  message: ChatMessage;
  /** The sender is an agent on the floor, so its session can be opened. */
  onFloor: boolean;
  link: OfficeLink;
  run: Run;
  keep: Keep;
  styles: OfficeStyles;
}

/** Words, clipped at eight lines until Show more. */
function TextBody({ message, keep, styles }: BodyProps) {
  const [expanded, setExpanded] = useState(false);
  const expand = useCallback(() => setExpanded(true), []);
  const clipped = !expanded && isLong(message.text);
  return (
    <>
      <Text style={styles.chatText} numberOfLines={clipped ? SHOW_MORE_LINES : 0}>
        {message.text}
      </Text>
      {clipped ? (
        <View style={styles.chatActions}>
          <ChatButton label="Show more" value="more" onPress={expand} keep={keep} styles={styles} />
        </View>
      ) : null}
    </>
  );
}

/** The question, then each option with its count; yours is checked, and a press votes. */
function PollBody({ message, run, keep, styles }: BodyProps) {
  const { id } = message;
  const vote = useCallback((index: number) => void run({ op: "vote", id, index }), [run, id]);
  return (
    <>
      <Text style={styles.chatText}>{message.text}</Text>
      <View role="radiogroup" aria-label={message.text} style={styles.pickerRows}>
        {pollRows(message).map((option) => (
          <ChatButton
            key={option.index}
            label={`${option.text}, ${option.count}`}
            value={option.index}
            onPress={vote}
            radio
            on={option.mine}
            keep={keep}
            styles={styles}
          />
        ))}
      </View>
    </>
  );
}

/** The reminder's title, its time and who is going; Going and Not going until it has come round. */
function RemindBody({ message, run, keep, styles }: BodyProps) {
  const { id } = message;
  const answer = useCallback((yes: boolean) => void run({ op: "rsvp", id, yes }), [run, id]);
  const state = remindState(message);
  if (state === null) return null;
  return (
    <>
      <Text style={styles.chatText}>{message.text}</Text>
      <Text style={styles.chatMeta}>
        {state.when} · {state.going} going
      </Text>
      {state.done ? null : (
        <View style={styles.chatActions}>
          <ChatButton
            label="Going"
            value
            onPress={answer}
            on={state.yours === "yes"}
            keep={keep}
            styles={styles}
          />
          <ChatButton
            label="Not going"
            value={false}
            onPress={answer}
            on={state.yours === "no"}
            keep={keep}
            styles={styles}
          />
        </View>
      )}
    </>
  );
}

function OfficePhoto({ photo, styles }: { photo: string; styles: OfficeStyles }) {
  const source = useMemo(() => ({ uri: photo }), [photo]);
  return (
    <Image
      accessibilityLabel="Office photo"
      accessible
      source={source}
      resizeMode="contain"
      style={styles.messenger.photo}
    />
  );
}
function Body(props: BodyProps) {
  const { message, styles } = props;
  if (message.recalled === true) return <Text style={styles.chatMeta}>{CHAT_RECALLED}</Text>;
  switch (message.kind) {
    case "photo":
      return message.photo ? <OfficePhoto photo={message.photo} styles={styles} /> : null;
    case "sticker":
      return (
        <View style={styles.chatChip}>
          <Text style={styles.chatText}>{STICKERS[message.sticker ?? 0] ?? ""}</Text>
        </View>
      );
    case "poll":
      return <PollBody {...props} />;
    case "remind":
      return <RemindBody {...props} />;
    default:
      return <TextBody {...props} />;
  }
}

/** Each reaction with its count, yours pressed; a press sends that emoji, which takes yours back. */
function Reactions({ message, run, keep, styles }: BodyProps) {
  const { id } = message;
  const react = useCallback((emoji: string) => void run({ op: "react", id, emoji }), [run, id]);
  const rows = reactionRows(message);
  if (rows.length === 0) return null;
  return (
    <View style={styles.chatReactions}>
      {rows.map((reaction) => (
        <ChatButton
          key={reaction.emoji}
          label={`${reaction.emoji} ${reaction.count}`}
          value={reaction.emoji}
          onPress={react}
          on={reaction.mine}
          keep={keep}
          styles={styles}
        />
      ))}
    </View>
  );
}

interface ActionsProps extends BodyProps {
  shown: boolean;
  inline: boolean;
  recallable: boolean;
  picking: boolean;
  onPicking(): void;
  onReply(message: ChatMessage): void;
}

/** React, Reply and Recall; React opens the six reactions under them. */
function Actions({
  message,
  run,
  keep,
  styles,
  shown,
  inline,
  recallable,
  picking,
  onPicking,
  onReply,
}: ActionsProps) {
  const { id } = message;
  const floating = shown ? styles.messenger.tools : styles.messenger.toolsHidden;
  const reply = useCallback(() => onReply(message), [onReply, message]);
  const recall = useCallback(() => void run({ op: "recall", id }), [run, id]);
  const pin = useCallback(() => void run({ op: "pin", id }), [run, id]);
  const choose = useCallback(
    (emoji: string) => {
      onPicking();
      void run({ op: "react", id, emoji });
    },
    [onPicking, run, id],
  );
  return (
    <>
      <View style={inline ? styles.chatActions : floating}>
        <ChatButton
          label="React"
          value="react"
          onPress={onPicking}
          on={picking}
          keep={keep}
          styles={styles}
        />
        <ChatButton label="Reply" value="reply" onPress={reply} keep={keep} styles={styles} />
        <ChatButton label="Pin message" value="pin" onPress={pin} keep={keep} styles={styles}>
          <Icon name="Pin" size={13} color={styles.iconColor} />
        </ChatButton>
        {recallable ? (
          <ChatButton label="Recall" value="recall" onPress={recall} keep={keep} styles={styles} />
        ) : null}
      </View>
      {picking ? (
        <View style={styles.chatReactions}>
          {REACTION_CHOICES.map((emoji) => (
            <ChatButton
              key={emoji}
              label={emoji}
              value={emoji}
              onPress={choose}
              keep={keep}
              styles={styles}
            />
          ))}
        </View>
      ) : null}
    </>
  );
}

/** Whether your message can still be recalled; it turns false when the server's limit passes. */
function useRecallable(message: ChatMessage): boolean {
  const recallable = canRecall(message, Date.now());
  const [, expire] = useReducer((count: number) => count + 1, 0);
  const { at } = message;
  useEffect(() => {
    if (!recallable) return undefined;
    const timer = setTimeout(expire, at + RECALL_MS - Date.now() + 1);
    return () => clearTimeout(timer);
  }, [recallable, at]);
  return recallable;
}

interface ChatRowProps {
  message: ChatMessage;
  onFloor: boolean;
  /** A touch screen, where nothing hovers. */
  always: boolean;
  link: OfficeLink;
  run: Run;
  onReply(message: ChatMessage): void;
  styles: OfficeStyles;
}

/**
 * One message: an agent's on the left with its avatar, name and time, yours on the right. Its
 * actions show on hover and focus on the web, and always on a touch screen.
 */
const ChatRow = memo(function ChatRow({
  message,
  onFloor,
  always,
  link,
  run,
  onReply,
  styles,
}: ChatRowProps) {
  const mine = isYours(message);
  const avatar = avatarOf(message);
  const time = timeLabel(message.at, Date.now());
  const recallable = useRecallable(message);
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [inner, setInner] = useState(false);
  const [focused, setFocused] = useState(false);
  const keep = useMemo<Keep>(() => ({ hover: setInner, focus: setFocused }), []);
  const openSender = useCallback(() => {
    if (message.from !== undefined) link.openSession(message.from);
  }, [link, message.from]);
  const senderName = (
    <Text style={styles.chatName} numberOfLines={1}>
      {message.name ?? ""}
    </Text>
  );
  const [picking, setPicking] = useState(false);
  const togglePicking = useCallback(() => setPicking((open) => !open), []);
  const body: BodyProps = { message, onFloor, link, run, keep, styles };
  return (
    <Pressable
      testID={`chat-${message.id}`}
      tabIndex={-1}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={mine ? styles.chatRowMine : styles.chatRow}
    >
      {avatar === null ? null : (
        <Avatar initials={avatar.initials} color={avatar.color} styles={styles} />
      )}
      <View style={mine ? styles.chatBubbleMine : styles.chatBubble}>
        {!mine && (
          <View style={styles.boardHeading}>
            {onFloor ? (
              <ChatButton
                label="Open session"
                value="sender"
                onPress={openSender}
                keep={keep}
                style={styles.boardHeading}
                styles={styles}
              >
                {senderName}
                <Icon name="ArrowUpRight" size={11} color={styles.iconColor} />
              </ChatButton>
            ) : (
              senderName
            )}
          </View>
        )}
        {message.reply ? (
          <Quote name={message.reply.name} text={message.reply.text} styles={styles} />
        ) : null}
        <Body {...body} />
        <Text style={styles.chatMeta}>{time}</Text>
        {message.recalled === true ? null : <Reactions {...body} />}
        {message.recalled === true ? null : (
          <Actions
            {...body}
            shown={always || hovered || inner || focused || picking}
            inline={always || picking}
            recallable={recallable}
            picking={picking}
            onPicking={togglePicking}
            onReply={onReply}
          />
        )}
      </View>
    </Pressable>
  );
});

interface MessagesProps {
  messages: readonly ChatMessage[];
  emptyLabel: string;
  firstUnread?: string;
  /** The agents on the floor. */
  agents: ReadonlyMap<string, unknown>;
  problem: string | null;
  always: boolean;
  link: OfficeLink;
  run: Run;
  onReply(message: ChatMessage): void;
  styles: OfficeStyles;
}

/** The conversation, oldest first; a state that cannot load says so in its place. */
function Messages({
  messages,
  emptyLabel,
  firstUnread,
  agents,
  problem,
  always,
  link,
  run,
  onReply,
  styles,
}: MessagesProps) {
  if (problem !== null) {
    return (
      <View style={styles.banner}>
        <Text accessibilityRole="alert" style={styles.bannerText}>
          {problem}
        </Text>
      </View>
    );
  }
  if (messages.length === 0) return <Text style={styles.messenger.empty}>{emptyLabel}</Text>;
  return messages.map((message) => (
    <Fragment key={message.id}>
      {message.id === firstUnread && (
        <View style={styles.messenger.unread}>
          <View style={styles.messenger.unreadRule} />
          <Text style={styles.messenger.unreadText}>New messages</Text>
          <View style={styles.messenger.unreadRule} />
        </View>
      )}
      {message.kind === "sys" ? (
        <Text testID={`chat-${message.id}`} style={styles.chatSystem}>
          {message.text}
        </Text>
      ) : (
        <ChatRow
          message={message}
          onFloor={message.from !== undefined && agents.has(message.from)}
          always={always}
          link={link}
          run={run}
          onReply={onReply}
          styles={styles}
        />
      )}
    </Fragment>
  ));
}

interface ReplyBarProps {
  message: ChatMessage;
  onClose(): void;
  iconSize: number;
  color: string;
  styles: OfficeStyles;
}

/** The message your next one answers, above the box. */
function ReplyBar({ message, onClose, iconSize, color, styles }: ReplyBarProps) {
  return (
    <View style={styles.boardTitleRow}>
      <Quote name={message.name ?? ""} text={quotedText(message)} styles={styles} />
      <ChatButton
        label="Cancel reply"
        value="close"
        onPress={onClose}
        style={styles.segment}
        styles={styles}
      >
        <Icon name="X" size={iconSize} color={color} />
      </ChatButton>
    </View>
  );
}

interface MentionListProps {
  options: readonly MentionOption[];
  onPick(name: string): void;
  styles: OfficeStyles;
}

/** The team the words after `@` find, under the box. */
function MentionList({ options, onPick, styles }: MentionListProps) {
  return (
    <ScrollView style={styles.chatMentions} keyboardShouldPersistTaps="handled">
      {options.map((option) => (
        <ChatButton
          key={option.id}
          label={`${option.name}, ${option.room}`}
          value={option.name}
          onPress={onPick}
          style={styles.pickerRow}
          styles={styles}
        >
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {option.name}
            </Text>
            <Text style={styles.rowMeta} numberOfLines={1}>
              {option.room}
            </Text>
          </View>
        </ChatButton>
      ))}
    </ScrollView>
  );
}

function StickerTray({ onPick, styles }: { onPick(index: number): void; styles: OfficeStyles }) {
  return (
    <View style={styles.chips}>
      {STICKERS.map((words, index) => (
        <ChatButton
          key={words}
          label={words}
          value={index}
          onPress={onPick}
          style={styles.chatChip}
          styles={styles}
        >
          <Text style={styles.chatText}>{words}</Text>
        </ChatButton>
      ))}
    </View>
  );
}

/**
 * The Chat tab of the office's column, fed by the surface's subscription: the team conversation,
 * which the surface keeps apart from the floor's state.
 */
function readyToSend({ images, recipient, text }: ChatDraft, reading: boolean): boolean {
  return !reading && (images.length ? recipient !== null : text.trim() !== "");
}

function SendButton({
  like,
  canSend,
  send,
  sendLike,
  styles,
  color,
  muted,
  size,
}: {
  like: boolean;
  canSend: boolean;
  send(): void;
  sendLike(): void;
  styles: OfficeStyles;
  color: string;
  muted: string;
  size: number;
}) {
  const enabled = like || canSend;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={like ? "Send thumbs up" : "Send"}
      onPress={like ? sendLike : send}
      disabled={!enabled}
      style={enabled ? styles.messenger.send : styles.messenger.sendOff}
    >
      <Icon name={like ? "ThumbsUp" : "Send"} size={size} color={enabled ? color : muted} />
    </Pressable>
  );
}

function canLike(draft: ChatDraft, reading: boolean): boolean {
  return !reading && draft.images.length === 0 && draft.text.trim() === "";
}

function Pinned({
  message,
  active,
  onPress,
  styles,
}: {
  message: ChatMessage | undefined;
  active: boolean;
  onPress(): void;
  styles: OfficeStyles;
}) {
  if (!message) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Pinned message"
      aria-pressed={active}
      onPress={onPress}
      style={styles.messenger.pin}
    >
      <Icon name="Pin" size={15} color={styles.iconColor} />
      <View style={styles.rowBody}>
        <Text style={styles.chatName}>Pinned message</Text>
        <Text numberOfLines={1} style={styles.chatMeta}>
          {quotedText(message)}
        </Text>
      </View>
      <Icon name={active ? "X" : "ChevronRight"} size={14} color={styles.iconColor} />
    </Pressable>
  );
}

const memberStatuses = { attention: "Needs you", working: "Working", resting: "Resting" } as const;
type ChatPanelProps = ColumnPanelProps & ChatShortcuts & { draft: ChatDraft; onClose?(): void };

export function FloatingTeamChat(props: ChatPanelProps & { onClose(): void }) {
  const theme = useMemo(() => messengerTheme(props.theme), [props.theme]);
  const styles = useOfficeStyles(theme, props.layout.compact, props.layout.platform !== "web");
  return (
    <View role="region" aria-label="Team chat" style={styles.messenger.floating}>
      <ChatPanel {...props} theme={theme} styles={styles} />
    </View>
  );
}

export function ChatPanel({
  office,
  styles,
  theme,
  layout,
  link,
  draft,
  onClose,
  onBoard,
  onDuties,
  onNewAgent,
  onGroupPhoto,
}: ChatPanelProps) {
  const { state, subscription, chat } = office;
  const call = useRpc(chatRpc);
  const model = useMemo(() => buildOfficeModel(state), [state]);
  // The surface holds what is typed, so a look at another tab or a closed sheet keeps it.
  const { text, setText, replyTo, setReplyTo, recipient, images, setImages } = draft;
  const [reading, setReading] = useState(false);
  const canSend = readyToSend(draft, reading);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const toggleSearch = useCallback(() => {
    setSearching((value) => !value);
    setQuery("");
  }, []);
  const [openedAt] = useState(getChatSeen);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const togglePin = useCallback(() => {
    setPinnedOnly((value) => !value);
    setQuery("");
  }, []);
  const members = useMemo(
    () =>
      model.rooms.flatMap((room) =>
        room.rows.map((row) => ({
          id: row.agent.id,
          name: agentTitle(row.agent),
          room: room.name,
          status: memberStatuses[tabOf(row)],
        })),
      ),
    [model],
  );
  const [error, setError] = useState<string | null>(null);
  const [stickersOpen, setStickersOpen] = useState(false);
  const all = chat?.messages;
  const messages = useMemo(() => (all ?? []).filter(shows), [all]);
  const pinned = messages.find((m) => m.id === chat?.pinned && !m.recalled);
  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      needle
        ? messages.filter((message) =>
            [message.name, quotedText(message), message.reply?.text].some((part) =>
              part?.toLowerCase().includes(needle),
            ),
          )
        : messages,
    [needle, messages],
  );
  const shownMessages = useMemo(
    () => (pinnedOnly && pinned && !needle ? [pinned] : visible),
    [pinnedOnly, pinned, needle, visible],
  );
  const firstUnread = messages.find(
    (message) => message.at > openedAt && !isYours(message) && message.kind !== "sys",
  )?.id;
  const problem = loadProblem(subscription);
  // Asked once, as the surface does. A phone, or a browser on a touch screen, has nothing to hover
  // with and no Enter that sends: the actions always show and the Send button sends.
  const touchScreen = useMemo(
    () => hasTouchScreen(layout.platform, layout.platform === "web" ? readPointer() : null),
    [layout.platform],
  );
  // The chat is seen up to its newest message while it is open.
  const newest = messages.at(-1)?.at ?? 0;
  useEffect(() => {
    if (newest > 0 && needle === "") markChatSeen(newest);
  }, [newest, needle]);
  // Stays at the bottom while you are there.
  const { scroller, onScroll, followEnd } = useFollowEnd();

  const run = useCallback(
    async (input: ChatRequest): Promise<boolean> => {
      try {
        const result = await call(input);
        if (!result.ok) throw new Error(result.error);
        setError(null);
        return true;
      } catch (failure) {
        setError(failureText("Send", failure));
        return false;
      }
    },
    [call],
  );
  // Enter and the Send button can both fire before the first send returns.
  const sending = useRef(false);
  const post = useCallback(
    async (like: boolean) => {
      const sent = like ? "👍" : text.trim();
      if ((!like && !canSend) || sending.current) return;
      sending.current = true;
      const ok = await run({
        op: "send",
        text: sent,
        ...(replyTo ? { replyTo: replyTo.id } : {}),
        ...(recipient ? { to: recipient } : {}),
        ...(images.length
          ? { images: images.map(({ data, mimeType }) => ({ data, mimeType })) }
          : {}),
      });
      sending.current = false;
      if (!ok) return;
      setText((current) => textAfterSend(current, sent));
      if (images.length) setImages((current) => current.filter((image) => !images.includes(image)));
      setReplyTo(null);
    },
    [text, replyTo, recipient, images, setImages, canSend, run, setText, setReplyTo],
  );
  const send = useCallback(() => post(false), [post]);
  const sendLike = useCallback(() => post(true), [post]);
  const sendSticker = useCallback(
    async (sticker: number) => {
      const ok = await run({
        op: "send",
        sticker,
        ...(replyTo ? { replyTo: replyTo.id } : {}),
        ...(recipient ? { to: recipient } : {}),
      });
      if (!ok) return;
      setStickersOpen(false);
      setReplyTo(null);
    },
    [replyTo, recipient, run, setReplyTo],
  );

  const options = useMemo(() => {
    const mention = mentionAt(text);
    return mention === null ? [] : mentionOptions(model, mention.query);
  }, [text, model]);
  const first = options[0];
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const useQuick = useCallback(
    (message: string) => {
      setText(message);
      input.current?.focus();
    },
    [setText],
  );
  const insertMention = useCallback(() => {
    setText((value) => (value.trimEnd() ? value.trimEnd() + " @" : "@"));
    input.current?.focus();
  }, [setText]);
  const pick = useCallback(
    (name: string) => {
      setText((current) => {
        const mention = mentionAt(current);
        return mention === null ? current : putMention(current, mention, name);
      });
      input.current?.focus();
    },
    [setText],
  );
  const onKeyPress = useCallback(
    (event: KeyPress) => {
      // On a touch screen Enter is a new line, and the Send button sends. An IME's Enter picks a word.
      const { nativeEvent } = event;
      if (touchScreen || nativeEvent.isComposing === true) return;
      const tab = nativeEvent.key === "Tab" && nativeEvent.shiftKey !== true;
      // While the @ list is open, Enter and Tab put the first name and do not send.
      if (first !== undefined && (tab || enterSends(nativeEvent))) {
        event.preventDefault();
        pick(first.name);
        return;
      }
      if (enterSends(nativeEvent)) {
        event.preventDefault();
        void send();
      }
    },
    [touchScreen, first, pick, send],
  );
  const toggleStickers = useCallback(() => setStickersOpen((open) => !open), []);
  const closeReply = useCallback(() => setReplyTo(null), [setReplyTo]);
  const typing = typingText(chat?.typing ?? []);
  const counter = counterText(text.length);
  // The glyph at the app's icon sizes, as the header's buttons have it.
  const iconSize = layout.compact ? 20 : 16;
  return (
    <View style={styles.screen}>
      <ChatHeader
        members={members}
        onOpenSession={link.openSession}
        searching={searching}
        onSearch={toggleSearch}
        onClose={onClose}
        styles={styles}
      />
      <Pinned message={pinned} active={pinnedOnly} onPress={togglePin} styles={styles} />
      {searching && (
        <View style={styles.messenger.searchRow}>
          <TextInput
            autoFocus
            accessibilityLabel="Search messages"
            placeholder="Search messages"
            placeholderTextColor={styles.placeholderColor}
            value={query}
            onChangeText={setQuery}
            style={styles.fieldInput}
          />
        </View>
      )}
      <ScrollView
        ref={scroller}
        contentContainerStyle={styles.chatList}
        onScroll={onScroll}
        onContentSizeChange={followEnd}
        onLayout={followEnd}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
      >
        <Messages
          messages={shownMessages}
          emptyLabel={needle ? "No matching messages" : CHAT_EMPTY}
          firstUnread={needle ? undefined : firstUnread}
          agents={model.agents}
          problem={problem}
          always={touchScreen}
          link={link}
          run={run}
          onReply={setReplyTo}
          styles={styles}
        />
      </ScrollView>
      {typing && <Text style={styles.chatTyping}>{typing}</Text>}
      <View style={styles.messenger.composer}>
        {replyTo === null ? null : (
          <ReplyBar
            message={replyTo}
            onClose={closeReply}
            iconSize={iconSize}
            color={theme.colors.foreground}
            styles={styles}
          />
        )}
        <ComposeTools
          draft={draft}
          members={members}
          web={layout.platform === "web"}
          run={run}
          styles={styles}
          onBoard={onBoard}
          onDuties={onDuties}
          onNewAgent={onNewAgent}
          onGroupPhoto={onGroupPhoto}
          openSession={link.openSession}
          onUse={useQuick}
          insertMention={insertMention}
          setReading={setReading}
          stickersOpen={stickersOpen}
          toggleStickers={toggleStickers}
        />
        {options.length > 0 ? (
          <MentionList options={options} onPick={pick} styles={styles} />
        ) : null}
        {counter === null ? null : <Text style={styles.chatMeta}>{counter}</Text>}
        <PromptCoach draft={draft} styles={styles} />
        <View style={styles.messenger.composerRow}>
          <TextInput
            ref={input}
            accessibilityLabel="Message"
            placeholder="Write a message"
            placeholderTextColor={styles.placeholderColor}
            value={text}
            onChangeText={setText}
            onKeyPress={onKeyPress}
            multiline
            maxLength={CHAT_TEXT_MAX}
            style={styles.messenger.field}
          />
          <SendButton
            like={canLike(draft, reading)}
            canSend={canSend}
            send={send}
            sendLike={sendLike}
            styles={styles}
            color={theme.colors.accentForeground}
            muted={theme.colors.foregroundMuted}
            size={iconSize}
          />
        </View>
        {error === null ? null : (
          <Text accessibilityRole="alert" style={styles.actionError}>
            {error}
          </Text>
        )}
        {stickersOpen ? <StickerTray onPick={sendSticker} styles={styles} /> : null}
      </View>
    </View>
  );
}
