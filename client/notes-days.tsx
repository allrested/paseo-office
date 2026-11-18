import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { OfficeStyles } from "./styles.js";

/** The row's label, and the setting a refused save names. */
export const NOTES_DAYS_LABEL = "Stand-up days";
const HINT = "The days of the 8:00 run.";
const NO_DAY_HINT = "No day chosen: nothing runs at 8:00. The bell still starts the notes.";
/** By weekday number, 0 for Sunday: each button's name; its pill shows the first three letters. */
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

interface DayProps {
  day: number;
  name: string;
  on: boolean;
  disabled: boolean;
  onPress(day: number): void;
  styles: OfficeStyles;
}

function Day({ day, name, on, disabled, onPress, styles }: DayProps) {
  const press = useCallback(() => onPress(day), [onPress, day]);
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  let fill = null;
  if (on) fill = styles.segmentFill;
  else if (hovered || pressed) fill = styles.segmentHoverFill;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      aria-pressed={on}
      disabled={disabled}
      onPress={press}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={styles.segment}
    >
      {fill === null ? null : <View style={fill} />}
      <Text style={on ? styles.segmentTextSelected : styles.segmentText}>{name.slice(0, 3)}</Text>
    </Pressable>
  );
}

export interface NotesDaysProps {
  /** The stored days, 0 for Sunday; null while the settings are read or cannot be read. */
  value: readonly number[] | null;
  /** Resolves once the host has answered, and never rejects. */
  onSave(next: number[]): Promise<unknown>;
  problem: string | null;
  styles: OfficeStyles;
}

/**
 * The weekdays of the stand-up notes' 8:00 run, Sunday to Saturday, as the view switch's pills: a
 * press turns a day on or off. The press shows, and the row takes no other, until the host has
 * answered; a refused save goes back to the stored days.
 */
export function NotesDays({ value, onSave, problem, styles }: NotesDaysProps) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The days as pressed, until the host has answered; null shows the stored days.
  const [wanted, setWanted] = useState<readonly number[] | null>(null);
  const days = wanted ?? value;
  // A press saves against the stored revision: a second one before the host has answered would
  // go against a revision already gone, so the row takes none until then.
  const saving = useRef(false);
  const toggle = useCallback(
    (day: number) => {
      if (days === null || saving.current) return;
      saving.current = true;
      const next = days.includes(day)
        ? days.filter((other) => other !== day)
        : [...days, day].toSorted((a, b) => a - b);
      setWanted(next);
      void onSave(next).finally(() => {
        saving.current = false;
        if (mounted.current) setWanted(null);
      });
    },
    [days, onSave],
  );
  const disabled = days === null || wanted !== null;
  return (
    <View style={styles.headerField}>
      <Text style={styles.sheetLabel}>{NOTES_DAYS_LABEL}</Text>
      <View
        role="group"
        aria-label={NOTES_DAYS_LABEL}
        style={disabled ? styles.notesDaysDisabled : styles.notesDays}
      >
        {DAY_NAMES.map((name, day) => (
          <Day
            key={name}
            day={day}
            name={name}
            on={days?.includes(day) ?? false}
            disabled={disabled}
            onPress={toggle}
            styles={styles}
          />
        ))}
      </View>
      <Text style={styles.fieldHint}>{days?.length === 0 ? NO_DAY_HINT : HINT}</Text>
      {problem === null ? null : (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {problem}
        </Text>
      )}
    </View>
  );
}
