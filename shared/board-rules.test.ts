import { describe, expect, test } from "vitest";
import type { Post } from "./contracts.js";
import { STALL_MS, stallCause, waitingOn } from "./board-rules.js";

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

describe("the stall rule", () => {
  const NOW = Date.parse("2026-11-11T09:10:00.000Z");
  const claimed = (fields: Partial<Post> = {}) =>
    post("p1", {
      state: "claimed",
      claimedBy: "a",
      updatedAt: new Date(NOW - STALL_MS).toISOString(),
      ...fields,
    });

  test("a claim whose holder stopped on an error, is at home, or sat idle 2 minutes is stalled", () => {
    expect(STALL_MS).toBe(120_000);
    expect(stallCause(claimed(), NOW, () => "error")).toBe("error");
    expect(stallCause(claimed(), NOW, () => "home")).toBe("home");
    expect(stallCause(claimed(), NOW, () => "idle")).toBe("idle");
  });

  test("an idle holder of a post changed under 2 minutes ago, or one at work, is not", () => {
    const fresh = claimed({ updatedAt: new Date(NOW - STALL_MS + 1).toISOString() });
    expect(stallCause(fresh, NOW, () => "idle")).toBeNull();
    expect(stallCause(claimed(), NOW, () => "running")).toBeNull();
    expect(stallCause(claimed(), NOW, () => undefined)).toBeNull();
  });

  test("an open, done, blocked or unheld task and a note are never stalled", () => {
    const home = () => "home" as const;
    expect(stallCause(post("p1"), NOW, home)).toBeNull();
    expect(stallCause(claimed({ state: "done" }), NOW, home)).toBeNull();
    expect(stallCause(claimed({ blocked: "Which region?" }), NOW, home)).toBeNull();
    expect(stallCause(claimed({ claimedBy: undefined }), NOW, home)).toBeNull();
    expect(stallCause(claimed({ kind: "note" }), NOW, home)).toBeNull();
  });
});
