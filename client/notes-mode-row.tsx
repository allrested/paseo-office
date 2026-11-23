import { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { notesModesRpc, type WriterModes } from "../shared/contracts.js";
import { SegmentPill } from "./segment-pill.js";
import type { OfficeStyles } from "./styles.js";

/** The row's label, and the setting a refused save names. */
export const NOTES_MODE_LABEL = "Writer mode";
/** The pill for no mode set: the office picks, as it did before the setting. */
const OWN_CHOICE = "Office's choice";
const HINT =
  "The mode the stand-up writer starts in. Nobody answers its questions at 8:00, so a mode that asks leaves the note unwritten.";
// The modes that ask for nothing: Claude's and Codex's.
const UNATTENDED: ReadonlySet<string> = new Set(["bypassPermissions", "full-access"]);
const UNATTENDED_HINT = "In this mode the writer runs any tool or command without asking.";

export interface NotesModeRowProps {
  /** The stored mode's id, empty for none; null while the settings are read or cannot be read. */
  value: string | null;
  /** Resolves once the host has answered, and never rejects. */
  onSave(next: string): Promise<unknown>;
  problem: string | null;
  styles: OfficeStyles;
}

type Asked = WriterModes | { problem: string } | null;

/** What stands under the pills beside the hint: the fallback, the warning, or why none is listed. */
function noteOf(asked: Asked, shown: string | null): string | null {
  if (asked === null) return null;
  if ("problem" in asked) return `The writer's modes cannot be listed: ${asked.problem}`;
  if (asked.fellBack) {
    const used = asked.modes.find((mode) => mode.id === asked.modeId)?.label ?? "its default";
    return `${asked.provider} has no mode "${shown}": the writer starts in ${used}.`;
  }
  return shown !== null && UNATTENDED.has(shown) ? UNATTENDED_HINT : null;
}

/**
 * The stand-up writer's mode, as pills of the modes its provider offers, by the provider's own
 * names. The host is asked for them when the row shows and after each save, since the stored
 * mode decides what it says of a fallback. A press shows, and the row takes no other, until the
 * host has answered.
 */
export function NotesModeRow({ value, onSave, problem, styles }: NotesModeRowProps) {
  const ask = useRpc(notesModesRpc);
  const mounted = useRef(true);
  const [asked, setAsked] = useState<Asked>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Kept in a ref: the row asks again when the stored mode changes, not when the call's identity does.
  const asking = useRef(ask);
  asking.current = ask;
  useEffect(() => {
    if (value === null) return;
    void asking.current({}).then(
      (answer) => {
        if (mounted.current) setAsked(answer.ok ? answer : { problem: answer.problem });
        return undefined;
      },
      (error: unknown) => {
        if (mounted.current) {
          setAsked({ problem: error instanceof Error ? error.message : String(error) });
        }
      },
    );
  }, [value]);
  const [wanted, setWanted] = useState<string | null>(null);
  const shown = wanted ?? value;
  const saving = useRef(false);
  const choose = useCallback(
    (next: string) => {
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
  const modes = asked !== null && "modes" in asked ? asked.modes : [];
  // A stored mode this provider lacks still shows as a pill, so what is stored can be seen.
  const stored = shown !== null && shown !== "" && !modes.some((mode) => mode.id === shown);
  const disabled = shown === null || wanted !== null;
  const note = wanted === null ? noteOf(asked, shown) : null;
  return (
    <View style={styles.headerField}>
      <Text style={styles.sheetLabel}>{NOTES_MODE_LABEL}</Text>
      <View
        role="group"
        aria-label={NOTES_MODE_LABEL}
        style={disabled ? styles.segmentsDisabled : styles.segments}
      >
        <SegmentPill
          value=""
          name={OWN_CHOICE}
          on={shown === ""}
          disabled={disabled}
          onPress={choose}
          styles={styles}
        />
        {modes.map((mode) => (
          <SegmentPill
            key={mode.id}
            value={mode.id}
            name={mode.label}
            on={shown === mode.id}
            disabled={disabled}
            onPress={choose}
            styles={styles}
          />
        ))}
        {stored && shown !== null ? (
          <SegmentPill
            value={shown}
            name={shown}
            on
            disabled={disabled}
            onPress={choose}
            styles={styles}
          />
        ) : null}
      </View>
      <Text style={styles.fieldHint}>{HINT}</Text>
      {note === null ? null : <Text style={styles.fieldHint}>{note}</Text>}
      {problem === null ? null : (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {problem}
        </Text>
      )}
    </View>
  );
}
