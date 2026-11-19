import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { FLOOR_PLANS, type FloorPlanChoice } from "../shared/settings.js";
import { SegmentPill } from "./segment-pill.js";
import type { OfficeStyles } from "./styles.js";
import { PLAN_DESKS } from "./world/adapter.js";

/** The row's label, and the setting a refused save names. */
export const FLOOR_PLAN_LABEL = "Floor plan";
const HINT = `For the 3D view. Company floor has ${PLAN_DESKS.pro} desks, Cozy room ${PLAN_DESKS.cozy}, and Headquarters ${PLAN_DESKS.hq}. Headquarters may draw more slowly on a phone. Changing it starts the 3D view again.`;
const NAMES: Readonly<Record<FloorPlanChoice, string>> = {
  pro: "Company floor",
  cozy: "Cozy room",
  hq: "Headquarters",
};

export interface FloorPlanRowProps {
  /** The stored plan; null while the settings are read or cannot be read. */
  value: FloorPlanChoice | null;
  /** Resolves once the host has answered, and never rejects. */
  onSave(next: FloorPlanChoice): Promise<unknown>;
  problem: string | null;
  styles: OfficeStyles;
}

/**
 * The 3D floor's plan, as the view switch's pills. The press shows, and the row takes no other,
 * until the host has answered: a second one would go against a revision already gone. A refused
 * save goes back to the stored plan. The plan already stored is not saved again.
 */
export function FloorPlanRow({ value, onSave, problem, styles }: FloorPlanRowProps) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The plan as pressed, until the host has answered; null shows the stored plan.
  const [wanted, setWanted] = useState<FloorPlanChoice | null>(null);
  const shown = wanted ?? value;
  const saving = useRef(false);
  const choose = useCallback(
    (next: FloorPlanChoice) => {
      if (shown === null || saving.current || next === shown) return;
      saving.current = true;
      setWanted(next);
      void onSave(next).finally(() => {
        saving.current = false;
        if (mounted.current) setWanted(null);
      });
    },
    [shown, onSave],
  );
  const disabled = shown === null || wanted !== null;
  return (
    <View style={styles.headerField}>
      <Text style={styles.sheetLabel}>{FLOOR_PLAN_LABEL}</Text>
      <View
        role="group"
        aria-label={FLOOR_PLAN_LABEL}
        style={disabled ? styles.segmentsDisabled : styles.segments}
      >
        {FLOOR_PLANS.map((plan) => (
          <SegmentPill
            key={plan}
            value={plan}
            name={NAMES[plan]}
            on={shown === plan}
            disabled={disabled}
            onPress={choose}
            styles={styles}
          />
        ))}
      </View>
      <Text style={styles.fieldHint}>{HINT}</Text>
      {problem === null ? null : (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {problem}
        </Text>
      )}
    </View>
  );
}
