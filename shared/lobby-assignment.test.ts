import { expect, test } from "vitest";
import { assignmentFooter, readLobbyAssignment } from "./lobby-assignment.js";

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
