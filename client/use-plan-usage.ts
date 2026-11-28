import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { planUsageRpc } from "../shared/contracts.js";
import {
  nextPace,
  soonestPace,
  type PaceOut,
  type PaceTrack,
  type PlanUsage,
} from "../shared/plan-usage.js";
import { officeHostSettings } from "../shared/settings.js";

const NO_USAGE: readonly PlanUsage[] = [];
const NO_TRACK: PaceTrack = new Map();
/** The providers refresh their own readings about this often; asking sooner reads the same. */
const EVERY_MS = 120_000;

/** The plans' limits that count, for the floor, the toolbar and the Host card; empty where nothing provides them. */
export const PlanUsageContext = createContext<readonly PlanUsage[]>(NO_USAGE);

export function usePlanUsageValue(): readonly PlanUsage[] {
  return useContext(PlanUsageContext);
}

/** The soonest counted limit to run out at its pace, for the toolbar's note; null when none does. */
export const PlanPaceContext = createContext<PaceOut | null>(null);

/** Which providers' plans count: every provider the host reports, and the switch for each. */
export interface PlanPicker {
  all: readonly PlanUsage[];
  /** The ids of the providers left out. */
  hidden: ReadonlySet<string>;
  /** Null while the settings cannot be saved; else resolves once the host has answered. */
  setCounted: ((provider: string, counted: boolean) => Promise<void>) | null;
}

export const PlanPickerContext = createContext<PlanPicker | null>(null);

export interface PlanState {
  /** The plans that count: the ones the owner has not left out. */
  counted: readonly PlanUsage[];
  /** When the soonest of those limits reaches 100% at the pace of its last readings, if before its reset. */
  outAt: PaceOut | null;
  picker: PlanPicker;
}

/**
 * The plans of the providers the host can read, asked for while `live` and again every two
 * minutes. A host that cannot say leaves the last reading, and none before the first. The owner
 * leaves a provider out in the Host card: a plan nobody pays for reads as used up for good.
 */
export function usePlanUsage(live: boolean): PlanState {
  const ask = useRpc(planUsageRpc);
  // Kept in a ref: the poll restarts when the office goes live, not when the call's identity changes.
  const asking = useRef(ask);
  asking.current = ask;
  const [usage, setUsage] = useState<readonly PlanUsage[]>(NO_USAGE);
  // Each limit's earlier reading, to tell its pace from the next one.
  const [track, setTrack] = useState<PaceTrack>(NO_TRACK);
  useEffect(() => {
    if (!live) return undefined;
    let ended = false;
    const read = async () => {
      try {
        const answer = await asking.current({});
        if (!ended && answer.ok) {
          const readAt = Date.now();
          setUsage(answer.providers);
          setTrack((before) => nextPace(before, answer.providers, readAt));
        }
      } catch {
        // (the host went away: the next reading says)
      }
    };
    void read();
    const timer = setInterval(() => void read(), EVERY_MS);
    return () => {
      ended = true;
      clearInterval(timer);
      // Readings from before the office was closed say nothing of the pace after it: two fresh ones do.
      setTrack(NO_TRACK);
    };
  }, [live]);
  const settings = useSettings(officeHostSettings);
  const stored = settings.status === "ready" ? settings : null;
  const hiddenList = stored?.values.planHidden;
  const hidden = useMemo(() => new Set(hiddenList ?? []), [hiddenList]);
  const { save } = settings;
  const values = stored?.values;
  const revision = stored?.revision;
  const setCounted = useCallback(
    async (provider: string, counted: boolean) => {
      if (values === undefined || revision === undefined) return;
      const next = values.planHidden.filter((id) => id !== provider);
      if (!counted) next.push(provider);
      const ok = await save({ ...values, planHidden: next }, revision);
      if (!ok) throw new Error("The host refused the setting");
    },
    [save, values, revision],
  );
  return useMemo(() => {
    const counted = usage.filter((provider) => !hidden.has(provider.provider));
    return {
      counted,
      outAt: soonestPace(track, counted),
      picker: { all: usage, hidden, setCounted: values === undefined ? null : setCounted },
    };
  }, [usage, track, hidden, setCounted, values]);
}
