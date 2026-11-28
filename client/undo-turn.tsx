import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import {
  undoRpc,
  type Checkpoint,
  type CheckpointFile,
  type UndoSkip,
} from "../shared/contracts.js";
import { ActionButton, failureText } from "./action-button.js";
import type { OfficeStyles } from "./styles.js";
import { Text } from "./text.js";

/** What each reason says of the files it left as they were; the count comes before. */
const SKIPPED: Readonly<Record<UndoSkip, string>> = {
  changed: "changed since the turn",
  same: "already as before the turn",
  outside: "outside the repository",
  git: "inside .git",
  ignored: "ignored by git",
  link: "left alone as links",
  linkedFolder: "in a linked folder",
  submodule: "left alone as submodules",
  write: "could not be written",
  stopped: "not reached: git stopped",
  began: "not reached: an agent began working",
  retry: "not put back yet: undo again to finish",
};

/** The files of a turn shown before "N more". */
const SHOWN = 20;

export const UNDO_ASK =
  "Put back everything that changed in this folder during the turn? Files changed since are left alone.";

/** Said when a turn could not be snapshotted and the list was emptied. */
export const UNDO_GAP =
  "The last turn could not be snapshotted, so the checkpoints before it were dropped.";

const files = (count: number) => `${count} ${count === 1 ? "file" : "files"}`;

/** A turn's end: the clock on this device, 24-hour. */
function clock(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** What a turn did to a file, in a word or its added and removed lines. */
function change(file: CheckpointFile): string {
  if (file.kind !== "modified") return file.kind;
  if (file.added === null || file.removed === null) return "binary";
  return `+${file.added} −${file.removed}`;
}

interface Done {
  restored: number;
  skipped: { reason: UndoSkip; count: number }[];
}

/** A turn's files: the first twenty, the rest behind "N more"; what the host did not list stays a count. */
function TurnFiles({ turn, styles }: { turn: Checkpoint; styles: OfficeStyles }) {
  const [all, setAll] = useState(false);
  const showAll = useCallback(() => setAll(true), []);
  const hidden = all ? 0 : Math.max(0, turn.files.length - SHOWN);
  const shown = all ? turn.files : turn.files.slice(0, SHOWN);
  return (
    <>
      {!turn.usable && <Text style={styles.fieldHint}>{"This checkpoint's snapshot is gone"}</Text>}
      {shown.map((file) => (
        <View key={file.path} style={styles.actions}>
          <Text style={styles.muted}>{file.path}</Text>
          <Text style={styles.fieldHint}>{change(file)}</Text>
        </View>
      ))}
      {hidden > 0 ? (
        <View style={styles.actions}>
          <ActionButton
            label={`${hidden + turn.more} more`}
            pendingLabel={`${hidden + turn.more} more`}
            onPress={showAll}
            styles={styles}
          />
        </View>
      ) : (
        turn.more > 0 && <Text style={styles.fieldHint}>{`${turn.more} more`}</Text>
      )}
    </>
  );
}

/** An earlier turn: one line, its time and how many files, opening to the files. */
function EarlierTurn({ turn, styles }: { turn: Checkpoint; styles: OfficeStyles }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((was) => !was), []);
  const line = `${clock(turn.endedAt)} · ${files(turn.files.length + turn.more)}`;
  return (
    <>
      <View style={styles.actions}>
        <ActionButton label={line} pendingLabel={line} onPress={toggle} styles={styles} />
      </View>
      {open && <TurnFiles turn={turn} styles={styles} />}
    </>
  );
}

interface UndoTurnProps {
  agentId: string;
  /** Whether the session is at work: a turn that has not ended is not a checkpoint yet. */
  running: boolean;
  styles: OfficeStyles;
}

/**
 * Checkpoints, for a session whose turns changed files while the host's "Undo last turn" setting
 * is on: what the newest turn changed, the turns before it folded, and Undo this turn on the
 * newest. It asks first, then says what it put back and why it left the rest.
 */
export function UndoTurn({ agentId, running, styles }: UndoTurnProps) {
  const call = useRpc(undoRpc);
  const [turns, setTurns] = useState<Checkpoint[]>([]);
  const [gap, setGap] = useState(false);
  const [asking, setAsking] = useState(false);
  const [earlier, setEarlier] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setAsking(false);
    if (running) {
      setTurns([]);
      setGap(false);
      setDone(null);
      setProblem(null);
      return undefined;
    }
    let current = true;
    call({ agentId, op: "status" })
      .catch(() => null)
      .then((answer) => {
        if (!current) return answer;
        setTurns(answer?.turns ?? []);
        setGap(Boolean(answer?.gap));
        return answer;
      });
    return () => {
      current = false;
    };
  }, [agentId, running, call]);
  const ask = useCallback(() => setAsking(true), []);
  const keep = useCallback(() => setAsking(false), []);
  const toggleEarlier = useCallback(() => setEarlier((was) => !was), []);
  const [newest, ...before] = turns;
  const shown = newest?.turnId;
  const undo = useCallback(async () => {
    if (shown === undefined) return;
    try {
      // The turn the owner was shown: if it is no longer the newest, the host refuses.
      const answer = await call({ agentId, op: "undo", turnId: shown });
      setProblem(null);
      setDone({ restored: answer.restored, skipped: answer.skipped });
      setTurns(answer.turns);
      setGap(answer.gap !== null);
    } catch (failure) {
      setProblem(failureText("Undo this turn", failure));
      // What the owner saw is out of date: the list as it is now.
      const answer = await call({ agentId, op: "status" }).catch(() => null);
      if (answer !== null) {
        setTurns(answer.turns);
        setGap(answer.gap !== null);
      }
    }
    setAsking(false);
  }, [call, agentId, shown]);
  if (running || (turns.length === 0 && !gap && done === null && problem === null)) return null;
  return (
    <View style={styles.headerField}>
      {gap && <Text style={styles.fieldHint}>{UNDO_GAP}</Text>}
      {newest !== undefined && (
        <>
          <Text style={styles.sheetLabel}>What this turn changed</Text>
          <TurnFiles key={newest.turnId} turn={newest} styles={styles} />
        </>
      )}
      {asking ? (
        <>
          <Text style={styles.fieldHint}>{UNDO_ASK}</Text>
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
        newest?.usable && (
          <View style={styles.actions}>
            <ActionButton
              label="Undo this turn"
              pendingLabel="Undo this turn"
              onPress={ask}
              styles={styles}
            />
          </View>
        )
      )}
      {done !== null && (
        <>
          <Text style={styles.muted}>{`Put back ${files(done.restored)}`}</Text>
          {done.skipped.map(({ reason, count }) => (
            <Text key={reason} style={styles.fieldHint}>
              {`${count} ${SKIPPED[reason]}`}
            </Text>
          ))}
        </>
      )}
      {problem !== null && (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {problem}
        </Text>
      )}
      {before.length > 0 && (
        <>
          <View style={styles.actions}>
            <ActionButton
              label="Earlier turns"
              pendingLabel="Earlier turns"
              onPress={toggleEarlier}
              styles={styles}
            />
          </View>
          {earlier &&
            before.map((turn) => <EarlierTurn key={turn.turnId} turn={turn} styles={styles} />)}
        </>
      )}
    </View>
  );
}
