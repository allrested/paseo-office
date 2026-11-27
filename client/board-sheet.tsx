import { TeamName } from "./team-name.js";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { OfficeModal as Modal } from "./office-modal.js";
import { LOBBY, POST_TEXT_MAX, type Post, type PostKind } from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import { textAfterSend } from "./agent-card.js";
import { AgentPicker } from "./agent-picker.js";
import {
  NOBODY,
  choiceLabel,
  closeStep,
  keptChoice,
  recipientLabels,
} from "./agent-picker-text.js";
import { BoardAgents } from "./board-agents.js";
import { orderBoardPosts, roomAgents } from "./board-text.js";
import type { AgentTaskGroup, OfficeRoom } from "../shared/model.js";
import { LobbyBody } from "./lobby-board.js";
import { PostRow } from "./room-board.js";
import { focusById, listenForSpace } from "./web-env.web.js";
import type { OfficeStyles } from "./styles.js";
import type { BoardActions } from "./use-board-actions.js";

interface ChipProps {
  label: string;
  value: string;
  selected: boolean;
  onSelect(value: string): void;
  styles: OfficeStyles;
}

/** One choice of a set: a radio drawn as a chip. */
export function Chip({ label, value, selected, onSelect, styles }: ChipProps) {
  const press = useCallback(() => onSelect(value), [onSelect, value]);
  // Enter presses any Pressable; Space, the key that picks a radio, only a button.
  const id = useId();
  useEffect(() => listenForSpace(id, press), [id, press]);
  return (
    <Pressable
      id={id}
      accessibilityRole="radio"
      aria-checked={selected}
      onPress={press}
      style={selected ? styles.chipSelected : styles.chip}
    >
      <Text style={selected ? styles.chipTextSelected : styles.chipText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

interface PostActionsProps {
  post: Post;
  name(author: string): string;
  actions: BoardActions;
  styles: OfficeStyles;
}

export function PostWithActions({ post, name, actions, styles }: PostActionsProps) {
  const finished = post.state === "done";
  const toggleDone = useCallback(
    () => (finished ? actions.reopen(post.id) : actions.markDone(post.id)),
    [actions, finished, post.id],
  );
  const remove = useCallback(() => actions.remove(post.id), [actions, post.id]);
  // A deleted post is gone for good, so Delete asks once more. The question moves the buttons
  // down a line: a second tap in the same place lands on the words, not on a button.
  const [asking, setAsking] = useState(false);
  const ask = useCallback(() => setAsking(true), []);
  const keep = useCallback(() => setAsking(false), []);
  return (
    <View style={styles.boardPost}>
      <PostRow post={post} name={name} styles={styles} />
      {asking ? (
        <>
          <Text style={styles.sheetText}>Delete this post?</Text>
          <View style={styles.actions}>
            <ActionButton
              label="Delete"
              pendingLabel="Deleting..."
              onPress={remove}
              styles={styles}
            />
            <ActionButton label="Keep" pendingLabel="Keeping..." onPress={keep} styles={styles} />
          </View>
        </>
      ) : (
        <View style={styles.actions}>
          {post.kind === "task" ? (
            <ActionButton
              label={finished ? "Reopen" : "Mark done"}
              pendingLabel="Saving..."
              onPress={toggleDone}
              styles={styles}
            />
          ) : null}
          <ActionButton label="Delete" pendingLabel="Deleting..." onPress={ask} styles={styles} />
        </View>
      )}
    </View>
  );
}

const KINDS: readonly { kind: PostKind; label: string; hint: string }[] = [
  { kind: "task", label: "Task", hint: "What needs doing" },
  { kind: "note", label: "Note", hint: "What the room should know" },
];

interface ChoiceFieldProps {
  id: string;
  /** What the row chooses. */
  label: string;
  /** The choice now. */
  value: string;
  inline: boolean;
  onOpen(): void;
  styles: OfficeStyles;
}

/** A form's row that opens a page: what it chooses, the choice, and a chevron. */
function ChoiceField({ id, label, value, inline, onOpen, styles }: ChoiceFieldProps) {
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  const lit = pressed || hovered;
  return (
    <Pressable
      id={id}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onOpen}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={inline ? styles.lobbyRecipient : styles.pickerField}
    >
      {lit ? <View style={styles.pressedFill} /> : null}
      {inline ? <Icon name="UserRound" size={14} color={styles.iconColor} /> : null}
      <View style={inline ? styles.lobbyTaskLine : styles.pickerFieldBody}>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.sheetText} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Icon name={inline ? "ChevronDown" : "ChevronRight"} size={16} color={styles.iconColor} />
    </Pressable>
  );
}

interface WakeChoiceInput {
  rooms: readonly OfficeRoom[];
  picking: boolean;
  onPicking(picking: boolean): void;
}

interface WakeChoice {
  /** The agent the post wakes, or nobody. */
  to: string;
  /** The form's row that opens the page. */
  fieldId: string;
  open(): void;
  back(): void;
  choose(value: string): void;
  /** A post was sent: the next one starts from nobody. */
  reset(): void;
}

/** Whom a post wakes, and the page that chooses it. */
export function useWakeChoice({ rooms, picking, onPicking }: WakeChoiceInput): WakeChoice {
  const [picked, setPicked] = useState(NOBODY);
  // An agent that left the office cannot be woken: the choice is nobody again.
  const to = keptChoice(picked, rooms);
  // Back from the page, the pressed row is gone: the focus returns to the row that opened it.
  const fieldId = useId();
  const wasPicking = useRef(false);
  useEffect(() => {
    if (picking) wasPicking.current = true;
    else if (wasPicking.current) focusById(fieldId);
  }, [picking, fieldId]);
  const open = useCallback(() => onPicking(true), [onPicking]);
  const back = useCallback(() => onPicking(false), [onPicking]);
  const choose = useCallback(
    (value: string) => {
      setPicked(value);
      onPicking(false);
    },
    [onPicking],
  );
  const reset = useCallback(() => setPicked(NOBODY), []);
  return { to, fieldId, open, back, choose, reset };
}

interface WakeFieldProps {
  id: string;
  roomId: string;
  to: string;
  rooms: readonly OfficeRoom[];
  wakesPaused: boolean;
  onOpen(): void;
  styles: OfficeStyles;
}

/** The form's row that opens the page, and while wakes are off, that the agent waits. */
export function WakeField({ id, roomId, to, rooms, wakesPaused, onOpen, styles }: WakeFieldProps) {
  const labels = recipientLabels(roomId);
  const paused = wakesPaused && (roomId === LOBBY || to !== NOBODY);
  return (
    <View style={styles.sheetField}>
      <ChoiceField
        id={id}
        label={labels.field}
        value={choiceLabel(to, rooms, labels.defaultChoice)}
        inline={roomId === LOBBY}
        onOpen={onOpen}
        styles={styles}
      />
      {paused ? (
        <Text style={styles.muted}>
          {to === NOBODY
            ? "Automatic pickup resumes when you turn on Wake agents."
            : "Wake agents is off. The agent gets this post when you turn it on."}
        </Text>
      ) : null}
    </View>
  );
}

export interface SheetBodyProps {
  room: OfficeRoom;
  rooms: readonly OfficeRoom[];
  /** Every agent's unfinished checklist steps: a board shows them under its agents. */
  agentTasks: readonly AgentTaskGroup[];
  name(author: string): string;
  actions: BoardActions;
  wakesPaused: boolean;
  /** The page that chooses the agent shows, not the form. */
  picking: boolean;
  onPicking(picking: boolean): void;
  /** An agent of the board was chosen: it opens as it does from its desk. */
  onSelectAgent(agentId: string): void;
  styles: OfficeStyles;
}

function SheetBody({
  room,
  rooms,
  agentTasks,
  name,
  actions,
  wakesPaused,
  picking,
  onPicking,
  onSelectAgent,
  styles,
}: SheetBodyProps) {
  const [kind, setKind] = useState<PostKind>("task");
  const [text, setText] = useState("");
  const { to, fieldId, open, back, choose, reset } = useWakeChoice({ rooms, picking, onPicking });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const selectKind = useCallback(
    (value: string) => setKind(value === "note" ? "note" : "task"),
    [],
  );
  const posts = useMemo(() => orderBoardPosts(room.posts), [room.posts]);
  const agents = useMemo(() => roomAgents(room, agentTasks), [room, agentTasks]);
  const submit = useCallback(async () => {
    const sent = text.trim();
    await actions.post({ board: room.id, kind, text: sent, ...(to === NOBODY ? {} : { to }) });
    if (!mounted.current) return;
    // Cleared only if the box still holds what was posted, so later typing stays.
    setText((current) => textAfterSend(current, sent));
    reset();
  }, [actions, room.id, kind, text, to, reset]);
  const chosen = KINDS.find((option) => option.kind === kind) ?? KINDS[0];
  // The form's state is kept here while the page shows, so the text typed is there on return.
  if (picking) {
    return (
      <AgentPicker
        rooms={rooms}
        roomId={room.id}
        value={to}
        onChoose={choose}
        onBack={back}
        styles={styles}
      />
    );
  }
  return (
    <View style={styles.sheet}>
      <View style={styles.sheetField}>
        <View accessibilityRole="radiogroup" accessibilityLabel="Kind of post" style={styles.chips}>
          {KINDS.map((option) => (
            <Chip
              key={option.kind}
              label={option.label}
              value={option.kind}
              selected={kind === option.kind}
              onSelect={selectKind}
              styles={styles}
            />
          ))}
        </View>
        <TextInput
          accessibilityLabel={chosen ? `${chosen.label} text` : undefined}
          value={text}
          onChangeText={setText}
          placeholder={chosen?.hint}
          placeholderTextColor={styles.placeholderColor}
          maxLength={POST_TEXT_MAX}
          multiline
          style={styles.input}
        />
      </View>
      <WakeField
        id={fieldId}
        roomId={room.id}
        to={to}
        rooms={rooms}
        wakesPaused={wakesPaused}
        onOpen={open}
        styles={styles}
      />
      <ActionButton
        label="Post"
        pendingLabel="Posting..."
        onPress={submit}
        disabled={text.trim().length === 0}
        styles={styles}
        primary
      />
      {/* Who sits in the room and what each is at: the board is the room's, not only its posts'. */}
      <View style={styles.sheetField}>
        {agents.length === 0 ? (
          <Text style={styles.muted}>No agents</Text>
        ) : (
          <>
            <Text style={styles.sheetLabel}>Agents</Text>
            <BoardAgents agents={agents} styles={styles} onSelectAgent={onSelectAgent} />
          </>
        )}
      </View>
      <View style={styles.boardPosts}>
        {posts.length === 0 ? (
          <Text style={styles.muted}>No posts</Text>
        ) : (
          <Text style={styles.sheetLabel}>Posts</Text>
        )}
        {posts.map((post) => (
          <PostWithActions
            key={post.id}
            post={post}
            name={name}
            actions={actions}
            styles={styles}
          />
        ))}
      </View>
    </View>
  );
}

export interface BoardSheetProps {
  room: OfficeRoom | null;
  /** Every room of the office: the agents a post can wake, and where each one sits. */
  rooms: readonly OfficeRoom[];
  /** Every agent's unfinished checklist steps: a board shows them under its agents. */
  agentTasks: readonly AgentTaskGroup[];
  name(author: string): string;
  actions: BoardActions;
  /** "Wake agents" is off: a post that names an agent waits. */
  wakesPaused: boolean;
  /**
   * The host's sheet has already left when it reports a close (a phone's, swiped away, or a
   * tablet's, dismissed by Back), so a close from the page closes the sheet.
   */
  sheetLeavesFirst: boolean;
  styles: OfficeStyles;
  /** An agent of the board was chosen: the surface closes the board and opens the agent. */
  onSelectAgent(agentId: string): void;
  /** A room was chosen on the lobby's board: its board takes the sheet. */
  onOpenBoard(roomId: string): void;
  /** Back to the lobby's board, when this room's was opened from it. */
  onBack?: (() => void) | undefined;
  onClose(): void;
}

/**
 * Post a task or note, optionally waking an agent; mark a task done or delete a post. Under the
 * form are the room's agents with what each is at. The lobby's board is a to-do list instead, with
 * the agents at work in every room under it.
 */
export function BoardSheet({
  room,
  rooms,
  agentTasks,
  name,
  actions,
  wakesPaused,
  sheetLeavesFirst,
  styles,
  onSelectAgent,
  onOpenBoard,
  onBack,
  onClose,
}: BoardSheetProps) {
  const [picking, setPicking] = useState(false);
  // Another room's sheet, and a sheet opened again, start on the form.
  const roomId = room?.id ?? null;
  useEffect(() => {
    setPicking(false);
  }, [roomId]);
  const change = useCallback(
    (open: boolean) => {
      if (open) return;
      if (closeStep(picking, sheetLeavesFirst) === "back") setPicking(false);
      else onClose();
    },
    [sheetLeavesFirst, onClose, picking],
  );
  const board = room ? `${room.name} board` : "Board";
  const pickerTitle = room?.lobby ? "Send task to" : "Wake an agent";
  const icon = useMemo(
    () => (
      <Icon name={picking ? "UsersRound" : "ClipboardList"} size={18} color={styles.iconColor} />
    ),
    [picking, styles.iconColor],
  );
  return (
    <Modal
      title={picking ? pickerTitle : board}
      icon={icon}
      open={room !== null}
      onOpenChange={change}
    >
      <Modal.Content>
        {room?.lobby ? (
          <LobbyBody
            key={room.id}
            room={room}
            rooms={rooms}
            agentTasks={agentTasks}
            name={name}
            actions={actions}
            wakesPaused={wakesPaused}
            picking={picking}
            onPicking={setPicking}
            onSelectAgent={onSelectAgent}
            onOpenBoard={onOpenBoard}
            styles={styles}
          />
        ) : null}
        {room !== null && !room.lobby && !picking && onBack ? (
          <View style={styles.actions}>
            <ActionButton
              label="Back to Lobby board"
              pendingLabel="Back to Lobby board"
              onPress={onBack}
              styles={styles}
            />
          </View>
        ) : null}
        {/* The team's own name is set here too: this sheet opens from every view, the list from one. */}
        {room !== null && !room.lobby && !picking && room.workspace ? (
          <TeamName room={room} styles={styles} />
        ) : null}
        {room !== null && !room.lobby ? (
          <SheetBody
            key={room.id}
            room={room}
            rooms={rooms}
            agentTasks={agentTasks}
            name={name}
            actions={actions}
            wakesPaused={wakesPaused}
            picking={picking}
            onPicking={setPicking}
            onSelectAgent={onSelectAgent}
            styles={styles}
          />
        ) : null}
      </Modal.Content>
    </Modal>
  );
}
