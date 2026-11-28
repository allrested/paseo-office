import { describe, expect, it } from "vitest";
import type { OfficeAgent, Post } from "../shared/contracts.js";
import type { OfficeRoom } from "../shared/model.js";
import {
  blockedLine,
  taskAttentionNote,
  taskAttentionRows,
  taskPreview,
  type TaskAttentionRow,
} from "./task-attention.js";

const NOW = Date.parse("2026-11-28T12:00:00.000Z");

function post(seq: number, fields: Partial<Post> = {}): Post {
  const at = `2026-11-28T09:00:${String(seq).padStart(2, "0")}.000Z`;
  return {
    id: `p${seq}`,
    seq,
    board: "lobby",
    kind: "task",
    text: `Task ${seq}`,
    author: "user",
    state: "claimed",
    claimedBy: "a1",
    createdAt: at,
    updatedAt: at,
    ...fields,
  };
}

function room(id: string, name: string, posts: Post[]): OfficeRoom {
  const lobby = id === "lobby";
  return {
    id,
    name,
    subtitle: null,
    lobby,
    workspace: null,
    rows: [],
    posts,
    todos: lobby ? posts.filter((item) => item.kind === "task") : [],
    done: [],
  };
}

const agents = new Map<string, OfficeAgent>([
  ["a1", { id: "a1", title: "Builder" } as OfficeAgent],
  ["a2", { id: "a2", title: "Tester" } as OfficeAgent],
]);

const ids = (rows: TaskAttentionRow[]) => rows.map((row) => row.post.id);

describe("task attention rows", () => {
  it("lists the blocked tasks of every board, oldest first, with holder, reason and board", () => {
    const model = {
      agents,
      rooms: [
        room("lobby", "Lobby", [post(5, { blocked: "Which region?" })]),
        room("w1", "Checkout", [post(2, { board: "w1", claimedBy: "a2", blocked: "API key?" })]),
      ],
    };
    const rows = taskAttentionRows(model, NOW);
    expect(ids(rows)).toEqual(["p2", "p5"]);
    expect(rows[0]).toMatchObject({
      kind: "blocked",
      board: "Checkout",
      holder: "Tester",
      reason: "API key?",
    });
    expect(rows[1]).toMatchObject({ board: "Lobby", holder: "Builder", reason: "Which region?" });
  });

  it("leaves out what is not blocked: open, claimed, done tasks and notes", () => {
    const model = {
      agents,
      rooms: [
        room("lobby", "Lobby", [
          post(1, { state: "open", claimedBy: undefined }),
          post(2),
          post(3, { state: "done", blocked: "stale" }),
          post(4, { kind: "note", state: undefined, claimedBy: undefined }),
        ]),
      ],
    };
    expect(taskAttentionRows(model, NOW)).toEqual([]);
  });

  it("lists a blocked lobby task once, not again as its copy on the room's board", () => {
    const lobbyTask = post(3, { link: "p4", blocked: "Which region?" });
    const copy = post(4, { board: "w1", link: "p3", blocked: "Which region?" });
    const model = {
      agents,
      rooms: [room("lobby", "Lobby", [lobbyTask]), room("w1", "Checkout", [copy])],
    };
    expect(ids(taskAttentionRows(model, NOW))).toEqual(["p3"]);
  });

  it("lists the copy when its lobby task is not in the model", () => {
    const copy = post(4, { board: "w1", link: "p3", blocked: "Which region?" });
    const model = { agents, rooms: [room("lobby", "Lobby", []), room("w1", "Checkout", [copy])] };
    const rows = taskAttentionRows(model, NOW);
    expect(ids(rows)).toEqual(["p4"]);
    expect(rows[0]?.board).toBe("Checkout");
  });
});

describe("task attention words", () => {
  it("says how many need you, and nothing without rows", () => {
    const row = (seq: number) =>
      taskAttentionRows(
        { agents, rooms: [room("lobby", "Lobby", [post(seq, { blocked: "?" })])] },
        NOW,
      )[0] as TaskAttentionRow;
    expect(taskAttentionNote([])).toBeNull();
    expect(taskAttentionNote([row(1)])).toBe("1 needs you");
    expect(taskAttentionNote([row(1), row(2)])).toBe("2 need you");
  });

  it("names the holder and what it needs", () => {
    expect(blockedLine({ holder: "Builder", reason: "Which region?" })).toBe(
      "Builder needs: Which region?",
    );
    expect(blockedLine({ holder: null, reason: "Which region?" })).toBe("Needs you: Which region?");
  });

  it("shows a task's text in two lines at most, cut by its text", () => {
    expect(taskPreview("Ship it")).toBe("Ship it");
    expect(taskPreview("one\ntwo\nthree")).toBe("one\ntwo…");
    expect(taskPreview("x".repeat(200))).toBe(`${"x".repeat(120)}…`);
  });
});
