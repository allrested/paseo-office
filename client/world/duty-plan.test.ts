import { expect, test } from "vitest";
import {
  boardRows,
  dutyLine,
  tipRows,
  nextJob,
  // @ts-expect-error vendored JavaScript has no declarations
} from "../../vendor/my-office/src/office/paseo-duty-plan.js";
import type { WorldDuty } from "./world-api.js";

function duty(id: string, patch: Partial<WorldDuty> = {}): WorldDuty {
  return {
    id,
    name: `Duty ${id}`,
    chore: null,
    pretend: true,
    holder: null,
    state: "open",
    owed: false,
    ...patch,
  };
}

const HOLDER = { id: "a1", name: "Planner" };
const free = (...ids: string[]) => ids.map((id) => ({ id, ready: true }));

test("the board's rows: each duty's name, its chore, who has it, ticked when done, owed in red", () => {
  expect(
    boardRows(
      [
        duty("p1", { chore: "cups", name: "Wash the cups" }),
        duty("p2", { pretend: false, holder: HOLDER, state: "claimed" }),
        duty("p3", { state: "done", holder: HOLDER, owed: false }),
        duty("p4", { owed: true }),
      ],
      "p1",
    ),
  ).toEqual([
    { chore: "cups", label: "Wash the cups", name: "", at: "", busy: true, owed: false },
    { chore: null, label: "Duty p2", name: "Planner", at: "", busy: false, owed: false },
    { chore: null, label: "Duty p3", name: "Planner", at: "✓", busy: false, owed: false },
    { chore: null, label: "Duty p4", name: "", at: "", busy: false, owed: true },
  ]);
});

test("the tooltip says each duty and who has it: open, the name, or done", () => {
  expect(
    dutyLine(
      [
        duty("p1", { name: "Cups" }),
        duty("p2", { name: "Build", holder: HOLDER, state: "claimed", pretend: false }),
        duty("p3", { name: "Bin", state: "done" }),
      ],
      "open",
    ),
  ).toBe("Cups: open · Build: Planner · Bin: — ✓");
});

test("the tooltip's rows: one duty a row, who has it, done, and owed on its own row", () => {
  expect(
    tipRows([
      duty("p1", { name: "Cups" }),
      duty("p2", { name: "Build", holder: HOLDER, state: "claimed", pretend: false }),
      duty("p3", { name: "Bin", holder: HOLDER, state: "done" }),
      duty("p4", { name: "Plants", owed: true }),
    ]),
  ).toEqual([
    { name: "Cups", who: "", state: "open", owed: false },
    { name: "Build", who: "Planner", state: "held", owed: false },
    { name: "Bin", who: "Planner", state: "done", owed: false },
    { name: "Plants", who: "", state: "open", owed: true },
  ]);
});

test("an open pretend duty goes to the free figure that has done fewest today", () => {
  const job = nextJob({
    duties: [duty("p1", { chore: "cups" })],
    acted: new Set(),
    counts: new Map([["a", 1]]),
    figures: [{ id: "x", ready: false }, ...free("a", "b")],
    force: false,
    pile: 4,
  });
  expect(job).toEqual({ id: "p1", who: "b" });
});

test("a free figure takes an open duty at once, whatever the hour its chore used to wait for", () => {
  const base = {
    acted: new Set<string>(),
    counts: new Map(),
    figures: free("a"),
    force: false,
    pile: 4,
  };
  for (const chore of ["plants", "cups", "trash", "table", null] as const) {
    expect(nextJob({ ...base, duties: [duty("p1", { chore })] })).toEqual({ id: "p1", who: "a" });
  }
});

test("a duty waits while nobody is free", () => {
  const job = nextJob({
    duties: [duty("p1", { chore: "trash" })],
    acted: new Set(),
    counts: new Map(),
    figures: [{ id: "a", ready: false }],
    force: false,
    pile: 4,
  });
  expect(job).toBeNull();
});

test("nothing is acted out twice, once done elsewhere, or with an empty sink", () => {
  const base = {
    acted: new Set<string>(),
    counts: new Map(),
    figures: free("a"),
    force: false,
    pile: 4,
  };
  const plants = [duty("p1", { chore: "plants" })];
  expect(nextJob({ ...base, duties: plants, acted: new Set(["p1"]) })).toBeNull();
  expect(nextJob({ ...base, duties: [duty("p1", { state: "done" })] })).toBeNull();
  const cups = [duty("p1", { chore: "cups" })];
  expect(nextJob({ ...base, duties: cups, pile: 0 })).toBeNull();
  expect(nextJob({ ...base, duties: cups, pile: 0, force: true })).toEqual({ id: "p1", who: "a" });
  expect(
    nextJob({ ...base, duties: [duty("p1", { chore: "cups", owed: true })], pile: 0 }),
  ).toEqual({ id: "p1", who: "a" });
});

test("an owed duty comes first", () => {
  const job = nextJob({
    duties: [duty("p1", { chore: "plants" }), duty("p2", { chore: "trash", owed: true })],
    acted: new Set(),
    counts: new Map(),
    figures: free("a"),
    force: false,
    pile: 0,
  });
  expect(job).toEqual({ id: "p2", who: "a" });
});

test("an agent's duty is acted out once by its holder's figure, and by nobody else", () => {
  const held = duty("p1", { pretend: false, holder: HOLDER, state: "claimed" });
  const base = {
    acted: new Set<string>(),
    counts: new Map(),
    force: false,
    pile: 0,
  };
  expect(nextJob({ ...base, duties: [held], figures: free("b") })).toBeNull();
  expect(nextJob({ ...base, duties: [held], figures: free("b", "a1") })).toEqual({
    id: "p1",
    who: "a1",
  });
  expect(nextJob({ ...base, duties: [{ ...held, state: "done" }], figures: free("a1") })).toEqual({
    id: "p1",
    who: "a1",
  });
  expect(
    nextJob({ ...base, duties: [duty("p2", { pretend: false })], figures: free("a1") }),
  ).toBeNull();
});
