import { useEffect, useState } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import { officeHostSettings } from "../../shared/settings.js";
import type { WorldPlan } from "./adapter.js";

/** What the plan needs of a settings read. */
export type PlanSource =
  | { status: "loading" | "error" | "invalid" }
  | { status: "ready"; values: { floorPlan: WorldPlan } };

/**
 * The plan to draw. A stored plan is the plan. While the settings are read there is none, or the
 * last one known: a new read must not restart a scene that is up. Settings that cannot be read, or
 * are not valid, keep the last plan and else draw the company floor, as the office did before there
 * was a choice.
 */
export function floorPlanOf(settings: PlanSource, last: WorldPlan | null): WorldPlan | null {
  if (settings.status === "ready") return settings.values.floorPlan;
  if (settings.status === "loading") return last;
  return last ?? "pro";
}

/**
 * The plan the 3D view draws, from the host's "Floor plan" setting; null until the host has said.
 */
export function useFloorPlan(): WorldPlan | null {
  const settings = useSettings(officeHostSettings);
  const [last, setLast] = useState<WorldPlan | null>(null);
  const plan = floorPlanOf(settings, last);
  useEffect(() => {
    setLast(plan);
  }, [plan]);
  return plan;
}
