import { expect, test } from "vitest";
import type { OfficeAgent, OfficeSnapshot, Post } from "../shared/contracts.js";
import { buildOfficeModel, type OfficeModel, type OfficeRow } from "../shared/model.js";
import {
  authorName,
  boardPreview,
  clearQuestion,
  officeWork,
  orderBoardPosts,
  postMeta,
  postStateLabel,
  queuedWakes,
  repliesOf,
  resultPreview,
  roomAgents,
  stepMark,
  todoMeta,
  todoPreview,
  topLevel,
  wakeSummary,
  workText,
} from "./board-text.js";
import { PLAN_DESKS, worldBoardRows, worldPeople } from "./world/adapter.js";

const AGENTS = new Map<string, OfficeAgent>([
  [
    "a1",
    {
      id: "a1",
      title: "Planner",
      provider: "claude",
      model: null,
      status: "idle",
      workspaceId: "w1",
      parentAgentId: null,
      permissions: [],
      createdAt: "2026-11-11T08:00:00.000Z",
    },
  ],
]);
const name = (author: string) => authorName(author, AGENTS);

function post(seq: number, fields: Partial<Post>): Post {
  return {
    id: `p${seq}`,
    seq,
    board: "w1",
    kind: "task",
    text: "t",
    author: "user",
    state: "open",
    createdAt: `2026-11-11T09:0${seq}:00.000Z`,
    updatedAt: `2026-11-11T09:0${seq}:00.000Z`,
    ...fields,
  };
}

test("authors read as You, the agent's title, or a short id", () => {
  expect(name("user")).toBe("You");
  expect(name("a1")).toBe("Planner");
  expect(name("0123456789abcdef")).toBe("Agent 01234567");
});

test("a post's meta line gives its state, the claimer, and from → to", () => {
  expect(postStateLabel(post(1, {}), name)).toBe("Task · open");
  expect(postMeta(post(1, { state: "claimed", claimedBy: "a1", to: "a1" }), name, teamLabel)).toBe(
    "Task · claimed by Planner · You → Planner",
  );
  expect(postMeta(post(2, { kind: "note", state: undefined, author: "a1" }), name, teamLabel)).toBe(
    "Note · Planner",
  );
});

test("a board lists open tasks, then claimed tasks, then notes, each oldest first", () => {
  const posts = [
    post(1, { kind: "note", state: undefined }),
    post(2, { state: "claimed", claimedBy: "a1" }),
    post(3, {}),
    post(4, {}),
  ];
  expect(orderBoardPosts(posts).map((item) => item.id)).toEqual(["p3", "p4", "p2", "p1"]);
});

test("posts made in the same instant keep the order they were made in", () => {
  const at = "2026-11-11T09:00:00.000Z";
  const posts = [
    post(7, { createdAt: at }),
    post(6, { createdAt: at }),
    post(5, { createdAt: at }),
  ];
  expect(orderBoardPosts(posts).map((item) => item.id)).toEqual(["p5", "p6", "p7"]);
});

test("a room card shows the first three posts of its board and counts the rest", () => {
  const posts = [
    post(1, { kind: "note", state: undefined }),
    post(2, { state: "claimed", claimedBy: "a1" }),
    post(3, {}),
    post(4, {}),
    post(5, { kind: "note", state: undefined }),
  ];
  // Open tasks come first, so they are what a full board shows on its card.
  const preview = boardPreview(posts);
  expect(preview.shown.map((item) => item.id)).toEqual(["p3", "p4", "p2"]);
  expect(preview.more).toBe(2);
  expect(boardPreview(posts.slice(0, 3))).toEqual({
    shown: orderBoardPosts(posts.slice(0, 3)),
    more: 0,
  });
  expect(boardPreview([])).toEqual({ shown: [], more: 0 });
});

test("a task's replies are the notes under it, oldest first; a task's result is no reply", () => {
  const task = post(1, { result: "Shipped" });
  const other = post(2, {});
  const later = post(5, { kind: "note", state: undefined, replyTo: "p1", text: "Thanks" });
  const first = post(3, { kind: "note", state: undefined, replyTo: "p1", text: "Which branch?" });
  const elsewhere = post(4, { kind: "note", state: undefined, replyTo: "p2" });
  const loose = post(6, { kind: "note", state: undefined });
  const posts = [task, other, later, first, elsewhere, loose];
  expect(repliesOf(task, posts).map((item) => item.id)).toEqual(["p3", "p5"]);
  expect(repliesOf(other, posts).map((item) => item.id)).toEqual(["p4"]);
  expect(repliesOf(loose, posts)).toEqual([]);
});

test("replies show under their task, so the top level and a card's count leave them out", () => {
  const posts = [
    post(1, {}),
    post(2, { kind: "note", state: undefined, replyTo: "p1" }),
    post(3, { kind: "note", state: undefined }),
    post(4, { kind: "note", state: undefined, replyTo: "p1" }),
  ];
  expect(topLevel(posts).map((item) => item.id)).toEqual(["p1", "p3"]);
  expect(boardPreview(posts)).toEqual({ shown: [posts[0], posts[2]], more: 0 });
  expect(boardPreview(posts, 1)).toEqual({ shown: [posts[0]], more: 1 });
});

test("a result shows its first three lines and 160 characters, and says when it left some out", () => {
  expect(resultPreview("Shipped in 1.4.2")).toEqual({ shown: "Shipped in 1.4.2", cut: false });
  expect(resultPreview("one\ntwo\nthree")).toEqual({ shown: "one\ntwo\nthree", cut: false });
  const full = "x".repeat(160);
  expect(resultPreview(full)).toEqual({ shown: full, cut: false });
  expect(resultPreview(`${full}y`)).toEqual({ shown: `${full}…`, cut: true });
  expect(resultPreview("one\ntwo\nthree\nfour")).toEqual({ shown: "one\ntwo\nthree…", cut: true });
  const words = "The build passed on every target. ".repeat(10);
  const long = resultPreview(words);
  expect(long.cut).toBe(true);
  expect(long.shown).toBe(`${words.slice(0, 160).trimEnd()}…`);
  expect(long.shown.length).toBeLessThanOrEqual(161);
});

test("a room's card counts the same posts with done tasks on the board", () => {
  const model = buildOfficeModel({
    agents: [],
    workspaces: [{ id: "w1", name: "shop-api", projectName: "shop" }],
    activity: {},
    boards: { w1: [post(1, {}), post(2, { state: "done" }), post(3, { state: "done" })] },
    wake: { paused: false, queued: {} },
  });
  const room = model.rooms.find((candidate) => candidate.id === "w1");
  expect(room?.done.map((item) => item.id)).toEqual(["p2", "p3"]);
  expect(boardPreview(room?.posts ?? [])).toEqual({ shown: [post(1, {})], more: 0 });
});

test("the wake count says how many posts wait, and nothing when none do", () => {
  expect(queuedWakes({ paused: false, queued: { a: 2, b: 1 } })).toBe(3);
  expect(wakeSummary({ paused: false, queued: {} })).toBe(null);
  expect(wakeSummary({ paused: false, queued: { a: 2 } })).toBe("2 waiting");
  // Paused is what the switch beside the count shows; the words say what it cannot.
  expect(wakeSummary({ paused: true, queued: {} })).toBe(null);
  expect(wakeSummary({ paused: true, queued: { a: 1 } })).toBe("1 waiting");
});

const PEOPLE = new Map([
  ["a1", "Ali"],
  ["a2", "Sara"],
]);
const person = (author: string) => PEOPLE.get(author) ?? author;
const TEAMS = new Map([["t1", "QA-PR"]]);
const teamLabel = (id: string) => TEAMS.get(id) ?? id;
const open = post(1, {});
const done = post(2, { state: "done" });
const claimed = (by: string) => post(3, { state: "claimed", claimedBy: by });

test("a to-do's meta names who claimed it and whom it names", () => {
  expect(todoMeta(claimed("a1"), person, teamLabel)).toBe("claimed by Ali");
  expect(todoMeta({ ...open, to: "a2" }, person, teamLabel)).toBe("for Sara");
  expect(todoMeta({ ...claimed("a1"), to: "a2" }, person, teamLabel)).toBe(
    "claimed by Ali · for Sara",
  );
  // A done to-do keeps its claimer, but it is no longer claimed.
  expect(todoMeta({ ...done, claimedBy: "a1" }, person, teamLabel)).toBeNull();
  expect(todoMeta(open, person, teamLabel)).toBeNull();
});

test("a team task says for team <name>, and the id once the team is gone", () => {
  expect(todoMeta({ ...open, team: "t1" }, person, teamLabel)).toBe("for team QA-PR");
  expect(todoMeta({ ...claimed("a1"), team: "t1" }, person, teamLabel)).toBe(
    "claimed by Ali · for team QA-PR",
  );
  expect(todoMeta({ ...open, team: "gone" }, person, teamLabel)).toBe("for team gone");
  expect(postMeta({ ...open, team: "t1" }, person, teamLabel)).toBe(
    "Task · open · user · for team QA-PR",
  );
  expect(postMeta({ ...open, team: "gone" }, person, teamLabel)).toBe(
    "Task · open · user · for team gone",
  );
});

test("a lobby task and its copy each say where the other is", () => {
  const task = post(1, { board: "lobby", state: "claimed", claimedBy: "a1", link: "p5" });
  const copy = post(5, { state: "claimed", claimedBy: "a1", link: "p1" });
  expect(todoMeta(task, person, teamLabel)).toBe("claimed by Ali · on Ali's board");
  expect(todoMeta({ ...task, state: "done" }, person, teamLabel)).toBe("on Ali's board");
  expect(postMeta(task, person, teamLabel)).toBe("Task · claimed by Ali · user · on Ali's board");
  expect(postMeta(copy, person, teamLabel)).toBe(
    "Task · claimed by Ali · user · from lobby task p1",
  );
  expect(postMeta({ ...copy, state: "done" }, person, teamLabel)).toBe(
    "Task · done · user · from lobby task p1",
  );
});

test("the clear question counts finished to-dos", () => {
  expect(clearQuestion(1)).toBe("Delete 1 finished to-do?");
  expect(clearQuestion(3)).toBe("Delete 3 finished to-dos?");
});

test("the lobby card counts open and claimed to-dos only", () => {
  // In to-do order, as room.todos holds them: open and claimed first, then done.
  const todos = [
    post(1, {}),
    post(2, { state: "claimed", claimedBy: "a1" }),
    post(3, {}),
    post(4, {}),
    post(5, {}),
    post(6, { state: "done" }),
    post(7, { state: "done" }),
  ];
  const preview = todoPreview(todos);
  expect(preview.shown.map((item) => item.id)).toEqual(["p1", "p2", "p3"]);
  expect(preview.more).toBe(2);
  expect(todoPreview(todos.slice(5))).toEqual({ shown: [], more: 0 });
  expect(todoPreview([])).toEqual({ shown: [], more: 0 });
});

test("a checklist step is marked in progress or waiting", () => {
  expect(stepMark("in_progress")).toBe("◐");
  expect(stepMark("pending")).toBe("○");
});

function worker(id: string, fields: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: `Agent ${id}`,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: `2026-11-11T08:00:0${id.length}.000Z`,
    ...fields,
  };
}

/** An office of two rooms and the lobby, with these agents and what the host reads of them. */
function office(agents: OfficeAgent[], fields: Partial<OfficeSnapshot> = {}): OfficeModel {
  return buildOfficeModel({
    agents,
    workspaces: [
      { id: "w1", name: "shop-api", projectName: "shop" },
      { id: "w2", name: "landing", projectName: "site" },
    ],
    activity: {},
    boards: {},
    wake: { paused: false, queued: {} },
    ...fields,
  });
}

const ASKING = { id: "q1", kind: "tool" as const, title: "Run a command" };
/** One agent in each state a board tells apart, the last two in the second room and the lobby. */
const EVERYONE = [
  worker("ask", { status: "running", permissions: [ASKING] }),
  worker("stuck", { status: "error" }),
  worker("lead"),
  worker("sub", { status: "running", parentAgentId: "lead" }),
  worker("busy", { status: "running" }),
  worker("quiet", { status: "running" }),
  worker("new", { status: "initializing", workspaceId: "w2" }),
  worker("rest", { workspaceId: null }),
];
const READ = { activity: { busy: "Running Bash", sub: "Thinking" } };

function rowOf(model: OfficeModel, agentId: string): OfficeRow {
  const row = model.rooms.flatMap((room) => room.rows).find((each) => each.agent.id === agentId);
  if (row === undefined) throw new Error(`no row for ${agentId}`);
  return row;
}

test("a board says what each agent is at, who needs you first", () => {
  const model = office(EVERYONE, READ);
  const text = (agentId: string) => workText(rowOf(model, agentId));
  expect(text("ask")).toBe("Waiting for your answer");
  expect(text("stuck")).toBe("Stopped on an error");
  expect(text("lead")).toBe("Waiting on 1 sub-agent");
  expect(text("busy")).toBe("Running Bash");
  // No line has been read yet of a turn that has just begun, or of an agent that is starting.
  expect(text("quiet")).toBe("Working");
  expect(text("new")).toBe("Working");
  expect(text("rest")).toBe("Resting");
});

test("a board says of an agent what the 3D whiteboard says of the person at its desk", () => {
  const model = office(EVERYONE, READ);
  const whiteboard = worldBoardRows(model, worldPeople(model, PLAN_DESKS.hq).sessions);
  expect(whiteboard).toHaveLength(EVERYONE.length);
  for (const line of whiteboard) expect(workText(rowOf(model, line.id))).toBe(line.text);
});

const STEPS = [
  { text: "Run typecheck", status: "in_progress" as const },
  { text: "Commit", status: "pending" as const },
];

test("a room's board lists every agent of the room, each with its unfinished steps", () => {
  const model = office(EVERYONE, { ...READ, checklists: { busy: STEPS, rest: STEPS } });
  const room = model.rooms.find((each) => each.id === "w1");
  if (room === undefined) throw new Error("no room w1");
  const agents = roomAgents(room, model.agentTasks);
  // The room's own order: a sub-agent under the agent that started it.
  expect(agents.map((entry) => entry.row.agent.id)).toEqual(room.rows.map((row) => row.agent.id));
  expect(agents.map((entry) => [entry.row.agent.id, entry.steps])).toEqual([
    ["ask", []],
    ["busy", STEPS],
    ["lead", []],
    ["sub", []],
    ["quiet", []],
    ["stuck", []],
  ]);
});

test("the lobby's board lists who is at work in every room, and who has steps left", () => {
  const model = office(EVERYONE, { ...READ, checklists: { rest: STEPS } });
  const teams = officeWork(model.rooms, model.agentTasks);
  expect(
    teams.map((team) => [team.room.name, team.agents.map((entry) => entry.row.agent.id)]),
  ).toEqual([
    // A resting agent stays on the list while its checklist has steps left.
    ["Lobby", ["rest"]],
    ["shop-api", ["ask", "busy", "lead", "sub", "quiet", "stuck"]],
    ["landing", ["new"]],
  ]);
  expect(teams[0]?.agents[0]?.steps).toEqual(STEPS);
});

test("the lobby's board leaves out who rests with nothing left, and a room of only those", () => {
  const model = office([worker("rest"), worker("busy", { status: "running", workspaceId: "w2" })]);
  const teams = officeWork(model.rooms, model.agentTasks);
  expect(teams.map((team) => team.room.name)).toEqual(["landing"]);
  expect(officeWork(office([worker("rest")]).rooms, [])).toEqual([]);
});
