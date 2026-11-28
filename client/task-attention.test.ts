import { describe, expect, it } from "vitest";
import type { OfficeAgent, Post } from "../shared/contracts.js";
import type { DutyRow } from "../shared/duties.js";
import type { OfficeModel, OfficeRoom } from "../shared/model.js";
import {
  blockedLine,
  mergedLine,
  NUDGE_TEXT,
  STALL_MS,
  stalledLine,
  taskAttentionNote,
  taskAttentionRows as rowsOfModel,
  taskPreview,
  type TaskAttentionRow,
} from "./task-attention.js";

const NOW = Date.parse("2026-11-28T12:00:00.000Z");

type Input = Pick<OfficeModel, "rooms" | "agents"> &
  Partial<Pick<OfficeModel, "roomOfAgent" | "home" | "duties">>;
/**
 * The rows of a model; one without `roomOfAgent` has every agent in the lobby, without `home` none
 * at home, and without `duties` an empty duty board.
 */
const taskAttentionRows = (model: Input, now: number) =>
  rowsOfModel({ roomOfAgent: new Map(), home: new Map(), duties: [], ...model }, now);

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

function room(
  id: string,
  name: string,
  posts: Post[],
  pullRequest?: Partial<NonNullable<OfficeRoom["workspace"]>["pullRequest"]>,
): OfficeRoom {
  const lobby = id === "lobby";
  return {
    id,
    name,
    subtitle: null,
    lobby,
    workspace:
      lobby || pullRequest === undefined
        ? null
        : ({
            id,
            pullRequest: {
              number: null,
              url: "https://example.test/pr",
              title: "",
              ...pullRequest,
            },
          } as OfficeRoom["workspace"]),
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

  it("lists a claim whose holder is at home at once, by the holder's name", () => {
    const model = {
      agents: new Map<string, OfficeAgent>(),
      home: new Map([["a1", { id: "a1", title: "Builder", status: "closed" } as OfficeAgent]]),
      rooms: [room("lobby", "Lobby", [post(1, { updatedAt: stalledAt(0) })])],
    };
    const rows = taskAttentionRows(model, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "stalled", cause: "home", holder: "Builder" });
    expect(stalledLine(rows[0] as TaskAttentionRow)).toBe("Builder is at home");
  });

  it("keeps a blocked task of a holder at home a blocked row, with what it asked", () => {
    const model = {
      agents: new Map<string, OfficeAgent>(),
      home: new Map([["a1", { id: "a1", title: "Builder", status: "closed" } as OfficeAgent]]),
      rooms: [room("lobby", "Lobby", [post(1, { blocked: "Which region?" })])],
    };
    const rows = taskAttentionRows(model, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "blocked", holder: "Builder", reason: "Which region?" });
    expect(blockedLine(rows[0] as TaskAttentionRow)).toBe("Builder needs: Which region?");
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

describe("duty rows", () => {
  /** A duty of the duty board, held by a1 unless the fields say otherwise. */
  const duty = (seq: number, fields: Partial<Post> = {}): DutyRow => ({
    post: post(seq, {
      board: "duty",
      text: `Duty ${seq}\n\nDo it well`,
      duty: { id: `d${seq}`, day: "2026-11-28" },
      ...fields,
    }),
    duty: null,
    owed: false,
    replies: [],
  });

  it("lists a blocked duty with what its holder needs, on the duty board", () => {
    const model = {
      agents,
      rooms: [room("lobby", "Lobby", [])],
      duties: [duty(3, { blocked: "Which branch?" })],
    };
    const rows = taskAttentionRows(model, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "blocked",
      board: "Duty board",
      holder: "Builder",
      reason: "Which branch?",
    });
    expect(rows[0]?.post.board).toBe("duty");
  });

  it("lists a duty nobody works on by the rules of any claim: error, idle for two minutes, at home", () => {
    const old = stalledAt(STALL_MS);
    const fresh = stalledAt(STALL_MS - 1);
    const rooms = [room("lobby", "Lobby", [])];
    const causes = (model: Input) => taskAttentionRows(model, NOW).map((row) => row.cause);
    expect(causes({ agents: withStatus(["a1", "error"]), rooms, duties: [duty(1)] })).toEqual([
      "error",
    ]);
    const idle = withStatus(["a1", "idle"]);
    expect(causes({ agents: idle, rooms, duties: [duty(1, { updatedAt: fresh })] })).toEqual([]);
    expect(causes({ agents: idle, rooms, duties: [duty(1, { updatedAt: old })] })).toEqual([
      "idle",
    ]);
    const home = new Map([["a1", { id: "a1", title: "Builder", status: "closed" } as OfficeAgent]]);
    expect(
      causes({ agents: new Map(), home, rooms, duties: [duty(1, { updatedAt: fresh })] }),
    ).toEqual(["home"]);
  });

  it("lists a duty whose holder's pull request is merged", () => {
    const model = {
      agents,
      roomOfAgent: new Map([["a1", "w1"]]),
      rooms: [room("lobby", "Lobby", []), room("w1", "Checkout", [], { state: "merged" } as never)],
      duties: [duty(1)],
    };
    expect(taskAttentionRows(model, NOW)).toMatchObject([{ kind: "merged", board: "Duty board" }]);
  });

  it("gives no row for an open or a done duty, nor one its holder is at", () => {
    const model = {
      agents: withStatus(["a1", "running"]),
      rooms: [room("lobby", "Lobby", [])],
      duties: [
        duty(1, { state: "open", claimedBy: undefined }),
        duty(2, { state: "done", result: "Built" }),
        duty(3),
      ],
    };
    expect(taskAttentionRows(model, NOW)).toEqual([]);
  });

  it("sorts duties among the other boards' tasks, by kind and then age", () => {
    const model = {
      agents: withStatus(["a1", "error"]),
      rooms: [room("lobby", "Lobby", [post(4, { blocked: "Late?" }), post(2)])],
      duties: [duty(3, { blocked: "Early?" }), duty(1)],
    };
    expect(ids(taskAttentionRows(model, NOW))).toEqual(["p3", "p4", "p1", "p2"]);
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
    expect(stalledLine({ holder: "Builder", cause: "home" })).toBe("Builder is at home");
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

describe("merged rows", () => {
  /** a1 works in w1, whose pull request is in `state`. */
  const workspaceModel = (state: string, posts: Post[], extra: Partial<Input> = {}): Input => ({
    agents,
    roomOfAgent: new Map([["a1", "w1"]]),
    rooms: [room("lobby", "Lobby", []), room("w1", "Checkout", posts, { state } as never)],
    ...extra,
  });

  it("lists a claimed task whose holder's pull request is merged", () => {
    const rows = taskAttentionRows(workspaceModel("merged", [post(1, { board: "w1" })]), NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "merged",
      board: "Checkout",
      holder: "Builder",
      reason: null,
    });
  });

  it.each(["open", "draft", "closed"])("does not list it while the pull request is %s", (state) => {
    expect(taskAttentionRows(workspaceModel(state, [post(1, { board: "w1" })]), NOW)).toEqual([]);
  });

  it("does not list an open or done task, nor one whose holder is not an agent here", () => {
    const posts = [
      post(1, { board: "w1", state: "open", claimedBy: undefined }),
      post(2, { board: "w1", state: "done" }),
      post(3, { board: "w1", claimedBy: "gone" }),
      post(4, { board: "w1", claimedBy: "user" }),
    ];
    expect(taskAttentionRows(workspaceModel("merged", posts), NOW)).toEqual([]);
  });

  it("does not list a task whose holder is in the lobby", () => {
    const model = workspaceModel("merged", [], { roomOfAgent: new Map([["a1", "lobby"]]) });
    model.rooms[0]?.posts.push(post(1));
    expect(taskAttentionRows(model, NOW)).toEqual([]);
  });

  it("lists a lobby task held by that agent, whatever board the task is on", () => {
    const model = workspaceModel("merged", []);
    model.rooms[0]?.posts.push(post(1));
    const rows = taskAttentionRows(model, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "merged", board: "Lobby", holder: "Builder" });
  });

  it("leaves a blocked or stalled task in its own kind", () => {
    const old = stalledAt(5 * 60_000);
    const model = workspaceModel(
      "merged",
      [
        post(1, { board: "w1", blocked: "Which region?" }),
        post(2, { board: "w1", updatedAt: old }),
        post(3, { board: "w1", updatedAt: stalledAt(1000) }),
      ],
      { agents: withStatus(["a1", "idle"]) },
    );
    const rows = taskAttentionRows(model, NOW);
    expect(rows.map((row) => [row.post.id, row.kind])).toEqual([
      ["p1", "blocked"],
      ["p2", "stalled"],
      ["p3", "merged"],
    ]);
  });

  it("lists a lobby task and its copy once, as the lobby task", () => {
    const model = workspaceModel("merged", [post(4, { board: "w1", link: "p3" })]);
    model.rooms[0]?.posts.push(post(3, { link: "p4" }));
    const rows = taskAttentionRows(model, NOW);
    expect(ids(rows)).toEqual(["p3"]);
    expect(rows[0]?.board).toBe("Lobby");
  });

  it("puts merged rows after blocked and stalled ones, each oldest first", () => {
    const old = stalledAt(5 * 60_000);
    const model = workspaceModel(
      "merged",
      [post(8, { board: "w1" }), post(5, { board: "w1" }), post(9, { board: "w1", blocked: "?" })],
      { agents: withStatus(["a2", "idle"]) },
    );
    model.rooms[0]?.posts.push(post(2, { claimedBy: "a2", updatedAt: old }));
    expect(ids(taskAttentionRows(model, NOW))).toEqual(["p9", "p2", "p5", "p8"]);
  });

  it("carries the pull request's number and title when it has them", () => {
    const model = workspaceModel("merged", [post(1, { board: "w1" })]);
    const pr = model.rooms[1]?.workspace?.pullRequest;
    if (pr) Object.assign(pr, { number: 42, title: "Fix the ledger total" });
    expect(taskAttentionRows(model, NOW)[0]?.pullRequest).toBe("#42 Fix the ledger total");
    if (pr) Object.assign(pr, { number: null, title: "" });
    expect(taskAttentionRows(model, NOW)[0]?.pullRequest).toBeUndefined();
  });

  it("counts merged tasks in the note, as the third part", () => {
    const row = (kind: TaskAttentionRow["kind"]) =>
      ({ kind, post: post(1), board: "Lobby", holder: null, reason: null }) as TaskAttentionRow;
    const blocked = row("blocked");
    const stalled = row("stalled");
    const merged = row("merged");
    expect(taskAttentionNote([merged])).toBe("1 merged");
    expect(taskAttentionNote([merged, merged])).toBe("2 merged");
    expect(taskAttentionNote([blocked, merged])).toBe("1 needs you · 1 merged");
    expect(taskAttentionNote([stalled, merged])).toBe("1 stalled · 1 merged");
    expect(taskAttentionNote([blocked, stalled, merged, merged])).toBe(
      "1 needs you · 1 stalled · 2 merged",
    );
  });

  it("says whose pull request is merged", () => {
    expect(mergedLine({ holder: "Builder", pullRequest: "#42 Fix the ledger total" })).toBe(
      "Builder's pull request is merged: #42 Fix the ledger total",
    );
    expect(mergedLine({ holder: "Builder" })).toBe("Builder's pull request is merged");
  });
});
