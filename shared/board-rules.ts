// Rules about posts that the server and the client both apply. Pure: no server or client imports.
import type { Post } from "./contracts.js";

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
