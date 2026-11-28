import { describe, expect, test } from "vitest";
import type { PlanUsage } from "../shared/plan-usage.js";
import { createFakeClock, settle } from "./fake-clock.js";
import {
  PLAN_WATCH_MS,
  createPlanWatch,
  handOverWhenOut,
  type PlanCrossing,
} from "./plan-watch.js";
import type { HandOverAgent } from "./office.js";

function usage(provider: string, ...pcts: number[]): PlanUsage {
  return {
    provider,
    name: provider,
    plan: null,
    windows: pcts.map((usedPct, i) => ({ id: `w${i}`, label: `w${i}`, usedPct, resetsAt: null })),
  };
}

function setup(first: PlanUsage[] = []) {
  const clock = createFakeClock();
  const raised: { provider: string; level: number }[] = [];
  const logs: string[] = [];
  let reading: PlanUsage[] | Error = first;
  let reads = 0;
  let hidden = new Set<string>();
  const readings: ({ usage: PlanUsage[]; at: number } | null)[] = [];
  const watch = createPlanWatch({
    observed: (seen) => readings.push(seen),
    async read() {
      reads += 1;
      if (reading instanceof Error) throw reading;
      return reading;
    },
    counted: (provider) => !hidden.has(provider),
    raised: (crossing: PlanCrossing) =>
      raised.push({ provider: crossing.provider.provider, level: crossing.level }),
    timers: clock,
    log: (message) => logs.push(message),
  });
  async function next(to: PlanUsage[] | Error) {
    reading = to;
    clock.advance(PLAN_WATCH_MS);
    await settle();
  }
  return {
    clock,
    watch,
    raised,
    logs,
    readings,
    next,
    reads: () => reads,
    hide: (...ids: string[]) => void (hidden = new Set(ids)),
  };
}

test("reads at once when watching starts, then every interval, and nothing before", async () => {
  const { clock, watch, reads } = setup();
  watch.keep(true);
  await settle();
  expect(reads()).toBe(1);
  clock.advance(PLAN_WATCH_MS - 1);
  await settle();
  expect(reads()).toBe(1);
  clock.advance(1);
  await settle();
  expect(reads()).toBe(2);
});

test("with watching off nothing is read, and turning it off stops the timer", async () => {
  const { clock, watch, reads } = setup();
  await settle();
  clock.advance(PLAN_WATCH_MS * 3);
  await settle();
  expect(reads()).toBe(0);
  watch.keep(true);
  await settle();
  watch.keep(false);
  clock.advance(PLAN_WATCH_MS * 3);
  await settle();
  expect(reads()).toBe(1);
  expect(clock.pending()).toBe(0);
});

test("each of 80, 95 and 100 is told once as the limit climbs", async () => {
  const { watch, raised, next } = setup([usage("claude", 50)]);
  watch.keep(true);
  await settle();
  expect(raised).toEqual([]);
  await next([usage("claude", 81)]);
  await next([usage("claude", 82)]);
  expect(raised).toEqual([{ provider: "claude", level: 80 }]);
  await next([usage("claude", 96)]);
  await next([usage("claude", 99.7)]);
  await next([usage("claude", 100)]);
  expect(raised.map((r) => r.level)).toEqual([80, 95, 100]);
});

test("a jump past two levels is one message, for the highest", async () => {
  const { watch, raised, next } = setup([usage("claude", 10)]);
  watch.keep(true);
  await settle();
  await next([usage("claude", 97)]);
  expect(raised.map((r) => r.level)).toEqual([95]);
});

test("a reset re-arms the levels", async () => {
  const { watch, raised, next } = setup([usage("claude", 85)]);
  watch.keep(true);
  await settle();
  await next([usage("claude", 5)]);
  await next([usage("claude", 85)]);
  expect(raised.map((r) => r.level)).toEqual([80, 80]);
});

test("the closest limit of a provider counts, and a provider's other one resetting tells nothing", async () => {
  const { watch, raised, next } = setup([usage("claude", 85, 20)]);
  watch.keep(true);
  await settle();
  await next([usage("claude", 85, 96)]);
  await next([usage("claude", 5, 96)]);
  expect(raised.map((r) => r.level)).toEqual([80, 95]);
});

test("a provider left out by the plan switch is not told, and the others still are", async () => {
  const { watch, raised, hide, next } = setup([usage("codex", 100), usage("claude", 10)]);
  hide("codex");
  watch.keep(true);
  await settle();
  await next([usage("codex", 100), usage("claude", 90)]);
  expect(raised).toEqual([{ provider: "claude", level: 80 }]);
});

test("a failed read is no message, is logged, and the next read still comes", async () => {
  const { watch, raised, logs, next } = setup([usage("claude", 10)]);
  watch.keep(true);
  await settle();
  await next(new Error("no usage"));
  expect(raised).toEqual([]);
  expect(logs).toHaveLength(1);
  expect(logs[0]).toContain("no usage");
  await next(new Error("no usage"));
  expect(logs).toHaveLength(1);
  await next([usage("claude", 90)]);
  expect(raised.map((r) => r.level)).toEqual([80]);
});

test("a failed read does not re-arm a level that was told", async () => {
  const { watch, raised, next } = setup([usage("claude", 90)]);
  watch.keep(true);
  await settle();
  await next(new Error("down"));
  await next([usage("claude", 91)]);
  expect(raised.map((r) => r.level)).toEqual([80]);
});

test("a read under way when watching is turned off tells nothing", async () => {
  const { watch, raised, clock } = setup([usage("claude", 100)]);
  watch.keep(true);
  watch.keep(false);
  await settle();
  expect(raised).toEqual([]);
  expect(clock.pending()).toBe(0);
});

test("each reading is told with its instant, a failed one is not, and stopping forgets it", async () => {
  const { clock, watch, readings, next } = setup([usage("claude", 10)]);
  clock.advance(1000);
  watch.keep(true);
  await settle();
  expect(readings).toEqual([{ usage: [usage("claude", 10)], at: 1000 }]);
  await next(new Error("down"));
  expect(readings).toHaveLength(1);
  // A provider left out is still in the reading: the gate leaves it out as the pill does.
  await next([usage("claude", 20), usage("codex", 5)]);
  expect(readings.at(-1)).toEqual({
    usage: [usage("claude", 20), usage("codex", 5)],
    at: 1000 + 2 * PLAN_WATCH_MS,
  });
  watch.keep(false);
  expect(readings.at(-1)).toBeNull();
});

describe("handing over when a plan runs out", () => {
  const AGENTS: HandOverAgent[] = [
    { id: "a", provider: "claude", status: "idle" },
    { id: "c", provider: "codex", status: "idle" },
  ];

  function wired(options: { on?: boolean; agents?: HandOverAgent[] | null } = {}) {
    const clock = createFakeClock();
    const calls: { provider: string; name: string; agents: readonly HandOverAgent[] }[] = [];
    let on = options.on ?? true;
    let reading: PlanUsage[] = [];
    const out = handOverWhenOut({
      on: () => on,
      agents: () => (options.agents === undefined ? AGENTS : options.agents),
      handOver: async (provider, agents) => {
        calls.push({ provider: provider.id, name: provider.name, agents });
        return [];
      },
      log: () => undefined,
    });
    const watch = createPlanWatch({
      read: async () => reading,
      counted: () => true,
      raised: out,
      timers: clock,
      log: () => undefined,
    });
    watch.keep(true);
    return {
      calls,
      turn: (next: boolean) => void (on = next),
      async next(to: PlanUsage[]) {
        reading = to;
        clock.advance(PLAN_WATCH_MS);
        await settle();
      },
    };
  }

  test("at Out with the switch on, once per raise; it arms again after the limit falls", async () => {
    const { calls, next } = wired();
    await next([usage("claude", 96)]);
    expect(calls).toEqual([]);
    await next([usage("claude", 100)]);
    await next([usage("claude", 100)]);
    expect(calls).toEqual([{ provider: "claude", name: "claude", agents: AGENTS }]);
    await next([usage("claude", 10)]);
    await next([usage("claude", 100)]);
    expect(calls).toHaveLength(2);
  });

  test("nothing with the switch off, or with no directory open", async () => {
    const off = wired({ on: false });
    await off.next([usage("claude", 100)]);
    expect(off.calls).toEqual([]);
    const closed = wired({ agents: null });
    await closed.next([usage("claude", 100)]);
    expect(closed.calls).toEqual([]);
  });
});
