import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { Pressable, View } from "react-native";
import { Text, TextInput } from "./text.js";
import { Icon } from "@getpaseo/plugin/client/ui";
import { POST_TEXT_MAX, type Post } from "../shared/contracts.js";
import { ActionButton, failureText } from "./action-button.js";
import { textAfterSend } from "./agent-card.js";
import { clearQuestion, resultPreview, todoMeta, type TeamNamer } from "./board-text.js";
import type { OfficeStyles } from "./styles.js";
import { useT } from "./ui-language.js";
import type { BoardActions } from "./use-board-actions.js";
import { listenForSpace } from "./web-env.web.js";

/** False once the component has gone: an answer that comes later changes nothing. */
export function useMounted(): RefObject<boolean> {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

interface DeleteQuestionProps {
  question: string;
  onDelete(): Promise<void>;
  onKeep(): void;
  styles: OfficeStyles;
}

/**
 * What is deleted is gone for good, so Delete asks once more. The question takes the place of the
 * button and moves the buttons down a line: a second tap in the same place lands on the words.
 */
export function DeleteQuestion({ question, onDelete, onKeep, styles }: DeleteQuestionProps) {
  return (
    <>
      <Text style={styles.sheetText}>{question}</Text>
      <View style={styles.actions}>
        <ActionButton
          label="Delete"
          pendingLabel="Deleting..."
          onPress={onDelete}
          styles={styles}
        />
        <ActionButton label="Keep" pendingLabel="Keeping..." onPress={onKeep} styles={styles} />
      </View>
    </>
  );
}

interface ThreadButtonProps {
  label: string;
  expanded: boolean;
  onPress(): void;
  styles: OfficeStyles;
}

/** "Reply", "More", "Less": small words that open something under them. */
function ThreadButton({ label, expanded, onPress, styles }: ThreadButtonProps) {
  const t = useT();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(label)}
      aria-expanded={expanded}
      onPress={onPress}
      style={styles.taskThreadButton}
    >
      <Text style={styles.lobbyDeleteText}>{label}</Text>
    </Pressable>
  );
}

/** A task's result: its start (`resultPreview`), and the whole of it behind "More" when it is cut. */
function TaskResult({ result, styles }: { result: string; styles: OfficeStyles }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const preview = resultPreview(result);
  return (
    <View>
      <Text style={styles.postMeta}>Result</Text>
      <Text style={styles.postText}>{open ? result : preview.shown}</Text>
      {preview.cut ? (
        <ThreadButton
          label={open ? "Less" : "More"}
          expanded={open}
          onPress={toggle}
          styles={styles}
        />
      ) : null}
    </View>
  );
}

interface ReplyFieldProps {
  task: Post;
  actions: BoardActions;
  styles: OfficeStyles;
  /** The field's name and placeholder: "Write a reply" under a task, "Answer" on the Tasks card. */
  label?: string;
  /** Under a task the field opens on Reply and takes the focus; on a list of them it waits. */
  autoFocus?: boolean;
}

/** One line and Send. Enter sends as well, so the field keeps its own pending state and failure. */
export function ReplyField({
  task,
  actions,
  styles,
  label = "Write a reply",
  autoFocus = true,
}: ReplyFieldProps) {
  const [text, setText] = useState("");
  const mounted = useMounted();
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Set before the first await, so a second Enter before the re-render cannot send twice.
  const inFlight = useRef(false);
  const send = useCallback(async () => {
    const sent = text.trim();
    if (sent === "" || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setFailure(null);
    try {
      await actions.reply(task, sent);
      // Cleared only if the field still holds what was sent, so later typing stays.
      if (mounted.current) setText((current) => textAfterSend(current, sent));
    } catch (caught) {
      if (mounted.current) setFailure(failureText("Send", caught));
    } finally {
      inFlight.current = false;
      if (mounted.current) setSending(false);
    }
  }, [actions, task, text, mounted]);
  return (
    <>
      <View style={styles.taskReplyRow}>
        <View style={styles.rowBody}>
          <TextInput
            accessibilityLabel={label}
            value={text}
            onChangeText={setText}
            onSubmitEditing={send}
            // Enter sends and the focus stays for the next reply. react-native-web reads only
            // blurOnSubmit; native reads submitBehavior.
            submitBehavior="submit"
            blurOnSubmit={false}
            autoFocus={autoFocus}
            placeholder={label}
            placeholderTextColor={styles.placeholderColor}
            maxLength={POST_TEXT_MAX}
            style={styles.fieldInput}
          />
        </View>
        <ActionButton
          label="Send"
          pendingLabel="Sending..."
          onPress={send}
          disabled={sending || text.trim().length === 0}
          styles={styles}
          primary
        />
      </View>
      {failure === null ? null : (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {failure}
        </Text>
      )}
    </>
  );
}

export interface TaskThreadProps {
  task: Post;
  /** The notes under the task, oldest first (`repliesOf`). */
  replies: readonly Post[];
  name(author: string): string;
  actions: BoardActions;
  styles: OfficeStyles;
}

/**
 * Under a task, on its card and on a room's list row: what its holder needs while it is blocked,
 * what came of it, the replies, and Reply, which is how the need is answered. The thread stays
 * once the task is done. The field waits behind its button so a card stays short.
 */
export function TaskThread({ task, replies, name, actions, styles }: TaskThreadProps) {
  const [replying, setReplying] = useState(false);
  const reply = useCallback(() => setReplying(true), []);
  return (
    <>
      {task.blocked === undefined ? null : (
        <Text style={styles.standupBlocker}>{`Needs you: ${task.blocked}`}</Text>
      )}
      {task.result === undefined ? null : <TaskResult result={task.result} styles={styles} />}
      {replies.map((note) => (
        <Text key={note.id} style={styles.postText}>
          {`${name(note.author)} · ${note.text}`}
        </Text>
      ))}
      {replying ? (
        <ReplyField task={task} actions={actions} styles={styles} />
      ) : (
        <ThreadButton label="Reply" expanded={false} onPress={reply} styles={styles} />
      )}
    </>
  );
}

export interface TaskCardProps {
  post: Post;
  /** The notes under it, oldest first (`repliesOf`). */
  replies: readonly Post[];
  name(author: string): string;
  teamName: TeamNamer;
  actions: BoardActions;
  styles: OfficeStyles;
}

/**
 * A to-do: its checkbox ticks or unticks it, and Delete asks first. Its result and replies are
 * under it. The list draws it as a row, the kanban as a card.
 */
export function TaskCard({ post, replies, name, teamName, actions, styles }: TaskCardProps) {
  const done = post.state === "done";
  const meta = todoMeta(post, name, teamName);
  const mounted = useMounted();
  // The box shows the board's state: it changes when the board does, and is off until the answer.
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Set before the first await, so a second tap before the re-render cannot send twice.
  const inFlight = useRef(false);
  const toggle = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    try {
      await (done ? actions.reopen(post.id) : actions.markDone(post.id));
    } catch (caught) {
      if (mounted.current) setFailure(failureText(done ? "Reopen" : "Mark done", caught));
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }, [actions, post.id, done, mounted]);
  // Enter presses any Pressable; Space, the key that ticks a checkbox, only a button.
  const id = useId();
  useEffect(() => listenForSpace(id, toggle), [id, toggle]);
  const [asking, setAsking] = useState(false);
  const ask = useCallback(() => setAsking(true), []);
  const keep = useCallback(() => setAsking(false), []);
  const remove = useCallback(() => actions.remove(post.id), [actions, post.id]);
  return (
    <View style={styles.lobbyTask}>
      <View style={styles.lobbyTaskLine}>
        <Pressable
          id={id}
          accessibilityRole="checkbox"
          accessibilityLabel={meta === null ? post.text : `${post.text}, ${meta}`}
          aria-checked={done}
          disabled={pending}
          onPress={toggle}
          style={pending ? styles.todoRowDisabled : styles.todoRow}
        >
          <Icon name={done ? "SquareCheck" : "Square"} size={20} color={styles.iconColor} />
          <View style={styles.rowBody}>
            <Text style={done ? styles.todoTextDone : styles.postText}>{post.text}</Text>
            {meta === null ? null : <Text style={styles.postMeta}>{meta}</Text>}
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete task: ${post.text}`}
          aria-expanded={asking}
          onPress={ask}
          style={styles.lobbyDelete}
        >
          <Icon name="Trash2" size={16} color={styles.iconColor} />
        </Pressable>
      </View>
      <View style={styles.taskCardThread}>
        <TaskThread task={post} replies={replies} name={name} actions={actions} styles={styles} />
      </View>
      {failure === null ? null : (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {failure}
        </Text>
      )}
      {asking ? (
        <View style={styles.lobbyConfirm}>
          <DeleteQuestion
            question="Delete this post?"
            onDelete={remove}
            onKeep={keep}
            styles={styles}
          />
        </View>
      ) : null}
    </View>
  );
}

interface ClearFinishedProps {
  board: string;
  /** How many to-dos are done now. */
  done: number;
  actions: BoardActions;
  styles: OfficeStyles;
}

/**
 * "Clear finished", which deletes the board's done to-dos once its question is answered: on the
 * right of the list's heading, and in the heading of the kanban's Done column.
 */
export function ClearFinished({ board, done, actions, styles }: ClearFinishedProps) {
  const mounted = useMounted();
  const [asking, setAsking] = useState(false);
  const ask = useCallback(() => setAsking(true), []);
  const keep = useCallback(() => setAsking(false), []);
  const clear = useCallback(async () => {
    await actions.clearDone(board);
    if (mounted.current) setAsking(false);
  }, [actions, board, mounted]);
  // The count follows the board; once another hand has cleared them there is nothing to ask, and
  // the next done to-do does not bring the question back. Reset during render (React's "state
  // from the previous render"), so the question never shows for a frame with nothing to clear.
  if (asking && done === 0) setAsking(false);
  return asking ? (
    <View style={styles.sheetActions}>
      <DeleteQuestion
        question={clearQuestion(done)}
        onDelete={clear}
        onKeep={keep}
        styles={styles}
      />
    </View>
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Clear finished"
      onPress={ask}
      disabled={done === 0}
      style={styles.lobbyDelete}
    >
      <Text style={styles.lobbyDeleteText}>Clear finished</Text>
    </Pressable>
  );
}
