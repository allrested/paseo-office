import type { PlanUsage, PlanWindow } from "../shared/plan-usage.js";
import {
  PLAN_DANGER_PCT,
  PLAN_OUT_PCT,
  PLAN_WARN_PCT,
  closestLimit,
} from "../shared/plan-usage.js";
import { errorMessage } from "./errors.js";
import type { Timers } from "./timers.js";

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
  timers: Timers;
  log(message: string): void;
}

export interface PlanWatch {
  /** Reads now and then every interval while on; stops reading when off. */
  keep(on: boolean): void;
}

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
  let on = false;
  let cancel: (() => void) | null = null;
  let failing = false;
  // Moves on whenever watching stops, so a read under way then is dropped.
  let generation = 0;

  function observe(usage: readonly PlanUsage[]): void {
    for (const provider of usage) {
      if (!ports.counted(provider.provider)) continue;
      const closest = closestLimit([provider]);
      if (closest === null) continue;
      const level = levelOf(closest.window.usedPct);
      const before = told.get(provider.provider) ?? 0;
      told.set(provider.provider, level);
      if (level !== 0 && level > before) ports.raised({ provider, window: closest.window, level });
    }
  }

  async function run(): Promise<void> {
    const mine = generation;
    cancel = null;
    try {
      const usage = await ports.read();
      if (mine !== generation) return;
      failing = false;
      observe(usage);
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
    },
  };
}
