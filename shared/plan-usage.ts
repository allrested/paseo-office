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

/** The closest limit in a few words, for the toolbar; null while every limit is under the warning. */
export function planNote(
  usage: readonly PlanUsage[],
): { text: string; tone: "warning" | "danger" } | null {
  const closest = closestLimit(usage);
  if (closest === null || closest.window.usedPct < PLAN_WARN_PCT) return null;
  const { provider, window } = closest;
  const text =
    window.usedPct >= PLAN_OUT_PCT
      ? `Out of ${provider.name}`
      : `${provider.name} ${Math.floor(window.usedPct)}%`;
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
