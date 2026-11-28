import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import { Text } from "./text.js";
import { TextInput } from "./text.js";
import { POST_TEXT_MAX, type Post } from "../shared/contracts.js";
import type { OfficeRoom } from "../shared/model.js";
import type { RosterTeam } from "../shared/roster.js";
import { ActionButton, failureText } from "./action-button.js";
import { textAfterSend } from "./agent-card.js";
import { AgentPicker } from "./agent-picker.js";
import { NOBODY, teamIdOf } from "./agent-picker-text.js";
import { BoardTeams } from "./board-agents.js";
import { KanbanBoard } from "./board-kanban.js";
import { AfterField, useFollowUp } from "./follow-up.js";
import { PostWithActions, WakeField, useWakeChoice, type SheetBodyProps } from "./board-sheet.js";
import { allPosts, officeWork, repliesOf, topLevel, type TeamNamer } from "./board-text.js";
import type { OfficeStyles } from "./styles.js";
import { ClearFinished, TaskCard, useMounted } from "./task-card.js";
import { useT } from "./ui-language.js";
import type { BoardActions } from "./use-board-actions.js";

interface TodoHeadingProps {
  board: string;
  /** How many to-dos are done now. */
  done: number;
  actions: BoardActions;
  styles: OfficeStyles;
}

/** The list's heading, and on its right "Clear finished", which deletes the done to-dos. */
function TodoHeading({ board, done, actions, styles }: TodoHeadingProps) {
  return (
    <View style={styles.boardTitleRow}>
      <Text accessibilityRole="header" style={styles.lobbyHeading}>
        To-do
      </Text>
      <ClearFinished board={board} done={done} actions={actions} styles={styles} />
    </View>
  );
}

interface TodoListProps {
  room: OfficeRoom;
  /** The lobby's notes, oldest first, without the replies, which show under their to-dos. */
  notes: readonly Post[];
  all: readonly Post[];
  onFollowUp(id: string): void;
  name(author: string): string;
  teamName: TeamNamer;
  actions: BoardActions;
  styles: OfficeStyles;
}

interface BacklogSectionProps {
  held: readonly Post[];
  all: readonly Post[];
  /** The posts of the lobby's board, where the replies under a held task are. */
  posts: readonly Post[];
  onFollowUp(id: string): void;
  name(author: string): string;
  teamName: TeamNamer;
  actions: BoardActions;
  styles: OfficeStyles;
}

/**
 * The held tasks above the to-dos, folded at first as a room's Done section is: a press on
 * "Backlog · 2" unfolds them, each with Start and the buttons a to-do has.
 */
function BacklogSection({
  held,
  all,
  posts,
  onFollowUp,
  name,
  teamName,
  actions,
  styles,
}: BacklogSectionProps) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const t = useT();
  const heading = `Backlog · ${held.length}`;
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
      </View>
      {open
        ? held.map((post) => (
            <TaskCard
              key={post.id}
              post={post}
              replies={repliesOf(post, posts)}
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

/** Whether a task is held in the backlog: open, and not yet started. */
const isHeld = (post: Post) => post.state === "open" && post.backlog === true;

/**
 * The list layout: the backlog when something is held, the to-dos with their heading, then the
 * notes when there are any.
 */
function TodoList({
  room,
  notes,
  all,
  onFollowUp,
  name,
  teamName,
  actions,
  styles,
}: TodoListProps) {
  const done = room.todos.filter((post) => post.state === "done").length;
  const held = useMemo(() => room.todos.filter(isHeld), [room.todos]);
  const todos = useMemo(() => room.todos.filter((post) => !isHeld(post)), [room.todos]);
  return (
    <>
      {held.length > 0 ? (
        <BacklogSection
          held={held}
          all={all}
          posts={room.posts}
          onFollowUp={onFollowUp}
          name={name}
          teamName={teamName}
          actions={actions}
          styles={styles}
        />
      ) : null}
      <View style={styles.lobbySection}>
        <TodoHeading board={room.id} done={done} actions={actions} styles={styles} />
        {todos.length === 0 ? <Text style={styles.muted}>No to-dos</Text> : null}
        {todos.map((post) => (
          <TaskCard
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
        ))}
      </View>
      {notes.length > 0 ? (
        <View style={styles.lobbySection}>
          <Text accessibilityRole="header" style={styles.lobbyHeading}>
            Notes
          </Text>
          {notes.map((post) => (
            <PostWithActions
              key={post.id}
              post={post}
              name={name}
              teamName={teamName}
              all={all}
              onFollowUp={onFollowUp}
              actions={actions}
              styles={styles}
            />
          ))}
        </View>
      ) : null}
    </>
  );
}

export interface LobbyBodyProps extends SheetBodyProps {
  /** The roster's teams the form can give a task to: none while the roster is off. */
  teams: readonly RosterTeam[];
  /** A room's name was chosen under "Agent tasks": that room's board opens. */
  onOpenBoard(roomId: string): void;
}

/**
 * The lobby's board: its to-dos and notes, as a kanban or a list, and who is at work in every
 * room, each with what it is at and the steps it is working through.
 */
export function LobbyBody({
  room,
  rooms,
  duties,
  name,
  agentTasks,
  teams: rosterTeams,
  teamName,
  actions,
  wakesPaused,
  picking,
  onPicking,
  onSelectAgent,
  onOpenBoard,
  layout,
  styles,
}: LobbyBodyProps) {
  const [text, setText] = useState("");
  const { to, fieldId, open, back, choose, reset } = useWakeChoice({
    rooms,
    teams: rosterTeams,
    picking,
    onPicking,
  });
  const mounted = useMounted();
  // What a task waits on can be on any board: the cards and the form judge by all of them.
  const every = useMemo(() => allPosts(rooms, duties), [rooms, duties]);
  const followUp = useFollowUp(every);
  const { after, clear: clearFollowUp } = followUp;
  // Enter adds as well as the button, so the form keeps its own pending state and failure.
  const [adding, setAdding] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Set before the first await, so a second Enter before the re-render cannot add twice.
  const inFlight = useRef(false);
  const send = useCallback(
    async (backlog: boolean) => {
      const sent = text.trim();
      if (sent === "" || inFlight.current) return;
      inFlight.current = true;
      setAdding(true);
      setFailure(null);
      try {
        // A team is chosen as `team:<id>`: it goes as `team`, an agent as `to`, never both.
        const team = teamIdOf(to);
        const recipient = team === null ? { to } : { team };
        await actions.post({
          board: room.id,
          kind: "task",
          text: sent,
          ...(to === NOBODY ? {} : recipient),
          ...(after.length === 0 ? {} : { after: [...after] }),
          ...(backlog ? { backlog: true } : {}),
        });
        if (!mounted.current) return;
        // Cleared only if the field still holds what was added, so later typing stays.
        setText((current) => textAfterSend(current, sent));
        reset();
        clearFollowUp();
      } catch (caught) {
        if (mounted.current) setFailure(failureText("Add", caught));
      } finally {
        inFlight.current = false;
        if (mounted.current) setAdding(false);
      }
    },
    [actions, room.id, text, to, after, reset, clearFollowUp, mounted],
  );
  // Enter and Add hand the task out; Add to backlog holds it until Start.
  const add = useCallback(() => send(false), [send]);
  const addToBacklog = useCallback(() => send(true), [send]);
  // The lobby's tasks are the to-dos; what is left of its posts are notes, oldest first, and the
  // replies among them show under their to-dos.
  const allNotes = useMemo(() => room.posts.filter((post) => post.kind === "note"), [room.posts]);
  const notes = useMemo(() => topLevel(allNotes), [allNotes]);
  // The kanban takes both: the to-dos, done ones too, which the room's posts leave out, and every
  // note, replies too, for the cards to find theirs.
  const board = useMemo(() => [...room.todos, ...allNotes], [room.todos, allNotes]);
  const teams = useMemo(() => officeWork(rooms, agentTasks), [rooms, agentTasks]);
  if (picking) {
    return (
      <AgentPicker
        rooms={rooms}
        roomId={room.id}
        value={to}
        teams={rosterTeams}
        onChoose={choose}
        onBack={back}
        styles={styles}
      />
    );
  }
  return (
    <View style={styles.sheet}>
      <View style={styles.lobbyForm}>
        <View style={styles.boardTitleRow}>
          <View style={styles.rowBody}>
            <TextInput
              accessibilityLabel="Add a to-do"
              value={text}
              onChangeText={setText}
              onSubmitEditing={add}
              // Enter adds and the focus stays for the next to-do. react-native-web reads only
              // blurOnSubmit; native reads submitBehavior.
              submitBehavior="submit"
              blurOnSubmit={false}
              placeholder="Add a to-do"
              placeholderTextColor={styles.placeholderColor}
              maxLength={POST_TEXT_MAX}
              style={styles.fieldInput}
              ref={followUp.field}
            />
          </View>
          <ActionButton
            label="Add"
            pendingLabel="Adding..."
            onPress={add}
            disabled={adding || text.trim().length === 0}
            styles={styles}
            primary
          />
          <ActionButton
            label="Add to backlog"
            pendingLabel="Adding..."
            onPress={addToBacklog}
            disabled={adding || text.trim().length === 0}
            styles={styles}
          />
        </View>
        {failure === null ? null : (
          <Text accessibilityRole="alert" style={styles.actionError}>
            {failure}
          </Text>
        )}
        <AfterField followUp={followUp} styles={styles} />
        <WakeField
          id={fieldId}
          roomId={room.id}
          to={to}
          rooms={rooms}
          teams={rosterTeams}
          wakesPaused={wakesPaused}
          onOpen={open}
          styles={styles}
        />
      </View>
      {layout === "kanban" ? (
        <KanbanBoard
          posts={board}
          all={every}
          onFollowUp={followUp.add}
          name={name}
          teamName={teamName}
          actions={actions}
          styles={styles}
        />
      ) : (
        <TodoList
          room={room}
          notes={notes}
          all={every}
          onFollowUp={followUp.add}
          name={name}
          teamName={teamName}
          actions={actions}
          styles={styles}
        />
      )}
      <View style={styles.lobbySection}>
        <Text accessibilityRole="header" style={styles.lobbyHeading}>
          Agent tasks
        </Text>
        {teams.length === 0 ? (
          <Text style={styles.muted}>No agent tasks</Text>
        ) : (
          <BoardTeams
            teams={teams}
            styles={styles}
            onSelectAgent={onSelectAgent}
            onOpenBoard={onOpenBoard}
          />
        )}
      </View>
    </View>
  );
}
