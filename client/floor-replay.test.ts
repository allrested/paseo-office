import { expect, test } from "vitest";
import type { OfficeAgent, OfficeSnapshot } from "../shared/contracts.js";
import type { Timeline, TimelineLane } from "../shared/timeline.js";
import { replayedOffice, replaySignature } from "./floor-replay.js";
import { EMPTY_OFFICE } from "./office-state.js";
import { replayLine } from "./use-floor-replay.js";

const MIN = 60_000;

function agent(id: string, overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: id.toUpperCase(),
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: null,
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-17T08:00:00.000Z",
    ...overrides,
  };
}

function lane(id: string, patch: Partial<TimelineLane>): TimelineLane {
  const empty = { name: id, team: "Lobby", provider: "claude", spans: [], steps: [] };
  return { id, ...empty, edits: 0, commands: 0, costUsd: null, ...patch };
}

const TIMELINE: Timeline = {
  from: 0,
  to: 60 * MIN,
  lanes: [
    lane("a", {
      spans: [
        { from: 0, to: 10 * MIN, state: "rest" },
        { from: 10 * MIN, to: 30 * MIN, state: "work" },
        { from: 30 * MIN, to: 40 * MIN, state: "wait" },
        { from: 40 * MIN, to: 50 * MIN, state: "fail" },
      ],
      steps: [{ at: 12 * MIN, kind: "edit" }],
    }),
    lane("gone", { spans: [{ from: 0, to: 60 * MIN, state: "work" }] }),
  ],
};

// Today the agent is at work, with a request, a sub-agent and a checklist of its own.
const NOW: OfficeSnapshot = {
  ...EMPTY_OFFICE,
  agents: [
    agent("a", { status: "running", permissions: [{ id: "p", kind: "tool", title: "Run ls" }] }),
    agent("new"),
  ],
  activity: { a: "Running Bash" },
  doing: { a: { kind: "command", key: "c9" } },
  subagents: { a: [{ id: "s1", type: "Explore" }] },
  checklists: { a: [{ text: "Ship", status: "pending" }] },
};

function at(minutes: number) {
  const office = replayedOffice(NOW, TIMELINE, minutes * MIN);
  return office.agents.map((each) => [each.id, each.status, each.permissions.length]);
}

test("the floor shows each agent as the timeline saw it then, not as it is now", () => {
  expect(at(5)).toEqual([["a", "idle", 0]]);
  expect(at(20)).toEqual([["a", "running", 0]]);
  expect(at(35)).toEqual([["a", "running", 1]]);
  expect(at(45)).toEqual([["a", "error", 0]]);
  // Not watched then: not on the floor. Nor is an agent the timeline never saw, or one it saw
  // that the office no longer lists.
  expect(at(55)).toEqual([]);
});

test("a step shows for a minute after it was seen, and nothing of today's turn comes along", () => {
  const during = replayedOffice(NOW, TIMELINE, 12.5 * MIN);
  expect(during.doing).toEqual({ a: { kind: "edit", key: `replay:${12 * MIN}` } });
  expect(during.activity).toEqual({ a: "editing" });
  expect(during.subagents).toBeUndefined();
  expect(during.checklists).toEqual({});
  const later = replayedOffice(NOW, TIMELINE, 20 * MIN);
  expect(later.doing).toEqual({});
  expect(later.activity).toEqual({ a: "at work" });
});

test("two moments with the same people at the same things are one floor", () => {
  const sign = (minutes: number) => replaySignature(replayedOffice(NOW, TIMELINE, minutes * MIN));
  expect(sign(15)).toBe(sign(25));
  expect(sign(25)).not.toBe(sign(35));
});

test("the bar names the moment shown and the speed", () => {
  const head = new Date(2026, 10, 17, 14, 5, 40).getTime();
  expect(replayLine(head, 60)).toBe("Replay · 14:05 · 60×");
});
