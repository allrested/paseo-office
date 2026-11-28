import { Fragment, useCallback } from "react";
import { View } from "react-native";
import { Text } from "./text.js";
import { OfficeModal as Modal } from "./office-modal.js";
import { ActionButton } from "./action-button.js";
import {
  blockedLine,
  mergedLine,
  NUDGE_TEXT,
  stalledLine,
  taskAttentionNote,
  taskPreview,
  type TaskAttentionRow,
} from "./task-attention.js";
import { ReplyField } from "./task-card.js";
import type { OfficeStyles } from "./styles.js";
import type { BoardActions } from "./use-board-actions.js";

interface RowProps {
  row: TaskAttentionRow;
  actions: BoardActions;
  onOpenBoard(roomId: string): void;
  styles: OfficeStyles;
}

const LINES = { blocked: blockedLine, stalled: stalledLine, merged: mergedLine };

/**
 * A task on the card: its text, why it is here, its board, and a way on. A blocked task takes an
 * answer, a reply under the task that clears the block and wakes the holder. A stalled one takes
 * Nudge, a fixed reply that wakes an idle holder, or Reopen, which frees it for another. A task
 * whose holder's pull request is merged takes Mark done, which only the user presses. The row goes
 * when the board says so.
 */
function Row({ row, actions, onOpenBoard, styles }: RowProps) {
  const roomId = row.post.board;
  const openBoard = useCallback(() => onOpenBoard(roomId), [onOpenBoard, roomId]);
  const { post } = row;
  const nudge = useCallback(() => actions.reply(post, NUDGE_TEXT), [actions, post]);
  const reopen = useCallback(() => actions.reopen(post.id), [actions, post.id]);
  const markDone = useCallback(() => actions.markDone(post.id), [actions, post.id]);
  const { kind } = row;
  const stalled = kind === "stalled";
  return (
    <View style={styles.reviewRow}>
      <Text accessibilityRole="header" style={styles.sheetText}>
        {taskPreview(row.post.text)}
      </Text>
      <Text style={styles.standupBlocker}>{LINES[kind](row)}</Text>
      <Text style={styles.rowMeta}>{row.board}</Text>
      {kind === "blocked" ? (
        <ReplyField
          task={row.post}
          actions={actions}
          styles={styles}
          label="Answer"
          autoFocus={false}
        />
      ) : null}
      <View style={styles.actions}>
        {stalled ? (
          <>
            <ActionButton label="Nudge" pendingLabel="Nudging..." onPress={nudge} styles={styles} />
            <ActionButton
              label="Reopen"
              pendingLabel="Saving..."
              onPress={reopen}
              styles={styles}
            />
          </>
        ) : null}
        {kind === "merged" ? (
          <ActionButton
            label="Mark done"
            pendingLabel="Saving..."
            onPress={markDone}
            styles={styles}
          />
        ) : null}
        <ActionButton
          label="Open board"
          pendingLabel="Opening..."
          onPress={openBoard}
          styles={styles}
        />
      </View>
    </View>
  );
}

export interface TasksCardProps {
  rows: readonly TaskAttentionRow[];
  open: boolean;
  actions: BoardActions;
  onOpenBoard(roomId: string): void;
  styles: OfficeStyles;
  onClose(): void;
}

/**
 * The tasks that need you, from every board: each blocked task with what its holder asked and a
 * field to answer it here, then the claims nobody works on, with Nudge and Reopen, then the tasks
 * whose pull request is merged, with Mark done. Nothing shows while nothing is on it.
 */
export function TasksCard({ rows, open, actions, onOpenBoard, styles, onClose }: TasksCardProps) {
  const change = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  const note = taskAttentionNote(rows);
  if (note === null) return null;
  return (
    <Modal title="Tasks" open={open} onOpenChange={change}>
      <Modal.Content>
        <View style={styles.sheet}>
          <Text style={styles.muted}>{note}</Text>
          <View style={styles.standupTeams}>
            {rows.map((row, index) => (
              <Fragment key={row.post.id}>
                {index === 0 ? null : <View style={styles.rowDivider} />}
                <Row row={row} actions={actions} onOpenBoard={onOpenBoard} styles={styles} />
              </Fragment>
            ))}
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}
