import { expect, test } from "vitest";
import {
  AFTER_MAX,
  ChatMessageSchema,
  ChatRequestSchema,
  ChecklistStepSchema,
  chatRpc,
  MachineEventSchema,
  cleanupRpc,
  clearDoneRpc,
  machineSubscription,
  OfficeEventSchema,
  OfficeSnapshotSchema,
  PostSchema,
  worldRpc,
  worldWordsRpc,
  deleteRpc,
  dutyActedRpc,
  incidentsDismissRpc,
  officeStateSubscription,
  postRpc,
  startRpc,
  handOverRpc,
  setWakesPausedRpc,
  updateRpc,
  UpdateActionSchema,
  type OfficeSnapshot,
} from "./contracts.js";

function emptySnapshot(): OfficeSnapshot {
  return {
    agents: [],
    workspaces: [],
    activity: {},
    boards: {},
    wake: { paused: false, queued: {} },
  };
}

test("contract names follow the dotted request convention", () => {
  expect([
    officeStateSubscription.name,
    postRpc.name,
    updateRpc.name,
    deleteRpc.name,
    setWakesPausedRpc.name,
    worldRpc.name,
    worldWordsRpc.name,
    incidentsDismissRpc.name,
  ]).toEqual([
    "office.state",
    "office.post.request",
    "office.update.request",
    "office.delete.request",
    "office.set_wakes_paused.request",
    "office.world.request",
    "office.world.words",
    "office.incidents.dismiss.request",
  ]);
});

test("a snapshot event and a note without state parse", () => {
  const note = {
    id: "p1",
    seq: 1,
    board: "lobby",
    kind: "note",
    text: "Build is green",
    author: "user",
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
  };
  expect(PostSchema.parse(note)).toEqual(note);
  const snapshot = emptySnapshot();
  expect(OfficeEventSchema.parse({ type: "snapshot", state: snapshot })).toEqual({
    type: "snapshot",
    state: snapshot,
  });
});

test("a post longer than 2,000 characters is refused at the boundary", () => {
  const input = { board: "lobby", kind: "note", text: "x".repeat(2001) };
  expect(postRpc.input.safeParse(input).success).toBe(false);
  expect(postRpc.input.safeParse({ ...input, text: "x".repeat(2000) }).success).toBe(true);
});

test("a duty acted out names an agent id of at most 80 characters", () => {
  const input = { id: "p1", agentId: "a".repeat(81) };
  expect(dutyActedRpc.input.safeParse(input).success).toBe(false);
  expect(dutyActedRpc.input.safeParse({ ...input, agentId: "a".repeat(80) }).success).toBe(true);
});

test("the host's readings and the cleanup call are named and bounded", () => {
  expect(machineSubscription.name).toBe("office.machine");
  expect(cleanupRpc.name).toBe("office.machine.cleanup.request");
  expect(MachineEventSchema.safeParse({ type: "unavailable" }).success).toBe(true);
  const reading = {
    type: "reading",
    machine: {
      readAt: "2026-11-16T12:00:00.000Z",
      memory: null,
      cpuPercent: null,
      agents: [
        {
          agentId: "a",
          title: null,
          status: "closed",
          rssBytes: 1024,
          processCount: 1,
          ports: [5173],
          idleSince: null,
          forgotten: true,
        },
      ],
    },
  };
  expect(MachineEventSchema.parse(reading)).toEqual(reading);
  expect(cleanupRpc.input.safeParse({ agentIds: [] }).success).toBe(false);
  expect(cleanupRpc.input.safeParse({ agentIds: [""] }).success).toBe(false);
  expect(cleanupRpc.input.safeParse({ agentIds: ["a"] }).success).toBe(true);
  expect(
    cleanupRpc.input.safeParse({ agentIds: Array.from({ length: 51 }, (_v, i) => `a${i}`) })
      .success,
  ).toBe(false);
});

test("a snapshot without incidents parses", () => {
  const snapshot = emptySnapshot();
  expect(OfficeSnapshotSchema.parse(snapshot)).toEqual(snapshot);
});

test("a snapshot carries the open incidents and each tracker's state", () => {
  const snapshot = {
    ...emptySnapshot(),
    incidents: {
      open: [
        {
          id: "jira:SHOP-12",
          source: "jira",
          key: "SHOP-12",
          title: "Checkout fails",
          url: "https://example.atlassian.net/browse/SHOP-12",
          createdAt: 1_763_359_200_000,
          foundAt: 1_763_359_500_000,
        },
      ],
      problems: { sentry: "Sentry refused the token: check SENTRY_AUTH_TOKEN" },
      jiraReady: true,
      sentryReady: false,
      scheduleError: null,
    },
  };
  expect(OfficeSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  const unknownSource = structuredClone(snapshot);
  unknownSource.incidents.open[0].source = "linear";
  expect(OfficeSnapshotSchema.safeParse(unknownSource).success).toBe(false);
});

test("dismiss takes some ids or none for all, and answers with a count", () => {
  expect(incidentsDismissRpc.input.parse({})).toEqual({});
  expect(incidentsDismissRpc.input.parse({ ids: ["jira:SHOP-12"] })).toEqual({
    ids: ["jira:SHOP-12"],
  });
  expect(incidentsDismissRpc.output.safeParse({ dismissed: 2 }).success).toBe(true);
  expect(incidentsDismissRpc.output.safeParse({ dismissed: -1 }).success).toBe(false);
  expect(incidentsDismissRpc.output.safeParse({ dismissed: 1.5 }).success).toBe(false);
});

test("a snapshot and an activity event carry checklists, and parse without them", () => {
  const steps = { a1: [{ text: "Run typecheck", status: "in_progress" }] };
  expect(OfficeSnapshotSchema.parse({ ...emptySnapshot(), checklists: steps }).checklists).toEqual(
    steps,
  );
  expect(OfficeSnapshotSchema.parse(emptySnapshot()).checklists).toBeUndefined();
  expect(
    OfficeEventSchema.parse({ type: "activity", activity: {}, checklists: steps }),
  ).toMatchObject({ checklists: steps });
});

test("a step is pending or in progress, never completed", () => {
  expect(ChecklistStepSchema.safeParse({ text: "x", status: "completed" }).success).toBe(false);
});

test("clear done names its RPC and needs a board", () => {
  expect(clearDoneRpc.name).toBe("office.board.clear_done.request");
  expect(clearDoneRpc.input.safeParse({ board: "" }).success).toBe(false);
});

test("the chat call names its RPC and takes each op", () => {
  expect(chatRpc.name).toBe("office.chat.request");
  for (const input of [
    { op: "send", text: "@Alice hi", replyTo: "m1" },
    { op: "send", sticker: 3 },
    { op: "react", id: "m1", emoji: "👍" },
    { op: "vote", id: "m1", index: 0 },
    { op: "rsvp", id: "m1", yes: true },
    { op: "recall", id: "m1" },
    { op: "pin", id: "m1" },
    { op: "poll", question: "Lunch?", options: ["Rice", "Noodles"] },
    { op: "send", to: "a1", images: [{ mimeType: "image/jpeg", data: "YQ==" }] },
  ])
    expect(ChatRequestSchema.safeParse(input).success).toBe(true);
  expect(ChatRequestSchema.safeParse({ op: "send", text: "x".repeat(601) }).success).toBe(false);
  for (const input of [
    { op: "pin", id: "" },
    { op: "poll", question: "Lunch?", options: ["Rice"] },
    { op: "poll", question: "Lunch?", options: ["Rice", " "] },
    { op: "send", to: "a1", images: Array(5).fill({ mimeType: "image/jpeg", data: "YQ==" }) },
    { op: "send", to: "a1", images: [{ mimeType: "image/jpeg", data: "not an image" }] },
  ])
    expect(ChatRequestSchema.safeParse(input).success).toBe(false);
});

test("a snapshot and an event carry the chat, and a snapshot parses without it", () => {
  const message = {
    id: "m1",
    at: 1,
    kind: "text",
    from: "me",
    name: "Boss",
    text: "hi",
    reacts: {},
  };
  const chat = { messages: [message], typing: ["Alice"] };
  expect(OfficeSnapshotSchema.parse({ ...emptySnapshot(), chat }).chat).toEqual(chat);
  expect(OfficeSnapshotSchema.parse(emptySnapshot()).chat).toBeUndefined();
  for (const change of [
    { op: "add", message },
    { op: "update", message },
    { op: "typing", names: [] },
    { op: "all", messages: [message] },
    { op: "act", what: "meeting", id: "a1" },
  ])
    expect(OfficeEventSchema.parse({ type: "chat", change })).toEqual({ type: "chat", change });
});

test("a system line has no sender", () => {
  expect(
    ChatMessageSchema.parse({ id: "s", at: 1, kind: "sys", text: "created", reacts: {} }).from,
  ).toBeUndefined();
});

test("weather snapshots validate scene readings and accept an older server", () => {
  const base = emptySnapshot();
  const reading = { kind: "reading", code: 63, temp: 14.2, cloud: 0.9 };
  const parse = (scene: unknown) =>
    OfficeSnapshotSchema.safeParse({ ...base, weather: { scene, readAt: 100, problem: null } })
      .success;
  expect(OfficeSnapshotSchema.parse(base)).not.toHaveProperty("weather");
  expect(parse(reading)).toBe(true);
  for (const scene of [{ kind: "season" }, { kind: "none" }]) expect(parse(scene)).toBe(true);
  for (const bad of [{ code: 100 }, { code: 1.5 }, { cloud: 1.1 }, { kind: "storm" }])
    expect(parse({ ...reading, ...bad })).toBe(false);
});

test("a post carries a block reason, and block is an update action for the tool and the rpc", () => {
  const task = {
    id: "p1",
    seq: 2,
    board: "w1",
    kind: "task",
    text: "Migrate",
    author: "user",
    state: "claimed",
    claimedBy: "a",
    blocked: "Which database?",
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
  };
  expect(PostSchema.parse(task)).toEqual(task);
  expect(UpdateActionSchema.parse("block")).toBe("block");
  expect(updateRpc.input.safeParse({ id: "p1", action: "block", note: "Which?" }).success).toBe(
    true,
  );
});

test("a lobby task carries its roster team's id, and the post rpc takes one", () => {
  const task = {
    id: "p1",
    seq: 1,
    board: "lobby",
    kind: "task",
    text: "Test it",
    author: "user",
    state: "open",
    team: "t2",
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
  };
  expect(PostSchema.parse(task)).toEqual(task);
  const input = { board: "lobby", kind: "task", text: "x" };
  expect(postRpc.input.parse({ ...input, team: "t2" })).toEqual({ ...input, team: "t2" });
  expect(postRpc.input.safeParse({ ...input, team: "" }).success).toBe(false);
});

test("a task carries up to AFTER_MAX task ids it waits on, and the post rpc takes them", () => {
  expect(AFTER_MAX).toBe(5);
  const task = {
    id: "p9",
    seq: 9,
    board: "lobby",
    kind: "task",
    text: "Review it",
    author: "user",
    state: "open",
    after: ["p1", "p2"],
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
  };
  expect(PostSchema.parse(task)).toEqual(task);
  expect(
    PostSchema.safeParse({ ...task, after: ["p1", "p2", "p3", "p4", "p5", "p6"] }).success,
  ).toBe(false);
  const input = { board: "lobby", kind: "task", text: "x" };
  expect(postRpc.input.parse({ ...input, after: ["p1"] })).toEqual({ ...input, after: ["p1"] });
  expect(postRpc.input.safeParse({ ...input, after: [""] }).success).toBe(false);
});

test("the backlog: a post carries it as a boolean, and the start call takes an id", () => {
  const input = { board: "lobby", kind: "task", text: "x" };
  expect(postRpc.input.safeParse({ ...input, backlog: true }).success).toBe(true);
  expect(postRpc.input.safeParse({ ...input, backlog: "yes" }).success).toBe(false);
  expect(startRpc.name).toBe("office.task.start.request");
  expect(startRpc.input.safeParse({ id: "p1" }).success).toBe(true);
  expect(startRpc.input.safeParse({ id: "" }).success).toBe(false);
});

test("a hand-over takes a task's id and answers with the reopened task", () => {
  expect(handOverRpc.name).toBe("office.task.hand_over.request");
  expect(handOverRpc.input.safeParse({ id: "p1" }).success).toBe(true);
  expect(handOverRpc.input.safeParse({ id: "" }).success).toBe(false);
  expect(handOverRpc.output.safeParse({ ok: false, error: "x" }).success).toBe(true);
});
