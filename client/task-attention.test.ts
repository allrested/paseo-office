import { describe, expect, it } from "vitest";
import type { OfficeAgent, Post } from "../shared/contracts.js";
import type { OfficeRoom } from "../shared/model.js";
import {
  blockedLine,
  NUDGE_TEXT,
  STALL_MS,
  stalledLine,
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

function withStatus(...statuses: [string, OfficeAgent["status"]][]): Map<string, OfficeAgent> {
  const copy = new Map(agents);
  for (const [id, status] of statuses) copy.set(id, { ...copy.get(id), status } as OfficeAgent);
  return copy;
}
const stalledAt = (ago: number) => new Date(NOW - ago).toISOString();

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

describe("stalled rows", () => {
  it("lists a claim whose holder stopped on an error, however recent", () => {
    const model = {
      agents: withStatus(["a1", "error"]),
      rooms: [room("lobby", "Lobby", [post(1, { updatedAt: stalledAt(1000) })])],
    };
    const rows = taskAttentionRows(model, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "stalled", holder: "Builder", reason: null });
  });

  it("lists an idle holder's claim from two minutes on, not just before", () => {
    const at = (ago: number) => ({
      agents: withStatus(["a1", "idle"]),
      rooms: [room("lobby", "Lobby", [post(1, { updatedAt: stalledAt(ago) })])],
    });
    expect(STALL_MS).toBe(120_000);
    expect(taskAttentionRows(at(STALL_MS - 1), NOW)).toEqual([]);
    expect(ids(taskAttentionRows(at(STALL_MS), NOW))).toEqual(["p1"]);
  });

  it("lists nothing for a running or initializing holder, the user or an unknown agent", () => {
    const old = stalledAt(60 * 60_000);
    const rooms = [
      room("lobby", "Lobby", [
        post(1, { updatedAt: old }),
        post(2, { updatedAt: old, claimedBy: "a2" }),
        post(3, { updatedAt: old, claimedBy: "user" }),
        post(4, { updatedAt: old, claimedBy: "ghost" }),
      ]),
    ];
    const model = { agents: withStatus(["a1", "running"], ["a2", "initializing"]), rooms };
    expect(taskAttentionRows(model, NOW)).toEqual([]);
  });

  it("does not list a blocked task as stalled too", () => {
    const model = {
      agents: withStatus(["a1", "error"]),
      rooms: [room("lobby", "Lobby", [post(1, { blocked: "Which region?" })])],
    };
    const rows = taskAttentionRows(model, NOW);
    expect(rows.map((row) => row.kind)).toEqual(["blocked"]);
  });

  it("lists a stalled lobby task once, not again as its copy", () => {
    const old = stalledAt(5 * 60_000);
    const model = {
      agents: withStatus(["a1", "idle"]),
      rooms: [
        room("lobby", "Lobby", [post(3, { link: "p4", updatedAt: old })]),
        room("w1", "Checkout", [post(4, { board: "w1", link: "p3", updatedAt: old })]),
      ],
    };
    expect(ids(taskAttentionRows(model, NOW))).toEqual(["p3"]);
  });

  it("puts blocked rows first, then stalled ones, each oldest first", () => {
    const old = stalledAt(5 * 60_000);
    const model = {
      agents: withStatus(["a1", "error"], ["a2", "idle"]),
      rooms: [
        room("lobby", "Lobby", [
          post(9, { blocked: "Late?" }),
          post(4, { claimedBy: "a2", updatedAt: old }),
          post(2, { updatedAt: old }),
          post(7, { blocked: "Early?" }),
        ]),
      ],
    };
    expect(ids(taskAttentionRows(model, NOW))).toEqual(["p7", "p9", "p2", "p4"]);
  });
});

describe("task attention words", () => {
  it("counts by kind: blocked, then stalled", () => {
    const old = stalledAt(5 * 60_000);
    const rows = taskAttentionRows(
      {
        agents: withStatus(["a1", "error"]),
        rooms: [
          room("lobby", "Lobby", [
            post(1),
            post(2, { claimedBy: "a1", blocked: "?" }),
            post(3, { claimedBy: "a1", blocked: "?", updatedAt: old }),
          ]),
        ],
      },
      NOW,
    );
    expect(taskAttentionNote(rows)).toBe("2 need you · 1 stalled");
    expect(taskAttentionNote(rows.filter((row) => row.kind === "stalled"))).toBe("1 stalled");
    expect(taskAttentionNote(rows.slice(0, 1))).toBe("1 needs you");
  });

  it("says why a claim is listed", () => {
    expect(stalledLine({ holder: "Builder", cause: "error" })).toBe("Builder stopped on an error");
    expect(stalledLine({ holder: "Builder", cause: "idle" })).toBe("Builder is idle");
  });

  it("nudges with its fixed text", () => {
    expect(NUDGE_TEXT).toBe(
      "Status check: finish with office_update done and a short result, or block with what you need.",
    );
  });

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
