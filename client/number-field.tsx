import { useState, useRef, useEffect, useCallback } from "react";
import { View } from "react-native";
import { Text, TextInput } from "./text.js";
import type { OfficeStyles } from "./styles.js";
import { useT } from "./ui-language.js";

interface NumberFieldProps {
  label: string;
  /** Null while the settings are read or cannot be read: the field is then not usable. */
  value: number | null;
  min: number;
  max: number;
  /** Resolves once the host has answered, and never rejects. */
  onSave(next: number): Promise<unknown>;
  problem: string | null;
  styles: OfficeStyles;
}

/** A whole number from what was typed, held to the range; null when no digit was typed. */
export function clampedInteger(text: string, min: number, max: number): number | null {
  if (text === "") return null;
  return Math.min(max, Math.max(min, Number(text)));
}

/**
 * A host setting that is a whole number, typed. Only digits are taken. It saves when it is
 * submitted or loses focus, held to its range, as SettingField does for text; a field left empty
 * goes back to the stored number and saves nothing.
 */
export function NumberField({
  label: name,
  value,
  min,
  max,
  onSave,
  problem,
  styles,
}: NumberFieldProps) {
  const label = useT()(name);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // What is typed, until the host has answered its save; null shows the stored number.
  const [draft, setDraft] = useState<string | null>(null);
  const saving = useRef(false);
  const type = useCallback((text: string) => setDraft(text.replace(/\D/g, "")), []);
  const commit = useCallback(() => {
    if (draft === null || saving.current) return;
    const next = clampedInteger(draft, min, max);
    if (value === null || next === null || next === value) {
      setDraft(null);
      return;
    }
    saving.current = true;
    setDraft(String(next));
    void onSave(next).finally(() => {
      saving.current = false;
      if (mounted.current) setDraft(null);
    });
  }, [draft, value, min, max, onSave]);
  return (
    <View style={styles.headerField}>
      <Text style={styles.sheetLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={draft ?? (value === null ? "" : String(value))}
        editable={value !== null}
        onChangeText={type}
        onBlur={commit}
        onSubmitEditing={commit}
        inputMode="numeric"
        keyboardType="number-pad"
        autoCorrect={false}
        spellCheck={false}
        style={styles.fieldInput}
      />
      {problem === null ? null : (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {problem}
        </Text>
      )}
    </View>
  );
}
