import type { PlanUsage, PlanWindow } from "../shared/plan-usage.js";

/** The fields the office reads from a provider's usage, as Paseo lists it. */
export interface ProviderUsageInput {
  providerId: string;
  displayName: string;
  status: string;
  planLabel?: string | null;
  windows?: readonly {
    id: string;
    label: string;
    usedPct?: number | null;
    remainingPct?: number | null;
    resetsAt?: string | null;
  }[];
}

function windowOf(input: NonNullable<ProviderUsageInput["windows"]>[number]): PlanWindow | null {
  const { usedPct, remainingPct } = input;
  let used: number | null = null;
  if (typeof usedPct === "number") used = usedPct;
  else if (typeof remainingPct === "number") used = 100 - remainingPct;
  if (used === null || !Number.isFinite(used)) return null;
  const reset = input.resetsAt ? Date.parse(input.resetsAt) : Number.NaN;
  return {
    id: input.id,
    label: input.label,
    usedPct: Math.min(100, Math.max(0, used)),
    resetsAt: Number.isFinite(reset) ? reset : null,
  };
}

/**
 * The providers whose plan can be read now, each with the limits that say how much is used. One
 * that is unavailable, in error, or reports no percentage is left out.
 */
export function projectPlanUsage(providers: readonly ProviderUsageInput[]): PlanUsage[] {
  const usage: PlanUsage[] = [];
  for (const provider of providers) {
    if (provider.status !== "available") continue;
    const windows = (provider.windows ?? []).flatMap((window) => windowOf(window) ?? []);
    if (windows.length === 0) continue;
    usage.push({
      provider: provider.providerId,
      name: provider.displayName,
      plan: provider.planLabel ?? null,
      windows,
    });
  }
  return usage;
}
