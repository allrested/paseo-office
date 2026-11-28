import { describe, expect, test } from "vitest";
import {
  nextPace,
  paceText,
  planNote,
  planPace,
  soonestPace,
  type PaceTrack,
  type PlanUsage,
} from "./plan-usage.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 10, 26, 9, 0);

describe("planPace", () => {
  const earlier = { usedPct: 20, readAt: T0 };
  const resetsAt = T0 + 5 * HOUR;

  test("is the instant the window reaches 100% at the rate between the readings", () => {
    // 10 points in 30 minutes: the 70 left take 3.5 hours more.
    const later = { usedPct: 30, readAt: T0 + 30 * MIN, resetsAt };
    expect(planPace(earlier, later)).toBe(T0 + 30 * MIN + 3.5 * HOUR);
  });

  test("needs the readings at least 5 minutes apart", () => {
    const at = (minutes: number) => ({ usedPct: 30, readAt: T0 + minutes * MIN, resetsAt });
    expect(planPace(earlier, at(4))).toBeNull();
    expect(planPace(earlier, at(5))).not.toBeNull();
  });

  test("is nothing while the usage does not rise", () => {
    expect(planPace(earlier, { usedPct: 20, readAt: T0 + HOUR, resetsAt })).toBeNull();
    expect(planPace(earlier, { usedPct: 10, readAt: T0 + HOUR, resetsAt })).toBeNull();
  });

  test("is nothing when the reset is not known", () => {
    expect(planPace(earlier, { usedPct: 30, readAt: T0 + HOUR, resetsAt: null })).toBeNull();
  });

  test("is nothing when the window resets first", () => {
    const soon = T0 + 2 * HOUR;
    // 10 points an hour: 100% is 7 hours after the later reading.
    expect(planPace(earlier, { usedPct: 30, readAt: T0 + HOUR, resetsAt: soon })).toBeNull();
    expect(planPace(earlier, { usedPct: 30, readAt: T0 + HOUR, resetsAt: T0 + 9 * HOUR })).toBe(
      T0 + 8 * HOUR,
    );
  });

  test("is nothing for a window already out, which the pill says in its own words", () => {
    const out = { usedPct: 100, readAt: T0 + HOUR, resetsAt };
    expect(planPace(earlier, out)).toBeNull();
    expect(planPace(earlier, { ...out, usedPct: 120 })).toBeNull();
  });
});

describe("the pace across readings", () => {
  const usage = (usedPct: number): PlanUsage[] => [
    {
      provider: "claude",
      name: "Claude",
      plan: null,
      windows: [{ id: "five", label: "5 hours", usedPct, resetsAt: T0 + 10 * HOUR }],
    },
  ];

  test("the first reading is kept as the earlier one and gives no pace", () => {
    const track = nextPace(new Map(), usage(20), T0);
    expect(soonestPace(track, usage(20))).toBeNull();
  });

  test("a reading under 5 minutes after the earlier one does not replace it", () => {
    let track: PaceTrack = nextPace(new Map(), usage(20), T0);
    track = nextPace(track, usage(22), T0 + 2 * MIN);
    track = nextPace(track, usage(30), T0 + 30 * MIN);
    // Against the reading at T0, not the one 2 minutes in: 10 points in 30 minutes.
    expect(soonestPace(track, usage(30))).toBe(T0 + 30 * MIN + 3.5 * HOUR);
  });

  test("the pace lasts until the next reading that is 5 minutes later", () => {
    let track: PaceTrack = nextPace(new Map(), usage(20), T0);
    track = nextPace(track, usage(30), T0 + 30 * MIN);
    track = nextPace(track, usage(31), T0 + 32 * MIN);
    expect(soonestPace(track, usage(31))).toBe(T0 + 30 * MIN + 3.5 * HOUR);
    track = nextPace(track, usage(31), T0 + 40 * MIN);
    expect(soonestPace(track, usage(31))).toBeNull();
  });

  test("the soonest across the providers that are given", () => {
    const two: PlanUsage[] = [
      ...usage(30),
      {
        provider: "codex",
        name: "Codex",
        plan: null,
        windows: [{ id: "week", label: "week", usedPct: 60, resetsAt: T0 + 10 * HOUR }],
      },
    ];
    const before = [
      usage(20)[0]!,
      { ...two[1]!, windows: [{ ...two[1]!.windows[0]!, usedPct: 40 }] },
    ];
    let track: PaceTrack = nextPace(new Map(), before, T0);
    track = nextPace(track, two, T0 + 30 * MIN);
    const both = soonestPace(track, two);
    expect(both).toBe(T0 + 30 * MIN + HOUR);
    expect(soonestPace(track, [two[0]!])).toBe(T0 + 30 * MIN + 3.5 * HOUR);
  });

  test("a window that left the readings is forgotten", () => {
    let track: PaceTrack = nextPace(new Map(), usage(20), T0);
    track = nextPace(track, [], T0 + HOUR);
    expect(track.size).toBe(0);
  });
});

describe("planNote with a pace", () => {
  const usage: PlanUsage[] = [
    {
      provider: "claude",
      name: "Claude",
      plan: null,
      windows: [{ id: "five", label: "5 hours", usedPct: 85, resetsAt: null }],
    },
  ];

  test("is as before without a pace", () => {
    expect(planNote(usage)).toEqual({ text: "Claude 85%", tone: "warning" });
    expect(planNote(usage, null)).toEqual({ text: "Claude 85%", tone: "warning" });
  });

  test("adds when the window runs out at this pace", () => {
    const out = Date.UTC(2026, 10, 26, 14, 0);
    const note = planNote(usage, out);
    expect(note).toEqual({
      text: `Claude 85% · at this pace out by ${paceText(out)}`,
      tone: "warning",
    });
  });

  test("a limit under the warning has no note, pace or not", () => {
    const calm = [{ ...usage[0]!, windows: [{ ...usage[0]!.windows[0]!, usedPct: 40 }] }];
    expect(planNote(calm, T0)).toBeNull();
  });

  test("a limit that is out says so, with no pace", () => {
    const out = [{ ...usage[0]!, windows: [{ ...usage[0]!.windows[0]!, usedPct: 100 }] }];
    expect(planNote(out, T0)).toEqual({ text: "Out of Claude", tone: "danger" });
  });
});

describe("paceText", () => {
  test("is the weekday and the 24-hour time in the device's zone", () => {
    const at = Date.UTC(2026, 10, 26, 14, 0);
    const text = paceText(at);
    const date = new Date(at);
    expect(text).toContain(date.toLocaleDateString(undefined, { weekday: "short" }));
    expect(text).toMatch(/\d{1,2}:\d{2}$/);
  });
});
