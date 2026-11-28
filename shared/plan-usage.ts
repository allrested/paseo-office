import { z } from "zod";

/** A limit of a provider's plan: the 5 hours, the week. `usedPct` is 0 to 100. */
export const PlanWindowSchema = z.object({
  id: z.string(),
  label: z.string(),
  usedPct: z.number(),
  /** Epoch ms of the reset; null when the provider does not say. */
  resetsAt: z.number().nullable(),
});
export type PlanWindow = z.output<typeof PlanWindowSchema>;

/** A provider whose plan Paseo can read, with the limits it reports. */
export const PlanUsageSchema = z.object({
  provider: z.string(),
  name: z.string(),
  plan: z.string().nullable(),
  windows: z.array(PlanWindowSchema),
});
export type PlanUsage = z.output<typeof PlanUsageSchema>;

/** From this much used, a limit is close; from this much, nearly gone. As upstream warns. */
export const PLAN_WARN_PCT = 80;
export const PLAN_DANGER_PCT = 95;
/** A limit counts as used up a hair under 100: the readings stop there. */
export const PLAN_OUT_PCT = 99.5;

export type PlanTone = "ok" | "warning" | "danger";

export function planTone(usedPct: number): PlanTone {
  if (usedPct >= PLAN_DANGER_PCT) return "danger";
  return usedPct >= PLAN_WARN_PCT ? "warning" : "ok";
}

/** The limit closest to used up, of every provider; null when none is read. */
export function closestLimit(
  usage: readonly PlanUsage[],
): { provider: PlanUsage; window: PlanWindow } | null {
  let closest: { provider: PlanUsage; window: PlanWindow } | null = null;
  for (const provider of usage) {
    for (const window of provider.windows) {
      if (closest === null || window.usedPct > closest.window.usedPct) {
        closest = { provider, window };
      }
    }
  }
  return closest;
}

/** When a limit resets, from now: "resets in 2 h 10 min"; empty when the provider does not say. */
export function resetText(resetsAt: number | null, now: number): string {
  if (resetsAt === null) return "";
  const minutes = Math.ceil((resetsAt - now) / 60_000);
  if (minutes <= 0) return "resets now";
  if (minutes < 60) return `resets in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `resets in ${hours} h ${minutes % 60} min`;
  return `resets in ${Math.floor(hours / 24)} d ${hours % 24} h`;
}

/** A window's use as read, and when. */
export interface PlanReading {
  usedPct: number;
  /** Epoch ms of the reading. */
  readAt: number;
}

/** Two readings of one window must be this far apart to say a rate. */
export const PACE_MIN_MS = 5 * 60_000;

/**
 * When a window reaches 100% at the rate between two readings of it, as epoch ms; null when that
 * is not before its reset (`later.resetsAt`, which must be known), when the readings are under 5
 * minutes apart or the use did not rise, and when the window is already out: the pill says that.
 */
export function planPace(
  earlier: PlanReading,
  later: PlanReading & { resetsAt: number | null },
): number | null {
  const span = later.readAt - earlier.readAt;
  const rose = later.usedPct - earlier.usedPct;
  if (span < PACE_MIN_MS || rose <= 0 || later.resetsAt === null) return null;
  if (later.usedPct >= PLAN_OUT_PCT) return null;
  const outAt = later.readAt + ((100 - later.usedPct) / rose) * span;
  return outAt < later.resetsAt ? outAt : null;
}

/** A window's earlier reading, and the pace the last two that were far enough apart gave. */
export type PaceTrack = ReadonlyMap<string, { earlier: PlanReading; pace: number | null }>;

const paceKey = (provider: PlanUsage, window: PlanWindow) =>
  `${provider.provider}\u0000${window.id}`;

/**
 * The track after a reading of every window. A window's earlier reading is replaced only by a
 * reading at least 5 minutes after it, which is when its pace is worked out again: the polls come
 * every two minutes, and a rate over so short a span would jump about. Windows no longer read are dropped.
 */
export function nextPace(track: PaceTrack, usage: readonly PlanUsage[], now: number): PaceTrack {
  const next = new Map<string, { earlier: PlanReading; pace: number | null }>();
  for (const provider of usage) {
    for (const window of provider.windows) {
      const key = paceKey(provider, window);
      const reading = { usedPct: window.usedPct, readAt: now };
      const before = track.get(key);
      if (before === undefined) {
        next.set(key, { earlier: reading, pace: null });
      } else if (now - before.earlier.readAt >= PACE_MIN_MS) {
        next.set(key, {
          earlier: reading,
          pace: planPace(before.earlier, { ...reading, resetsAt: window.resetsAt }),
        });
      } else {
        next.set(key, before);
      }
    }
  }
  return next;
}

/** A window running out at its pace: when, and whose it is. */
export interface PaceOut {
  at: number;
  /** The provider's display name and the window's label, as the pill writes them. */
  provider: string;
  window: string;
}

/** The soonest window of these providers to run out at its pace; null when none does. */
export function soonestPace(track: PaceTrack, usage: readonly PlanUsage[]): PaceOut | null {
  let soonest: PaceOut | null = null;
  for (const provider of usage) {
    for (const window of provider.windows) {
      const at = track.get(paceKey(provider, window))?.pace ?? null;
      if (at !== null && (soonest === null || at < soonest.at)) {
        soonest = { at, provider: provider.name, window: window.label };
      }
    }
  }
  return soonest;
}

/** An instant as "Thu 14:00": the weekday and the 24-hour time in the device's locale and zone. */
export function paceText(at: number): string {
  const when = new Date(at);
  const day = when.toLocaleDateString(undefined, { weekday: "short" });
  const time = when.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return `${day} ${time}`;
}

/** "Claude 5 hours: at this pace out by Thu 14:00": it names its own window, whoever the closest limit is. */
const paceNote = (out: PaceOut) =>
  `${out.provider} ${out.window}: at this pace out by ${paceText(out.at)}`;

/**
 * The closest limit in a few words, for the toolbar; null while every limit is under the warning.
 * `pace` is the soonest window that runs out at its pace, when there is one: it follows the note
 * after " · ", or is the note alone, in the warning tone, when no limit is near yet.
 */
export function planNote(
  usage: readonly PlanUsage[],
  pace: PaceOut | null = null,
): { text: string; tone: "warning" | "danger" } | null {
  const closest = closestLimit(usage);
  if (closest === null || closest.window.usedPct < PLAN_WARN_PCT) {
    return pace === null ? null : { text: paceNote(pace), tone: "warning" };
  }
  const { provider, window } = closest;
  const used =
    window.usedPct >= PLAN_OUT_PCT
      ? `Out of ${provider.name}`
      : `${provider.name} ${Math.floor(window.usedPct)}%`;
  const text = pace === null ? used : `${used} · ${paceNote(pace)}`;
  return { text, tone: window.usedPct >= PLAN_DANGER_PCT ? "danger" : "warning" };
}

/** The providers with a limit used up, by id, with the name the floor shows for each. */
export function providersOut(usage: readonly PlanUsage[], now: number): Map<string, string> {
  const out = new Map<string, string>();
  for (const provider of usage) {
    const full = provider.windows.some(
      (window) =>
        window.usedPct >= PLAN_OUT_PCT && (window.resetsAt === null || window.resetsAt > now),
    );
    if (full) out.set(provider.provider, provider.name);
  }
  return out;
}
