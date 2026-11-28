import { useMemo } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import {
  clearDoneRpc,
  deleteRpc,
  postRpc,
  setWakesPausedRpc,
  updateRpc,
  type Post,
  type PostKind,
} from "../shared/contracts.js";

export interface BoardActions {
  post(input: {
    board: string;
    kind: PostKind;
    text: string;
    to?: string;
    /** A roster team's id: only on a lobby task, and never with `to`. */
    team?: string;
    replyTo?: string;
    /** The tasks this one waits on (at most AFTER_MAX); the server holds it back until they are done. */
    after?: string[];
  }): Promise<void>;
  /** A note under the task, on the task's board; the server wakes the task's holder. */
  reply(task: Post, text: string): Promise<void>;
  markDone(id: string): Promise<void>;
  reopen(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  /** Deletes every done task of the board. */
  clearDone(board: string): Promise<void>;
  setWakesPaused(paused: boolean): Promise<void>;
}

/** Each action rejects with the server's message, which ActionButton shows under the button. */
export function useBoardActions(): BoardActions {
  const post = useRpc(postRpc);
  const update = useRpc(updateRpc);
  const remove = useRpc(deleteRpc);
  const clearDone = useRpc(clearDoneRpc);
  const pause = useRpc(setWakesPausedRpc);
  return useMemo(
    (): BoardActions => ({
      async post(input) {
        const result = await post(input);
        if (!result.ok) throw new Error(result.error);
      },
      async reply(task, text) {
        const result = await post({ board: task.board, kind: "note", text, replyTo: task.id });
        if (!result.ok) throw new Error(result.error);
      },
      async markDone(id) {
        const result = await update({ id, action: "done" });
        if (!result.ok) throw new Error(result.error);
      },
      async reopen(id) {
        const result = await update({ id, action: "reopen" });
        if (!result.ok) throw new Error(result.error);
      },
      async remove(id) {
        const result = await remove({ id });
        if (!result.ok) throw new Error(result.error);
      },
      async clearDone(board) {
        const result = await clearDone({ board });
        if (!result.ok) throw new Error(result.error);
      },
      async setWakesPaused(paused) {
        await pause({ paused });
      },
    }),
    [post, update, remove, clearDone, pause],
  );
}
