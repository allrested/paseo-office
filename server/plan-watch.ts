import type { PlanUsage, PlanWindow } from "../shared/plan-usage.js";
import {
  PLAN_DANGER_PCT,
  PLAN_OUT_PCT,
  PLAN_WARN_PCT,
  closestLimit,
} from "../shared/plan-usage.js";
import { errorMessage } from "./errors.js";
import type { HandOverAgent } from "./office.js";
import type { Clock } from "./timers.js";

/**
 * The providers re-read their own usage about every two minutes, and a limit is 5 hours or a
 * week: a few minutes late costs nothing, and the same pace stays cheap for the Paseo daemon.
 */
export const PLAN_WATCH_MS = 5 * 60_000;

export interface PlanCrossing {
  provider: PlanUsage;
  /** The provider's closest limit. */
  window: PlanWindow;
  /** The threshold it has reached: 80, 95 or 100 (used up). */
  level: 80 | 95 | 100;
}

export interface PlanWatchPorts {
  /** Rejects when the usage cannot be read. */
  read(): Promise<PlanUsage[]>;
  /** False for a provider the owner left out with its plan switch. */
  counted(provider: string): boolean;
  /** Told once for each threshold a provider's closest limit reaches. */
  raised(crossing: PlanCrossing): void;
  /**
   * Told each reading, every provider in it, with the instant it was read; null when watching
   * stops, so a reading is not taken for fresh after the last read.
   */
  observed?(reading: { usage: PlanUsage[]; at: number } | null): void;
  timers: Clock;
  log(message: string): void;
}

export interface PlanWatch {
  /** Reads now and then every interval while on; stops reading when off. */
  keep(on: boolean): void;
  /**
   * The counted providers whose closest limit was used up in the last reading, while it is no
   * older than `OUT_READING_MS`; none while watching is off.
   */
  outNow(): ReadonlySet<string>;
}

/** As the auto-start gate: a reading older than this says nothing of now. */
export const OUT_READING_MS = 15 * 60_000;

function levelOf(usedPct: number): 0 | 80 | 95 | 100 {
  if (usedPct >= PLAN_OUT_PCT) return 100;
  if (usedPct >= PLAN_DANGER_PCT) return 95;
  return usedPct >= PLAN_WARN_PCT ? 80 : 0;
}

/**
 * Reads the plan limits on a timer, with no office open, and says when a provider's closest limit
 * reaches a threshold. A level is told once; the limit falling (a reset) arms it again.
 */
export function createPlanWatch(ports: PlanWatchPorts): PlanWatch {
  const told = new Map<string, number>();
  // The last reading's providers at Out, and when it was read; null while there is none.
  let out: { providers: ReadonlySet<string>; at: number } | null = null;
  let on = false;
  let cancel: (() => void) | null = null;
  let failing = false;
  // Moves on whenever watching stops, so a read under way then is dropped.
  let generation = 0;

  function observe(usage: readonly PlanUsage[]): void {
    const crossings: PlanCrossing[] = [];
    const used = new Set<string>();
    for (const provider of usage) {
      if (!ports.counted(provider.provider)) continue;
      const closest = closestLimit([provider]);
      if (closest === null) continue;
      const level = levelOf(closest.window.usedPct);
      if (level === 100) used.add(provider.provider);
      const before = told.get(provider.provider) ?? 0;
      told.set(provider.provider, level);
      if (level !== 0 && level > before)
        crossings.push({ provider, window: closest.window, level });
    }
    // The whole reading is known before any crossing is told: two providers out at once see each other.
    out = { providers: used, at: ports.timers.now() };
    for (const crossing of crossings) ports.raised(crossing);
  }

  async function run(): Promise<void> {
    const mine = generation;
    cancel = null;
    try {
      const usage = await ports.read();
      if (mine !== generation) return;
      failing = false;
      observe(usage);
      ports.observed?.({ usage, at: ports.timers.now() });
    } catch (error) {
      if (mine !== generation) return;
      // A host whose Paseo has no provider usage fails every time: say it once.
      if (!failing) ports.log(`[office] plan limits not read: ${errorMessage(error)}`);
      failing = true;
    }
    cancel = ports.timers.setTimeout(start, PLAN_WATCH_MS);
  }

  function start(): void {
    run().catch((error: unknown) =>
      ports.log(`[office] plan watch failed: ${errorMessage(error)}`),
    );
  }

  return {
    keep(next) {
      if (on === next) return;
      on = next;
      if (next) {
        start();
        return;
      }
      generation += 1;
      cancel?.();
      cancel = null;
      out = null;
      ports.observed?.(null);
    },
    outNow() {
      if (out === null || ports.timers.now() - out.at > OUT_READING_MS) return new Set();
      return new Set([...out.providers].filter((provider) => ports.counted(provider)));
    },
  };
}

export interface OutHandOverPorts {
  /** The owner's switch: hand over the tasks of a provider whose plan ran out. */
  on(): boolean;
  /** The agents as the directory last had them; null while it is closed, and then nothing is done. */
  agents(): readonly HandOverAgent[] | null;
  handOver(
    provider: { id: string; name: string },
    agents: readonly HandOverAgent[],
  ): Promise<unknown>;
  log(message: string): void;
}

/**
 * Told each crossing: at Out, with the switch on, the provider's held tasks are handed over. The
 * watch tells a level once, so this runs once per raise and again only after a reset.
 */
export function handOverWhenOut(ports: OutHandOverPorts): (crossing: PlanCrossing) => void {
  return ({ provider, level }) => {
    if (level !== 100 || !ports.on()) return;
    const agents = ports.agents();
    if (agents === null) return;
    ports
      .handOver({ id: provider.provider, name: provider.name }, agents)
      .catch((error: unknown) =>
        ports.log(
          `[office] hand-over when ${provider.name} ran out failed: ${errorMessage(error)}`,
        ),
      );
  };
}
