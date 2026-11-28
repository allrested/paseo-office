import { TeamName } from "./team-name.js";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "./text.js";
import { Icon } from "@getpaseo/plugin/client/ui";
import { TextInput } from "./text.js";
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
import { AfterField, useFollowUp } from "./follow-up.js";
import { KanbanBoard } from "./board-kanban.js";
import {
  allPosts,
  orderBoardPosts,
  repliesOf,
  roomAgents,
  topLevel,
  type TeamNamer,
} from "./board-text.js";
import type { AgentTaskGroup, OfficeRoom } from "../shared/model.js";
import type { RosterTeam } from "../shared/roster.js";
import type { BoardLayout } from "../shared/settings.js";
import { LobbyBody } from "./lobby-board.js";
import { PostRow } from "./room-board.js";
import { ClearFinished, TaskThread } from "./task-card.js";
import { useT } from "./ui-language.js";
import { focusById, listenForSpace } from "./web-env.web.js";
import type { OfficeStyles } from "./styles.js";
import type { BoardActions } from "./use-board-actions.js";
import { useBoardLayouts, type BoardLayouts } from "./use-board-layouts.js";

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
  /** A task's notes under it, oldest first (`repliesOf`); a note has none. */
  replies?: readonly Post[];
  name(author: string): string;
  teamName: TeamNamer;
  /** The posts of every board, for a task's line of what it waits on. */
  all: readonly Post[];
  onFollowUp(id: string): void;
  actions: BoardActions;
  styles: OfficeStyles;
}

const NO_REPLIES: readonly Post[] = [];

export function PostWithActions({
  post,
  replies = NO_REPLIES,
  name,
  teamName,
  all,
  onFollowUp,
  actions,
  styles,
}: PostActionsProps) {
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
      <PostRow post={post} name={name} teamName={teamName} styles={styles} />
      {post.kind === "task" ? (
        <View style={styles.taskThread}>
          <TaskThread
            task={post}
            replies={replies}
            name={name}
            all={all}
            onFollowUp={onFollowUp}
            actions={actions}
            styles={styles}
          />
        </View>
      ) : null}
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
  const t = useT();
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
      accessibilityLabel={`${t(label)}: ${t(value)}`}
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

const NO_TEAMS: readonly RosterTeam[] = [];

interface WakeChoiceInput {
  rooms: readonly OfficeRoom[];
  /** The roster's teams the form offers: only the lobby's passes any. */
  teams?: readonly RosterTeam[];
  picking: boolean;
  onPicking(picking: boolean): void;
}

interface WakeChoice {
  /** The agent the post wakes, `team:<id>` for a team, or nobody. */
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
export function useWakeChoice({
  rooms,
  teams = NO_TEAMS,
  picking,
  onPicking,
}: WakeChoiceInput): WakeChoice {
  const [picked, setPicked] = useState(NOBODY);
  // An agent that left the office cannot be woken, nor a team the roster dropped: the choice is
  // nobody again.
  const to = keptChoice(picked, rooms, teams);
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
  teams?: readonly RosterTeam[];
  wakesPaused: boolean;
  onOpen(): void;
  styles: OfficeStyles;
}

/** The form's row that opens the page, and while wakes are off, that the agent waits. */
export function WakeField({
  id,
  roomId,
  to,
  rooms,
  teams = NO_TEAMS,
  wakesPaused,
  onOpen,
  styles,
}: WakeFieldProps) {
  const labels = recipientLabels(roomId);
  const paused = wakesPaused && (roomId === LOBBY || to !== NOBODY);
  return (
    <View style={styles.sheetField}>
      <ChoiceField
        id={id}
        label={labels.field}
        value={choiceLabel(to, rooms, labels.defaultChoice, teams)}
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

interface DoneSectionProps {
  room: OfficeRoom;
  name(author: string): string;
  teamName: TeamNamer;
  all: readonly Post[];
  onFollowUp(id: string): void;
  actions: BoardActions;
  styles: OfficeStyles;
}

/**
 * A room's done tasks under its list, folded at first as the kanban's stacked Done is: a press on
 * "Done · 2" unfolds them, each with its result and replies and the buttons a list row has.
 */
function DoneSection({ room, name, teamName, all, onFollowUp, actions, styles }: DoneSectionProps) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const t = useT();
  const heading = `Done · ${room.done.length}`;
  return (
    <View style={styles.lobbySection}>
      <View style={styles.kanbanHeading}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(heading)}
          aria-expanded={open}
          onPress={toggle}
          style={styles.kanbanFold}
        >
          <Icon name={open ? "ChevronDown" : "ChevronRight"} size={16} color={styles.iconColor} />
          <Text style={styles.lobbyHeading}>{heading}</Text>
        </Pressable>
        <ClearFinished board={room.id} done={room.done.length} actions={actions} styles={styles} />
      </View>
      {open
        ? room.done.map((post) => (
            <PostWithActions
              key={post.id}
              post={post}
              replies={repliesOf(post, room.posts)}
              name={name}
              teamName={teamName}
              all={all}
              onFollowUp={onFollowUp}
              actions={actions}
              styles={styles}
            />
          ))
        : null}
    </View>
  );
}

export interface SheetBodyProps {
  room: OfficeRoom;
  rooms: readonly OfficeRoom[];
  /** Every agent's unfinished checklist steps: a board shows them under its agents. */
  agentTasks: readonly AgentTaskGroup[];
  name(author: string): string;
  /** How a task for a team names it. */
  teamName: TeamNamer;
  actions: BoardActions;
  wakesPaused: boolean;
  /** The page that chooses the agent shows, not the form. */
  picking: boolean;
  onPicking(picking: boolean): void;
  /** An agent of the board was chosen: it opens as it does from its desk. */
  onSelectAgent(agentId: string): void;
  /** The board's posts as columns or as one list: the device's choice for this kind of board. */
  layout: BoardLayout;
  styles: OfficeStyles;
}

const NO_AFTER: readonly string[] = [];

function SheetBody({
  room,
  rooms,
  agentTasks,
  name,
  teamName,
  actions,
  wakesPaused,
  picking,
  onPicking,
  onSelectAgent,
  layout,
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
  // A reply shows under its task, a done one's in the Done section.
  const posts = useMemo(() => orderBoardPosts(topLevel(room.posts)), [room.posts]);
  // The kanban takes the done tasks too, for its Done column.
  const board = useMemo(() => [...room.posts, ...room.done], [room.posts, room.done]);
  const agents = useMemo(() => roomAgents(room, agentTasks), [room, agentTasks]);
  // What a task waits on can be on any board: the cards and the Follow-up form judge by all of them.
  const everyPost = useMemo(() => allPosts(rooms), [rooms]);
  const followUp = useFollowUp(everyPost);
  // Follow-up makes the post a task: only a task waits.
  const addFollowUp = followUp.add;
  const onFollowUp = useCallback(
    (id: string) => {
      setKind("task");
      addFollowUp(id);
    },
    [addFollowUp],
  );
  const after = kind === "task" ? followUp.after : NO_AFTER;
  const clearFollowUp = followUp.clear;
  const submit = useCallback(async () => {
    const sent = text.trim();
    await actions.post({
      board: room.id,
      kind,
      text: sent,
      ...(to === NOBODY ? {} : { to }),
      ...(after.length === 0 ? {} : { after: [...after] }),
    });
    if (!mounted.current) return;
    // Cleared only if the box still holds what was posted, so later typing stays.
    setText((current) => textAfterSend(current, sent));
    reset();
    clearFollowUp();
  }, [actions, room.id, kind, text, to, after, reset, clearFollowUp]);
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
          ref={followUp.field}
        />
        {kind === "task" ? <AfterField followUp={followUp} styles={styles} /> : null}
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
      {layout === "kanban" ? (
        <KanbanBoard
          posts={board}
          name={name}
          teamName={teamName}
          all={everyPost}
          onFollowUp={onFollowUp}
          actions={actions}
          styles={styles}
        />
      ) : (
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
              replies={repliesOf(post, room.posts)}
              name={name}
              teamName={teamName}
              all={everyPost}
              onFollowUp={onFollowUp}
              actions={actions}
              styles={styles}
            />
          ))}
          {room.done.length > 0 ? (
            <DoneSection
              room={room}
              name={name}
              teamName={teamName}
              all={everyPost}
              onFollowUp={onFollowUp}
              actions={actions}
              styles={styles}
            />
          ) : null}
        </View>
      )}
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
  /** The roster's teams the lobby's form can give a task to: none while the roster is off. */
  teams: readonly RosterTeam[];
  teamName: TeamNamer;
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
 * A kanban's columns sit side by side from 720 px, wider than the standard dialog, so a board laid
 * out as a kanban opens it wide. Under 600 px every dialog is the screen's width: a phone still
 * stacks the columns.
 */
function dialogSize(room: OfficeRoom | null, layouts: BoardLayouts): "wide" | undefined {
  const layout = room?.lobby ? layouts.lobby : layouts.rooms;
  return layout === "kanban" ? "wide" : undefined;
}

/**
 * Post a task or note, optionally waking an agent; mark a task done or delete a post. Under the
 * form are the room's agents with what each is at. The lobby's board is its to-dos instead, with
 * the agents at work in every room under them. Each board is a kanban or a list as the device's
 * Boards setting says: the lobby's a kanban and a room's a list unless it says otherwise.
 */
export function BoardSheet({
  room,
  rooms,
  agentTasks,
  name,
  teams,
  teamName,
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
  const layouts = useBoardLayouts();
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
      size={dialogSize(room, layouts)}
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
            teams={teams}
            teamName={teamName}
            actions={actions}
            wakesPaused={wakesPaused}
            picking={picking}
            onPicking={setPicking}
            onSelectAgent={onSelectAgent}
            onOpenBoard={onOpenBoard}
            layout={layouts.lobby}
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
            teamName={teamName}
            actions={actions}
            wakesPaused={wakesPaused}
            picking={picking}
            onPicking={setPicking}
            onSelectAgent={onSelectAgent}
            layout={layouts.rooms}
            styles={styles}
          />
        ) : null}
      </Modal.Content>
    </Modal>
  );
}
