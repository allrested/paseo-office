import { expect, test } from "vitest";
import { DutySchema, OfficeSnapshotSchema, PostSchema, type Post } from "./contracts.js";
import {
  DUTY_HOLDER_CHARS,
  STARTING_DUTIES,
  dutyListProblem,
  dutyPostText,
  dutyRows,
  shortHolder,
} from "./duties.js";
import { DUTY } from "./names.js";

function post(id: string, patch: Partial<Post>): Post {
  return {
    id,
    seq: Number(id.slice(1)),
    board: DUTY,
    kind: "task",
    text: "Duty",
    author: "user",
    state: "open",
    createdAt: "2026-11-18T05:00:00.000Z",
    updatedAt: "2026-11-18T05:00:00.000Z",
    ...patch,
  };
}

test("the duty board is a reserved board id beside the lobby", () => {
  expect(DUTY).toBe("duty");
});

test("the starting list is the four pantry chores, Monday to Friday, with no instructions", () => {
  expect(STARTING_DUTIES.map((duty) => duty.chore)).toEqual(["cups", "trash", "plants", "table"]);
  for (const duty of STARTING_DUTIES) {
    expect(DutySchema.parse(duty)).toEqual(duty);
    expect(duty.instructions).toBe("");
    expect(duty.days).toEqual([1, 2, 3, 4, 5]);
  }
  expect(new Set(STARTING_DUTIES.map((duty) => duty.id)).size).toBe(4);
});

test("a post keeps which duty and day it is, and a snapshot carries the duty list", () => {
  const parsed = PostSchema.parse(post("p1", { duty: { id: "cups", day: "2026-11-18" } }));
  expect(parsed.duty).toEqual({ id: "cups", day: "2026-11-18" });
  const snapshot = OfficeSnapshotSchema.parse({
    agents: [],
    workspaces: [],
    activity: {},
    boards: {},
    wake: { paused: false, queued: {} },
    duties: { duties: STARTING_DUTIES, day: "2026-11-18" },
  });
  expect(snapshot.duties?.day).toBe("2026-11-18");
});

test("a list is refused with a clear message: count, name, instructions, days", () => {
  const ok = { name: "Water the plants", instructions: "", days: [1] };
  expect(dutyListProblem([ok])).toBeNull();
  expect(dutyListProblem([])).toBeNull();
  expect(dutyListProblem(Array.from({ length: 13 }, () => ok))).toBe(
    "Unable to save: the duty board holds at most 12 duties",
  );
  expect(dutyListProblem([ok, { ...ok, name: "  " }])).toBe("Unable to save: duty 2 has no name");
  expect(dutyListProblem([{ ...ok, name: "x".repeat(41) }])).toBe(
    `Unable to save: "${"x".repeat(41)}" is longer than 40 characters`,
  );
  expect(dutyListProblem([{ ...ok, instructions: "y".repeat(2001) }])).toBe(
    'Unable to save: the instructions of "Water the plants" are longer than 2,000 characters',
  );
  expect(dutyListProblem([{ ...ok, days: [7] }])).toBe(
    'Unable to save: "Water the plants" has a day that is not 0 (Sunday) to 6 (Saturday)',
  );
  expect(dutyListProblem([{ ...ok, days: [2, 2] }])).toBe(
    'Unable to save: "Water the plants" has a day twice',
  );
  for (const name of ["Water\nthe plants", "Water the\r\nplants", "Water\u2028plants"]) {
    expect(dutyListProblem([ok, { ...ok, name }])).toBe(
      "Unable to save: the name of duty 2 has a line break",
    );
  }
});

test("a duty's post is its name, then its instructions after a blank line", () => {
  expect(dutyPostText({ name: " Bin ", instructions: "" })).toBe("Bin");
  expect(dutyPostText({ name: "Tidy", instructions: " Prune old branches. \n" })).toBe(
    "Tidy\n\nPrune old branches.",
  );
});

test("the day's rows: one per duty post, in the list's order, owed when open from an earlier day", () => {
  const board = {
    duties: [
      { id: "a", name: "A", instructions: "", days: [1] },
      { id: "b", name: "B", instructions: "Do B", days: [1] },
    ],
    day: "2026-11-18",
  };
  const posts = [
    post("p4", { duty: { id: "b", day: "2026-11-18" }, state: "claimed", claimedBy: "agent-1" }),
    post("p3", { duty: { id: "a", day: "2026-11-17" } }),
    post("p5", { duty: { id: "gone", day: "2026-11-18" }, state: "claimed", claimedBy: "x" }),
    post("p6", { board: DUTY, kind: "note" }),
  ];
  const rows = dutyRows(board, posts);
  expect(rows.map((row) => [row.post.id, row.duty?.id ?? null, row.owed])).toEqual([
    ["p3", "a", true],
    ["p4", "b", false],
    ["p5", null, false],
  ]);
  expect(dutyRows(undefined, posts)).toEqual([]);
});

test("a holder's name is cut to 24 characters with an ellipsis", () => {
  expect(DUTY_HOLDER_CHARS).toBe(24);
  expect(shortHolder("Short name")).toBe("Short name");
  const long = "Refactor the payment reconciliation service end to end";
  const cut = shortHolder(long);
  expect(cut).toHaveLength(24);
  expect(cut.endsWith("…")).toBe(true);
  expect(cut.startsWith("Refactor the payment")).toBe(true);
  expect(shortHolder("  spaced   name  ")).toBe("spaced name");
});
