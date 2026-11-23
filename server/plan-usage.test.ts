import { expect, test } from "vitest";
import { closestLimit, planNote, planTone, providersOut, resetText } from "../shared/plan-usage.js";
import { projectPlanUsage } from "./plan-usage.js";

const RESET = "2026-11-23T15:00:00.000Z";

test("a provider's limits are read as how much is used, from either figure it gives", () => {
  const usage = projectPlanUsage([
    {
      providerId: "claude",
      displayName: "Claude",
      status: "available",
      planLabel: "Max",
      windows: [
        { id: "5h", label: "5 hours", usedPct: 82.4, resetsAt: RESET },
        { id: "wk", label: "Week", remainingPct: 60 },
        // Neither figure: nothing to show.
        { id: "opus", label: "Opus" },
        { id: "over", label: "Over", usedPct: 140, resetsAt: "not a date" },
      ],
    },
  ]);
  expect(usage).toEqual([
    {
      provider: "claude",
      name: "Claude",
      plan: "Max",
      windows: [
        { id: "5h", label: "5 hours", usedPct: 82.4, resetsAt: Date.parse(RESET) },
        { id: "wk", label: "Week", usedPct: 40, resetsAt: null },
        { id: "over", label: "Over", usedPct: 100, resetsAt: null },
      ],
    },
  ]);
});

test("a provider that cannot be read, or reports no limit, is left out", () => {
  expect(
    projectPlanUsage([
      { providerId: "codex", displayName: "Codex", status: "unavailable" },
      { providerId: "pi", displayName: "Pi", status: "error", windows: [] },
      { providerId: "open", displayName: "OpenCode", status: "available", windows: [] },
    ]),
  ).toEqual([]);
});

test("the closest limit is the most used of every provider, warned at 80 and 95", () => {
  const usage = projectPlanUsage([
    {
      providerId: "claude",
      displayName: "Claude",
      status: "available",
      windows: [{ id: "5h", label: "5 hours", usedPct: 50 }],
    },
    {
      providerId: "codex",
      displayName: "Codex",
      status: "available",
      windows: [{ id: "wk", label: "Week", usedPct: 96 }],
    },
  ]);
  expect(closestLimit(usage)?.provider.name).toBe("Codex");
  expect(closestLimit([])).toBeNull();
  expect([79.9, 80, 94.9, 95].map(planTone)).toEqual(["ok", "warning", "warning", "danger"]);
});

test("the toolbar names the closest limit only from the warning on, and says when it is out", () => {
  const at = (usedPct: number) => [
    {
      provider: "claude",
      name: "Claude",
      plan: null,
      windows: [{ id: "5h", label: "5 hours", usedPct, resetsAt: null }],
    },
  ];
  expect(planNote(at(79))).toBeNull();
  expect(planNote(at(84.9))).toEqual({ text: "Claude 84%", tone: "warning" });
  expect(planNote(at(96))).toEqual({ text: "Claude 96%", tone: "danger" });
  expect(planNote(at(100))).toEqual({ text: "Out of Claude", tone: "danger" });
});

test("a provider is out while a full limit has not reset yet", () => {
  const now = Date.parse(RESET);
  const usage = [
    {
      provider: "claude",
      name: "Claude",
      plan: null,
      windows: [{ id: "5h", label: "5 hours", usedPct: 100, resetsAt: now + 60_000 }],
    },
    {
      provider: "codex",
      name: "Codex",
      plan: null,
      // Full, but the reset has passed: the reading is stale.
      windows: [{ id: "wk", label: "Week", usedPct: 100, resetsAt: now - 1 }],
    },
    {
      provider: "pi",
      name: "Pi",
      plan: null,
      windows: [{ id: "d", label: "Day", usedPct: 99.6, resetsAt: null }],
    },
  ];
  expect([...providersOut(usage, now)]).toEqual([
    ["claude", "Claude"],
    ["pi", "Pi"],
  ]);
});

test("a reset is told from now, in the largest two units", () => {
  const now = 1_000_000;
  const min = 60_000;
  expect(resetText(null, now)).toBe("");
  expect(resetText(now - 1, now)).toBe("resets now");
  expect(resetText(now + 5 * min, now)).toBe("resets in 5 min");
  expect(resetText(now + 130 * min, now)).toBe("resets in 2 h 10 min");
  expect(resetText(now + 50 * 60 * min, now)).toBe("resets in 2 d 2 h");
});
