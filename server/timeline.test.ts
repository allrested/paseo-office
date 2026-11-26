import { expect, test } from "vitest";
import type { OfficeAgent, OfficeWorkspace } from "../shared/contracts.js";
import { doingAt, durationText, weekRecap, DAY_MS } from "../shared/timeline.js";
import {
  TIMELINE_MARKS_MAX,
  TIMELINE_MARKS_SLACK,
  createTimelineLog,
  type TimelineFile,
} from "./timeline.js";

const MIN = 60_000;

function agent(id: string, patch: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: `Agent ${id}`,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-23T00:00:00.000Z",
    ...patch,
  };
}
const WORKSPACES = [{ id: "w1", name: "shop-api" }] as unknown as OfficeWorkspace[];
const PERMISSION = { id: "p1", kind: "tool" as const, title: "Run a command" };

function setup(kept: TimelineFile | null = null, start = 0) {
  let now = start;
  let saved: TimelineFile | null = null;
  const writes: string[] = [];
  const log = createTimelineLog(
    {
      now: () => now,
      // What a file fed by these two calls would hold.
      append: (lines) => {
        writes.push(`append ${lines.length}`);
        saved ??= { version: 1, who: {}, marks: [] };
        for (const line of structuredClone(lines)) {
          if ("w" in line) {
            const { w, ...who } = line;
            saved.who[w] = who;
          } else saved.marks.push(line);
        }
      },
      rewrite: (file) => {
        writes.push(`rewrite ${file.marks.length}`);
        saved = structuredClone(file);
      },
    },
    kept,
  );
  return {
    log,
    at(minutes: number, ...agents: OfficeAgent[]) {
      now = start + minutes * MIN;
      log.view({ agents, workspaces: WORKSPACES });
    },
    clock(minutes: number) {
      now = start + minutes * MIN;
    },
    saved: () => saved,
    writes,
  };
}

test("a lane holds what an agent was at, in order, with its steps and what it cost", () => {
  const { log, at, clock } = setup();
  at(0, agent("a", { costUsd: 1 }));
  at(10, agent("a", { status: "running", costUsd: 1 }));
  clock(11);
  log.steps({ a: { kind: "edit", key: "c1" } });
  // The same call read again is one step.
  log.steps({ a: { kind: "edit", key: "c1" } });
  clock(12);
  log.steps({ a: { kind: "test", key: "c2" } });
  at(20, agent("a", { status: "running", permissions: [PERMISSION], costUsd: 1 }));
  at(25, agent("a", { status: "running", costUsd: 1 }));
  at(30, agent("a", { costUsd: 1.5 }));
  clock(40);

  const { lanes, to } = log.read(0, 60 * MIN);
  expect(to).toBe(40 * MIN);
  expect(lanes).toEqual([
    {
      id: "a",
      name: "Agent a",
      team: "shop-api",
      provider: "claude",
      spans: [
        { from: 0, to: 10 * MIN, state: "rest" },
        { from: 10 * MIN, to: 20 * MIN, state: "work" },
        { from: 20 * MIN, to: 25 * MIN, state: "wait" },
        { from: 25 * MIN, to: 30 * MIN, state: "work" },
        { from: 30 * MIN, to: 40 * MIN, state: "rest" },
      ],
      steps: [
        { at: 11 * MIN, kind: "edit" },
        { at: 12 * MIN, kind: "test" },
      ],
      edits: 1,
      commands: 1,
      costUsd: 0.5,
    },
  ]);
  const [lane] = lanes;
  expect(doingAt(lane, 5 * MIN)).toBe("resting");
  expect(doingAt(lane, 11.5 * MIN)).toBe("editing");
  expect(doingAt(lane, 19 * MIN)).toBe("at work");
  expect(doingAt(lane, 22 * MIN)).toBe("waiting for you");
  expect(doingAt(lane, 50 * MIN)).toBe("not watched");
});

test("a range cuts the spans at its ends and counts only what is inside", () => {
  const { log, at, clock } = setup();
  at(0, agent("a", { status: "running" }));
  clock(5);
  log.steps({ a: { kind: "command", key: "c1" } });
  at(30, agent("a"));
  clock(60);
  const [lane] = log.read(10 * MIN, 40 * MIN).lanes;
  expect(lane.spans).toEqual([
    { from: 10 * MIN, to: 30 * MIN, state: "work" },
    { from: 30 * MIN, to: 40 * MIN, state: "rest" },
  ]);
  expect(lane.commands).toBe(0);
  // Nobody was seen in a range before the office looked.
  expect(log.read(-60 * MIN, -10 * MIN).lanes).toEqual([]);
});

test("a closed office, a closed agent and one that left are gaps, not rests", () => {
  const { log, at, clock } = setup();
  at(0, agent("a", { status: "running" }), agent("b", { status: "running" }));
  at(10, agent("a", { status: "closed" }));
  clock(20);
  log.view(null);
  at(30, agent("a", { status: "running" }));
  clock(40);
  const lanes = log.read(0, 40 * MIN).lanes;
  expect(
    lanes.map((lane) => [lane.id, lane.spans.map((span) => [span.from / MIN, span.to / MIN])]),
  ).toEqual([
    [
      "a",
      [
        [0, 10],
        [30, 40],
      ],
    ],
    ["b", [[0, 10]]],
  ]);
});

test("the kept file is read back, its open spans end at its last mark, and old marks go", () => {
  const first = setup(null, 9 * DAY_MS);
  first.at(0, agent("a", { status: "running" }));
  first.at(10, agent("a", { status: "running" }), agent("b"));
  const kept = first.saved();
  expect(kept?.marks).toHaveLength(2);

  // The server stopped without a word and starts again an hour later.
  const second = setup(kept, 9 * DAY_MS);
  second.clock(70);
  expect(second.log.read(9 * DAY_MS, 10 * DAY_MS).lanes.map((lane) => lane.spans)).toEqual([
    [{ from: 9 * DAY_MS, to: 9 * DAY_MS + 10 * MIN, state: "work" }],
  ]);

  // Nine days on, nothing of it is left.
  const late = setup(kept, 18 * DAY_MS + 1);
  expect(late.log.read(0, 19 * DAY_MS).lanes).toEqual([]);
});

test("the week's recap adds up the lanes: time at work, turns, edits, commands, cost, the busiest team", () => {
  const span = (from: number, to: number, state: "work" | "wait" | "rest") => ({
    from: from * MIN,
    to: to * MIN,
    state,
  });
  const lane = { provider: "claude", steps: [] };
  const recap = weekRecap({
    from: 0,
    to: 2 * DAY_MS,
    lanes: [
      {
        ...lane,
        id: "a",
        name: "a",
        team: "shop-api",
        // One turn with an approval in it, then a second turn.
        spans: [
          span(0, 30, "work"),
          span(30, 40, "wait"),
          span(40, 60, "work"),
          span(60, 70, "rest"),
          span(70, 80, "work"),
        ],
        edits: 4,
        commands: 2,
        costUsd: 1.25,
      },
      {
        ...lane,
        id: "b",
        name: "b",
        team: "docs",
        // Across midnight: 30 minutes in each day.
        spans: [span(24 * 60 - 30, 24 * 60 + 30, "work")],
        edits: 1,
        commands: 0,
        costUsd: null,
      },
    ],
  });
  expect(recap).toEqual({
    workMs: 120 * MIN,
    prompts: 3,
    edits: 5,
    commands: 2,
    costUsd: 1.25,
    busiestTeam: "shop-api",
    days: [
      { from: 0, workMs: 90 * MIN },
      { from: DAY_MS, workMs: 30 * MIN },
    ],
  });
  expect(weekRecap({ from: 0, to: DAY_MS, lanes: [] })).toMatchObject({
    workMs: 0,
    costUsd: null,
    busiestTeam: null,
  });
});

test("a duration reads in hours and minutes", () => {
  expect([20_000, 45 * MIN, 120 * MIN, 200 * MIN].map(durationText)).toEqual([
    "under a minute",
    "45 min",
    "2 h",
    "3 h 20 min",
  ]);
});

test("a change adds its lines to the file, and the whole log is written only when it is cut", () => {
  const { log, at, clock, saved, writes } = setup();
  at(0, agent("a", { status: "running" }));
  // The agent's first mark and who it is.
  expect(writes).toEqual(["append 2"]);
  clock(1);
  log.steps({ a: { kind: "edit", key: "c0" } });
  expect(writes).toEqual(["append 2", "append 1"]);
  expect(saved()?.who).toEqual({ a: { name: "Agent a", team: "shop-api", provider: "claude" } });

  for (let call = 1; call <= TIMELINE_MARKS_MAX + TIMELINE_MARKS_SLACK; call += 1) {
    log.steps({ a: { kind: "edit", key: `c${call}` } });
  }
  expect(writes.filter((write) => write.startsWith("rewrite"))).toEqual([
    `rewrite ${TIMELINE_MARKS_MAX}`,
  ]);
  expect(saved()?.marks).toHaveLength(TIMELINE_MARKS_MAX + 1);
});

test("a kept file is written whole once at the start, without its old marks", () => {
  const first = setup(null, 0);
  first.at(0, agent("a", { status: "running" }));
  const second = setup(first.saved(), 9 * DAY_MS);
  expect(second.writes).toEqual(["rewrite 0"]);
  expect(second.saved()).toEqual({ version: 1, who: {}, marks: [] });
});
