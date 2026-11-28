// Rules about posts that the server and the client both apply. Pure: no server or client imports.
import type { AgentStatus, Post } from "./contracts.js";

/**
 * The tasks a task still waits on: each id of its `after` that is a task on the boards and not
 * done. A task that was deleted or pruned no longer holds it.
 */
export function waitingOn(post: Post, posts: readonly Post[]): string[] {
  if (post.after === undefined) return [];
  return post.after.filter((id) => {
    const task = posts.find((item) => item.id === id);
    return task?.kind === "task" && task.state !== "done";
  });
}

/** How long an idle holder may sit on a claim before it is stalled. */
export const STALL_MS = 120_000;

export type StallCause = "error" | "idle" | "home";

/**
 * Why a claim nobody works on is stalled, or null while its holder is at it or is not an agent
 * here. `holder` says how the holder is: its status, "home" for one at home, undefined for one
 * that is not an agent here. A holder at home keeps its claim and does nothing until it is woken,
 * so it is stalled at once.
 */
export function stallCause(
  post: Post,
  now: number,
  holder: (agentId: string) => AgentStatus | "home" | undefined,
): StallCause | null {
  if (post.kind !== "task" || post.state !== "claimed" || post.blocked !== undefined) return null;
  if (post.claimedBy === undefined) return null;
  const status = holder(post.claimedBy);
  if (status === "home") return "home";
  if (status === "error") return "error";
  return status === "idle" && now - Date.parse(post.updatedAt) >= STALL_MS ? "idle" : null;
}
