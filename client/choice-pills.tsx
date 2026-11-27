import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { SegmentPill } from "./segment-pill.js";
import type { OfficeStyles } from "./styles.js";
import { useT } from "./ui-language.js";
interface Props<T extends string> {
  label: string;
  hint: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onSave(next: T): Promise<unknown>;
  problem: string | null;
  styles: OfficeStyles;
}
export function ChoicePills<T extends string>({
  label,
  hint,
  options,
  value,
  onSave,
  problem,
  styles,
}: Props<T>) {
  const t = useT();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The plan as pressed, until the host has answered; null shows the stored plan.
  const [wanted, setWanted] = useState<T | null>(null);
  const shown = wanted ?? value;
  const saving = useRef(false);
  const choose = useCallback(
    (next: T) => {
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
      <Text style={styles.sheetLabel}>{t(label)}</Text>
      <View
        role="group"
        aria-label={t(label)}
        style={disabled ? styles.notesDaysDisabled : styles.notesDays}
      >
        {options.map(({ value: plan, label: name }) => (
          <SegmentPill
            key={plan}
            value={plan}
            name={name}
            on={shown === plan}
            disabled={disabled}
            onPress={choose}
            styles={styles}
          />
        ))}
      </View>
      <Text style={styles.fieldHint}>{t(hint)}</Text>
      {problem === null ? null : (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {problem}
        </Text>
      )}
    </View>
  );
}
