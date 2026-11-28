import { expect, test } from "vitest";
import { assignmentFooter, legacyFooters, readLobbyAssignment } from "./lobby-assignment.js";

const footer = assignmentFooter({ id: "p7", seq: 9 });

test("a lobby task's prompt reads as a lobby assignment", () => {
  const text = `The office assigned you lobby task p7 from the user.\n  Tidy the docs\n${footer}`;
  expect(readLobbyAssignment(text)).toEqual({ id: "p7", body: "Tidy the docs", kind: "lobby" });
});

test("a duty's prompt reads as a duty assignment, its blank line kept", () => {
  const text = `The office assigned you duty p7 from the duty board.\n  Build\n  \n  Run the build\n${footer}`;
  expect(readLobbyAssignment(text)).toEqual({
    id: "p7",
    body: "Build\n\nRun the build",
    kind: "duty",
  });
});

test("other text, or a changed footer, is not an assignment", () => {
  expect(
    readLobbyAssignment("The office assigned you duty p7 from the lobby.\n  x\n" + footer),
  ).toBe(null);
  expect(
    readLobbyAssignment("The office assigned you duty p7 from the duty board.\n  x\nother\nlines"),
  ).toBe(null);
});

test("a new assignment carries the v2 footer, which asks for a result in note", () => {
  expect(footer).toBe(
    [
      'Work on this task. When it is complete, use office_update with id "p7", action "done" and a short result in note. If you need input, leave it claimed and explain what you need.',
      "If the tool is unavailable and you have finished, put this exact line at the end of your reply: Completed office task p7 (assignment 9).",
    ].join("\n"),
  );
  expect(legacyFooters({ id: "p7", seq: 9 })).not.toContain(footer);
});

test("a prompt sent with the v1 footer still reads as an assignment", () => {
  const v1 = [
    'Work on this task. When it is complete, use office_update with id "p7" and action "done". If you need input, leave it claimed and explain what you need.',
    "If the tool is unavailable and you have finished, put this exact line at the end of your reply: Completed office task p7 (assignment 9).",
  ].join("\n");
  expect(legacyFooters({ id: "p7", seq: 9 })).toEqual([v1]);
  const text = `The office assigned you lobby task p7 from the user.\n  Tidy the docs\n${v1}`;
  expect(readLobbyAssignment(text)).toEqual({ id: "p7", body: "Tidy the docs", kind: "lobby" });
});
