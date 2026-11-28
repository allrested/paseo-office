import { expect, test } from "vitest";
import type { Post } from "../shared/contracts.js";
import type { DutyRow } from "../shared/duties.js";
import { dutyRowTitle, dutyStateText, dutyTimeOf, dutyTimeText } from "./duty-text.js";

const PRETEND = { id: "cups", name: "Wash the cups", instructions: "", days: [1] };
const REAL = { id: "build", name: "Build", instructions: "Run the build", days: [1] };

function row(patch: Partial<Post>, duty: DutyRow["duty"] = PRETEND, owed = false): DutyRow {
  return {
    post: {
      id: "p1",
      seq: 1,
      board: "duty",
      kind: "task",
      text: "Old name\n\nOld instructions",
      author: "user",
      state: "open",
      duty: { id: duty?.id ?? "gone", day: "2026-11-18" },
      createdAt: "2026-11-18T05:00:00.000Z",
      updatedAt: "2026-11-18T05:00:00.000Z",
      ...patch,
    },
    duty,
    owed,
    replies: [],
  };
}
const name = (id: string) => (id === "a1" ? "Release notes writer" : id);

test("a duty's state says who has it, or who will", () => {
  expect(dutyStateText(row({}), name)).toBe("Open: the 3D office acts it out");
  expect(dutyStateText(row({}, REAL), name)).toBe("Open: the next idle agent gets it");
  expect(dutyStateText(row({ state: "claimed", claimedBy: "a1" }, REAL), name)).toBe(
    "Release notes writer has it",
  );
  expect(dutyStateText(row({ state: "done", claimedBy: "a1" }), name)).toBe(
    "Done by Release notes writer",
  );
  expect(dutyStateText(row({ state: "done" }), name)).toBe("Done");
  expect(dutyStateText(row({}, PRETEND, true), name)).toBe(
    "Owed from 2026-11-18. Open: the 3D office acts it out",
  );
});

test("a row is named by its duty, or by its post's first line once the duty is gone", () => {
  expect(dutyRowTitle(row({}))).toBe("Wash the cups");
  expect(dutyRowTitle(row({}, null))).toBe("Old name");
});

test("a typed time is H:MM or HH:MM from 08:00 to 23:59, kept as HH:MM; empty is none", () => {
  expect(dutyTimeOf("")).toBe("");
  expect(dutyTimeOf("  ")).toBe("");
  expect(dutyTimeOf("9:05")).toBe("09:05");
  expect(dutyTimeOf(" 14:30 ")).toBe("14:30");
  expect(dutyTimeOf("08:00")).toBe("08:00");
  expect(dutyTimeOf("23:59")).toBe("23:59");
  for (const typed of ["7:59", "07:00", "24:00", "14:60", "1430", "2pm", "123:00", "9:5"]) {
    expect(dutyTimeOf(typed), typed).toBeNull();
  }
});

test("a duty's time shows beside its name when it is not 08:00", () => {
  expect(dutyTimeText({ time: "14:30" })).toBe("14:30");
  expect(dutyTimeText({ time: "08:00" })).toBeNull();
  expect(dutyTimeText({})).toBeNull();
});
