import { useState, useRef, useEffect, useCallback } from "react";
import { View } from "react-native";
import { Text } from "./text.js";
import { TextInput } from "./text.js";
import type { OfficeStyles } from "./styles.js";
import { useT } from "./ui-language.js";
interface SettingFieldProps {
  label: string;
  hint: string;
  /** Null while the settings are read or cannot be read: the field is then not usable. */
  value: string | null;
  /** Resolves once the host has answered, and never rejects. */
  onSave(next: string): Promise<unknown>;
  problem: string | null;
  /** A field of this many lines, for text that is long or has line breaks; one line when absent. */
  lines?: number;
  /** The most characters it takes. */
  maxLength?: number;
  styles: OfficeStyles;
}

/**
 * A host setting typed as text. It saves when it is submitted or loses focus, not on each
 * keystroke, since each save brings the daemon's schedule in step again. The text, trimmed, shows
 * until the host has answered; a refused save goes back to the stored value.
 */
export function SettingField(props: SettingFieldProps) {
  const { value, onSave, problem, lines, maxLength, styles } = props;
  const t = useT();
  const label = t(props.label);
  const hint = t(props.hint);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // What is typed, until the host has answered its save; null shows the stored value.
  const [draft, setDraft] = useState<string | null>(null);
  // A submit blurs the field too: one save, not a second against a revision already gone.
  const saving = useRef(false);
  const commit = useCallback(() => {
    if (draft === null || saving.current) return;
    const next = draft.trim();
    if (value === null || next === value) {
      setDraft(null);
      return;
    }
    saving.current = true;
    setDraft(next);
    void onSave(next).finally(() => {
      saving.current = false;
      if (mounted.current) setDraft(null);
    });
  }, [draft, value, onSave]);
  return (
    <View style={styles.headerField}>
      <Text style={styles.sheetLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        value={draft ?? value ?? ""}
        editable={value !== null}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        multiline={lines !== undefined}
        numberOfLines={lines}
        maxLength={maxLength}
        style={lines === undefined ? styles.fieldInput : styles.input}
      />
      <Text style={styles.fieldHint}>{hint}</Text>
      {problem === null ? null : (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {problem}
        </Text>
      )}
    </View>
  );
}
