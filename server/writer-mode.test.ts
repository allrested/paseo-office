import { expect, test } from "vitest";
import { writerMode, writerModeChoices } from "./writer-mode.js";

const CLAUDE = {
  defaultModeId: "auto",
  modes: [
    { id: "plan", label: "Plan Mode" },
    { id: "default", label: "Always Ask" },
    { id: "acceptEdits", label: "Accept File Edits" },
    { id: "auto", label: "Auto mode" },
    { id: "bypassPermissions", label: "Bypass" },
  ],
};
const CODEX = {
  defaultModeId: "auto-review",
  modes: [
    { id: "auto", label: "Default Permissions" },
    { id: "auto-review", label: "Auto-review" },
    { id: "full-access", label: "Full Access" },
  ],
};

test("the choices are the provider's modes by its own names, less the one that only plans", () => {
  expect(writerModeChoices(CLAUDE).map((mode) => mode.label)).toEqual([
    "Always Ask",
    "Accept File Edits",
    "Auto mode",
    "Bypass",
  ]);
  expect(writerModeChoices(CODEX).map((mode) => mode.id)).toEqual([
    "auto",
    "auto-review",
    "full-access",
  ]);
  // A mode with no label shows its id; a provider with no modes offers none.
  expect(writerModeChoices({ modes: [{ id: "build" }] })).toEqual([
    { id: "build", label: "build" },
  ]);
  expect(writerModeChoices({})).toEqual([]);
});

test("with no mode set the writer accepts edits where it can, else takes the provider's default", () => {
  expect(writerMode(CLAUDE, "")).toEqual({ modeId: "acceptEdits", fellBack: false });
  expect(writerMode(CODEX, " ")).toEqual({ modeId: "auto-review", fellBack: false });
  expect(writerMode({}, "")).toEqual({ fellBack: false });
});

test("a mode the provider offers is the writer's", () => {
  expect(writerMode(CLAUDE, "bypassPermissions")).toEqual({
    modeId: "bypassPermissions",
    fellBack: false,
  });
  expect(writerMode(CODEX, "full-access")).toEqual({ modeId: "full-access", fellBack: false });
});

test("a mode the provider does not offer, or the one that only plans, falls back and says so", () => {
  expect(writerMode(CODEX, "bypassPermissions")).toEqual({ modeId: "auto-review", fellBack: true });
  expect(writerMode(CLAUDE, "plan")).toEqual({ modeId: "acceptEdits", fellBack: true });
});
