import { useCallback, useEffect, useMemo, useState } from "react";
import type { StripCard } from "./attention-strip.js";
import type { OfficeModel } from "../shared/model.js";
import { DUTY } from "../shared/names.js";
import { taskAttentionNote, taskAttentionRows, type TaskAttentionRow } from "./task-attention.js";

/** How often the clock is read again while a task is claimed, so an idle claim can stall. */
export const TICK_MS = 30_000;

export interface TaskAttention {
  rows: readonly TaskAttentionRow[];
  /** The strip's card; null while no task needs you. */
  entry: StripCard | null;
  open: boolean;
  /** Leaves the card for the task's board: a room's by its id, or the duty board for a duty. */
  openBoard(roomId: string): void;
  close(): void;
}

export interface TaskAttentionInput {
  model: OfficeModel;
  live: boolean;
  showBoard(roomId: string): void;
  /** Opens the duty board, which is no room's; absent until the host has sent its duty list. */
  showDuties?: (() => void) | undefined;
}

/** The tasks that need you: their rows, their card's place in the strip, and the way to a board. */
export function useTaskAttention({
  model,
  live,
  showBoard,
  showDuties,
}: TaskAttentionInput): TaskAttention {
  const [opened, setOpened] = useState(false);
  const onOpen = useCallback(() => setOpened(true), []);
  const close = useCallback(() => setOpened(false), []);
  const [now, setNow] = useState(() => Date.now());
  const claimed = useMemo(
    () =>
      model.rooms.some((room) => room.posts.some((post) => post.state === "claimed")) ||
      model.duties.some((row) => row.post.state === "claimed"),
    [model],
  );
  // An idle claim turns stalled with time alone, so the clock is read again while any is held.
  useEffect(() => {
    if (!claimed) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [claimed]);
  const rows = useMemo(() => taskAttentionRows(model, now), [model, now]);
  // The last row going empties the card and closes it, so the next task does not open it.
  if (opened && rows.length === 0) setOpened(false);
  const entry = useMemo((): StripCard | null => {
    const note = taskAttentionNote(rows);
    // A blocked, stalled or merged task waits on the user, so the card asks for a look and counts in Attention.
    return note === null ? null : { title: "Tasks", note: { text: note, tone: "warning" }, onOpen };
  }, [rows, onOpen]);
  const openBoard = useCallback(
    (roomId: string) => {
      setOpened(false);
      if (roomId === DUTY) showDuties?.();
      else showBoard(roomId);
    },
    [showBoard, showDuties],
  );
  return { rows, entry, open: opened && live, openBoard, close };
}
