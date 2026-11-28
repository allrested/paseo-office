import { expect, test } from "vitest";
import type { Post } from "./contracts.js";
import { waitingOn } from "./board-rules.js";

function post(id: string, fields: Partial<Post> = {}): Post {
  return {
    id,
    seq: Number(id.slice(1)),
    board: "w1",
    kind: "task",
    state: "open",
    text: id,
    author: "user",
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
    ...fields,
  };
}

test("a task waits on each task it names that is still there and not done", () => {
  const posts = [
    post("p1", { state: "done" }),
    post("p2"),
    post("p3", { state: "claimed", claimedBy: "a", board: "lobby" }),
    post("p4", { kind: "note", state: undefined }),
  ];
  const task = post("p9", { after: ["p1", "p2", "p3", "p4", "p5"] });
  expect(waitingOn(task, [...posts, task])).toEqual(["p2", "p3"]);
});

test("a task without after, or whose tasks are all done or gone, waits on nothing", () => {
  expect(waitingOn(post("p1"), [post("p1")])).toEqual([]);
  const task = post("p9", { after: ["p1", "p2"] });
  expect(waitingOn(task, [post("p1", { state: "done" }), task])).toEqual([]);
});
