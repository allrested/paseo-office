import { useState, useRef, useEffect, useCallback } from "react";
import { View } from "react-native";
import { Text } from "./text.js";
import { TextInput } from "./text.js";
import type { OfficeStyles } from "./styles.js";
import { useT } from "./ui-language.js";
/**
 * What a save came to: `{ refused }` is the field's own check turning the text down, with its
 * message. Anything else is the host's answer, and the text goes back to the stored value.
 */
export type SettingSaveResult = unknown;

function ownRefusal(result: SettingSaveResult): string | null {
  if (typeof result !== "object" || result === null || !("refused" in result)) return null;
  return typeof result.refused === "string" ? result.refused : null;
}

interface SettingFieldProps {
  label: string;
  hint: string;
  /** Null while the settings are read or cannot be read: the field is then not usable. */
  value: string | null;
  /** Resolves once the host has answered, and never rejects; see SettingSaveResult. */
  onSave(next: string): Promise<SettingSaveResult>;
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
 * until the host has answered; a save the host refused goes back to it too; only the field's own refusal ({ refused })
 * keeps the typed text, and its message, until the text is saved, put back, or the stored value moves.
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
  // The field's own refusal of the draft; it lives exactly as long as the draft it kept.
  const [refused, setRefused] = useState<string | null>(null);
  const seen = useRef(value);
  useEffect(() => {
    if (seen.current === value) return;
    seen.current = value;
    // The stored text moved (another device, another save): a kept draft is stale.
    if (refused !== null) {
      setDraft(null);
      setRefused(null);
    }
  }, [value, refused]);
  // A submit blurs the field too: one save, not a second against a revision already gone.
  const saving = useRef(false);
  const commit = useCallback(() => {
    if (draft === null || saving.current) return;
    const next = draft.trim();
    if (value === null || next === value) {
      setDraft(null);
      setRefused(null);
      return;
    }
    saving.current = true;
    setDraft(next);
    void onSave(next).then((result) => {
      saving.current = false;
      if (!mounted.current) return undefined;
      // The field's own refusal keeps what was typed, with its message, so it can be corrected.
      const own = ownRefusal(result);
      setRefused(own);
      if (own === null) setDraft(null);
      return undefined;
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
      {refused === null ? null : (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {refused}
        </Text>
      )}
      {problem === null ? null : (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {problem}
        </Text>
      )}
    </View>
  );
}
