import { expect, test } from "vitest";
import { notesDay, notesFileName, notesPrompt } from "./notes-prompt.js";

test("the day is the notes time zone's", () => {
  // 2026-11-15T22:30:00Z is 16 November in Riyadh and 15 November in UTC
  expect(notesDay(Date.parse("2026-11-15T22:30:00Z"), "Asia/Riyadh")).toEqual({
    month: "202611",
    header: "16 November 2026",
  });
  expect(notesDay(Date.parse("2026-11-15T22:30:00Z"), "UTC").header).toBe("15 November 2026");
});

test("a single-digit day has two digits", () => {
  expect(notesDay(Date.parse("2026-12-01T09:00:00Z"), "UTC")).toEqual({
    month: "202612",
    header: "01 December 2026",
  });
});

test("the month's file is named after it", () => {
  expect(notesFileName("202611")).toBe("daily-standup-202611.md");
});

test("the prompt names the day, the file and carries the report", () => {
  const text = notesPrompt({
    header: "16 November 2026",
    fileName: "daily-standup-202611.md",
    report: "REPORT",
  });
  expect(text).toContain("note for 16 November 2026 in daily-standup-202611.md");
  expect(text).toContain("Edit only daily-standup-202611.md. Do not commit.");
  expect(text.endsWith("REPORT")).toBe(true);
});

test("the prompt stands alone: the instructions given for the folder if any, else the office's shape", () => {
  const text = notesPrompt({
    header: "16 November 2026",
    fileName: "daily-standup-202611.md",
    report: "REPORT",
  });
  expect(text).not.toContain("Standup Notes");
  expect(text).toContain("AGENTS.md or CLAUDE.md");
  // A notes folder inside a project gets the project's instructions from a folder above it.
  expect(text).toContain("this folder's or a parent folder's AGENTS.md or CLAUDE.md");
  // what entryWritten (notes-files.ts) looks for: the header starting a line of the month's file
  expect(text).toContain(`the entry's header line is "## 16 November 2026"`);
  expect(text).toContain("daily-standup-202611.md, directly in this folder");
});

test("the prompt is the writer's instructions, a blank line, then the report", () => {
  const text = notesPrompt({
    header: "16 November 2026",
    fileName: "daily-standup-202611.md",
    report: "REPORT",
  });
  expect(text).toBe(
    [
      "Write today's stand-up note for 16 November 2026 in daily-standup-202611.md, directly in this folder; create the file if it is not there.",
      "Follow the stand-up notes instructions you have been given for this folder, whether they come from this folder's or a parent folder's AGENTS.md or CLAUDE.md. Only when there are none, write the entry as a line \"## 16 November 2026\" followed by a short note, from the report below, of what was done, what blocks it, and what comes next.",
      "Either way the entry's header line is \"## 16 November 2026\", in daily-standup-202611.md: the office finds the day's entry by that line.",
      "If the entry for 16 November 2026 is already in daily-standup-202611.md, bring it up to date in place: keep what is still true and keep the file's Contents list right, if it has one.",
      "Edit only daily-standup-202611.md. Do not commit.",
      "",
      "The office's stand-up report, for what the agents did and what blocks them:",
      "",
      "REPORT",
    ].join("\n"),
  );
});
