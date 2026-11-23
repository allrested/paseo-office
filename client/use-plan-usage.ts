import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { planUsageRpc } from "../shared/contracts.js";
import type { PlanUsage } from "../shared/plan-usage.js";

const NO_USAGE: readonly PlanUsage[] = [];
/** The providers refresh their own readings about this often; asking sooner reads the same. */
const EVERY_MS = 120_000;

/** The plans' limits, for the floor and the Host card; empty where nothing provides them. */
export const PlanUsageContext = createContext<readonly PlanUsage[]>(NO_USAGE);

export function usePlanUsageValue(): readonly PlanUsage[] {
  return useContext(PlanUsageContext);
}

/**
 * The plans of the providers the host can read, asked for while `live` and again every two
 * minutes. A host that cannot say leaves the last reading, and none before the first.
 */
export function usePlanUsage(live: boolean): readonly PlanUsage[] {
  const ask = useRpc(planUsageRpc);
  // Kept in a ref: the poll restarts when the office goes live, not when the call's identity changes.
  const asking = useRef(ask);
  asking.current = ask;
  const [usage, setUsage] = useState<readonly PlanUsage[]>(NO_USAGE);
  useEffect(() => {
    if (!live) return undefined;
    let ended = false;
    const read = async () => {
      try {
        const answer = await asking.current({});
        if (!ended && answer.ok) setUsage(answer.providers);
      } catch {
        // (the host went away: the next reading says)
      }
    };
    void read();
    const timer = setInterval(() => void read(), EVERY_MS);
    return () => {
      ended = true;
      clearInterval(timer);
    };
  }, [live]);
  return usage;
}
