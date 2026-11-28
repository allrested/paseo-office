import { describe, expect, it } from "vitest";
import type { Post } from "../shared/contracts.js";
import { columnOf, kanbanColumns, kanbanWide, type KanbanColumn } from "./kanban-model.js";

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

/** Each column's id and its posts' ids. */
const layout = (columns: KanbanColumn[]) => columns.map((c) => [c.id, c.posts.map((p) => p.id)]);

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
  it("puts a claimed task with a block in Needs you, between In progress and Done", () => {
    const posts = [
      post("p1", { state: "claimed", claimedBy: "a1" }),
      post("p2", { state: "claimed", claimedBy: "a1", blocked: "Which region?" }),
      post("p3", { state: "done" }),
    ];
    expect(posts.map((p) => columnOf(p, posts))).toEqual(["progress", "needs", "done"]);
    expect(layout(kanbanColumns(posts))).toEqual([
      ["todo", []],
      ["progress", ["p1"]],
      ["needs", ["p2"]],
      ["done", ["p3"]],
    ]);
    expect(kanbanColumns([post("p1", { state: "claimed" })]).map((c) => c.id)).toEqual([
      "todo",
      "progress",
    ]);
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
  it("leaves a reply out of Notes: it shows under its task", () => {
    const posts = [
      post("p1"),
      post("p2", { kind: "note", state: undefined, replyTo: "p1" }),
      post("p3", { kind: "note", state: undefined }),
    ];
    const columns = kanbanColumns(posts);
    expect(layout(columns)).toEqual([
      ["todo", ["p1"]],
      ["progress", []],
      ["notes", ["p3"]],
    ]);
    expect(
      kanbanColumns([post("p1"), post("p2", { kind: "note", replyTo: "p1" })]).map((c) => c.id),
    ).toEqual(["todo", "progress"]);
  });
  it("is wide from 720", () => {
    expect([kanbanWide(719), kanbanWide(720)]).toEqual([false, true]);
  });
});
