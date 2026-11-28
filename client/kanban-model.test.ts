import { describe, expect, it } from "vitest";
import type { Post } from "../shared/contracts.js";
import { columnOf, kanbanColumns, kanbanWide } from "./kanban-model.js";

const post = (id: string, extra: Partial<Post> = {}): Post => ({
  id,
  seq: Number(id.slice(1)),
  board: "lobby",
  kind: "task",
  text: id,
  author: "user",
  state: "open",
  createdAt: "2026-11-28T00:00:00.000Z",
  updatedAt: "2026-11-28T00:00:00.000Z",
  ...extra,
});

describe("kanban columns", () => {
  it("puts each kind of post in its column", () => {
    const posts = [
      post("p1"),
      post("p2", { state: "claimed", claimedBy: "a1" }),
      post("p3", { state: "done" }),
      post("p4", { kind: "note", state: undefined }),
    ];
    expect(posts.map((p) => columnOf(p, posts))).toEqual(["todo", "progress", "done", "notes"]);
  });
  it("keeps To do and In progress when empty and drops other empty columns", () => {
    expect(kanbanColumns([]).map((c) => c.id)).toEqual(["todo", "progress"]);
    expect(kanbanColumns([post("p3", { state: "done" })]).map((c) => c.id)).toEqual([
      "todo",
      "progress",
      "done",
    ]);
  });
  it("keeps board order inside a column", () => {
    const columns = kanbanColumns([post("p9"), post("p2")]);
    expect(columns[0]?.posts.map((p) => p.id)).toEqual(["p2", "p9"]);
  });
  it("is wide from 720", () => {
    expect([kanbanWide(719), kanbanWide(720)]).toEqual([false, true]);
  });
});
