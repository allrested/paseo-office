import { useCallback, useMemo, useState } from "react";
import type { StripCard } from "./attention-strip.js";
import type { OfficeModel } from "../shared/model.js";
import { taskAttentionNote, taskAttentionRows, type TaskAttentionRow } from "./task-attention.js";

export interface TaskAttention {
  rows: readonly TaskAttentionRow[];
  /** The strip's card; null while no task needs you. */
  entry: StripCard | null;
  open: boolean;
  /** Leaves the card for the task's board. */
  openBoard(roomId: string): void;
  close(): void;
}

export interface TaskAttentionInput {
  model: OfficeModel;
  live: boolean;
  showBoard(roomId: string): void;
}

/** The tasks that need you: their rows, their card's place in the strip, and the way to a board. */
export function useTaskAttention({ model, live, showBoard }: TaskAttentionInput): TaskAttention {
  const [opened, setOpened] = useState(false);
  const onOpen = useCallback(() => setOpened(true), []);
  const close = useCallback(() => setOpened(false), []);
  const rows = useMemo(() => taskAttentionRows(model, Date.now()), [model]);
  // The last answer empties the card and closes it, so the next blocked task does not open it.
  if (opened && rows.length === 0) setOpened(false);
  const entry = useMemo((): StripCard | null => {
    const note = taskAttentionNote(rows);
    // A blocked task waits on the user, so the card asks for a look and counts in Attention.
    return note === null ? null : { title: "Tasks", note: { text: note, tone: "warning" }, onOpen };
  }, [rows, onOpen]);
  const openBoard = useCallback(
    (roomId: string) => {
      setOpened(false);
      showBoard(roomId);
    },
    [showBoard],
  );
  return { rows, entry, open: opened && live, openBoard, close };
}
