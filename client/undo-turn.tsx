import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { undoRpc, type UndoSkip } from "../shared/contracts.js";
import { ActionButton, failureText } from "./action-button.js";
import type { OfficeStyles } from "./styles.js";
import { Text } from "./text.js";

/** What each reason says of the files it left as they were; the count and "file" come before. */
const SKIPPED: Readonly<Record<UndoSkip, string>> = {
  changed: "changed after the turn",
  outside: "outside the repository",
  ignored: "ignored by git",
  link: "left alone, being a link",
  same: "with nothing to put back",
  write: "that could not be written",
};

export const UNDO_NOT_SHELL =
  "Changes a shell command made are not undone, and a file changed since the turn is left as it is.";

const files = (count: number) => `${count} ${count === 1 ? "file" : "files"}`;

interface Done {
  restored: number;
  skipped: { reason: UndoSkip; count: number }[];
}

interface UndoTurnProps {
  agentId: string;
  /** Whether the session is at work: a turn that has not ended has nothing to undo yet. */
  running: boolean;
  styles: OfficeStyles;
}

/**
 * Undo last turn, for a session whose last turn edited files that git can put back (the host's
 * "Undo last turn" setting is on). It asks first, naming the files, then says what it did.
 */
export function UndoTurn({ agentId, running, styles }: UndoTurnProps) {
  const call = useRpc(undoRpc);
  const [available, setAvailable] = useState(0);
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setAsking(false);
    if (running) {
      setAvailable(0);
      setDone(null);
      return undefined;
    }
    let current = true;
    call({ agentId, op: "status" })
      .then((answer) => (current ? answer.files : 0))
      .catch(() => 0)
      .then((count) => {
        if (current) setAvailable(count);
        return count;
      });
    return () => {
      current = false;
    };
  }, [agentId, running, call]);
  const ask = useCallback(() => setAsking(true), []);
  const keep = useCallback(() => setAsking(false), []);
  const undo = useCallback(async () => {
    try {
      const answer = await call({ agentId, op: "undo" });
      setProblem(null);
      setDone({ restored: answer.restored, skipped: answer.skipped });
      setAvailable(0);
    } catch (failure) {
      setProblem(failureText("Undo last turn", failure));
    }
    setAsking(false);
  }, [call, agentId]);
  if (running || (available === 0 && done === null)) return null;
  const skipped = done?.skipped.reduce((sum, { count }) => sum + count, 0) ?? 0;
  return (
    <View style={styles.headerField}>
      {asking ? (
        <>
          <Text style={styles.sheetLabel}>
            {`Undo the last turn's edits to ${files(available)}?`}
          </Text>
          <Text style={styles.fieldHint}>{UNDO_NOT_SHELL}</Text>
          <View style={styles.actions}>
            <ActionButton
              label="Undo"
              pendingLabel="Undoing..."
              onPress={undo}
              primary
              styles={styles}
            />
            <ActionButton label="Cancel" pendingLabel="Cancel" onPress={keep} styles={styles} />
          </View>
        </>
      ) : (
        available > 0 && (
          <View style={styles.actions}>
            <ActionButton
              label="Undo last turn"
              pendingLabel="Undo last turn"
              onPress={ask}
              styles={styles}
            />
          </View>
        )
      )}
      {done !== null && (
        <>
          <Text style={styles.muted}>{`${files(done.restored)} restored, ${skipped} skipped`}</Text>
          {done.skipped.map(({ reason, count }) => (
            <Text key={reason} style={styles.fieldHint}>
              {`${files(count)} ${SKIPPED[reason]}`}
            </Text>
          ))}
        </>
      )}
      {problem !== null && (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {problem}
        </Text>
      )}
    </View>
  );
}
