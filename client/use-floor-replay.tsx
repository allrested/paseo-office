import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { OfficeSnapshot } from "../shared/contracts.js";
import { buildOfficeModel, type OfficeModel } from "../shared/model.js";
import type { ReplaySpeed, Timeline } from "../shared/timeline.js";
import { ActionButton } from "./action-button.js";
import { replayedOffice, replaySignature } from "./floor-replay.js";
import type { OfficeStyles } from "./styles.js";

/** A replay's head moves this often; each move is this long times the speed. */
const TICK_MS = 250;

interface Playing {
  timeline: Timeline;
  speed: ReplaySpeed;
  head: number;
  paused: boolean;
}

export interface FloorReplay {
  /** The floor's people as the timeline saw them at the head; null while nothing is replayed. */
  model: OfficeModel | null;
  /** Where the replay is, for the bar; null while nothing is replayed. */
  head: number | null;
  speed: ReplaySpeed | null;
  paused: boolean;
  /**
   * Starts at the timeline's first moment and runs to its last, then ends by itself. Absent while
   * no 3D floor is showing: there is then nothing to replay on.
   */
  start: ((timeline: Timeline, speed: ReplaySpeed) => void) | undefined;
  /** The model the floor draws: the replayed one while there is one, else today's. */
  shown(today: OfficeModel): OfficeModel;
  toggle(): void;
  stop(): void;
}

/**
 * A replay of the timeline on the floor: the head moves from the range's start to its end at the
 * chosen speed, and the floor draws the office as it was seen then. It ends at the range's end,
 * at Now, when another view takes the 3D floor's place, and when the office's data stops being live.
 */
export function useFloorReplay(state: OfficeSnapshot, live: boolean, on3d: boolean): FloorReplay {
  const [playing, setPlaying] = useState<Playing | null>(null);
  const running = playing !== null && !playing.paused;
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => {
      setPlaying((now) => {
        if (now === null || now.paused) return now;
        const head = now.head + TICK_MS * now.speed;
        return head >= now.timeline.to ? null : { ...now, head };
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => {
    if (!live || !on3d) setPlaying(null);
  }, [live, on3d]);

  // The floor is told only when something on it changes: most moves of the head change nothing.
  const kept = useRef<{ signature: string; model: OfficeModel } | null>(null);
  const model = useMemo(() => {
    if (playing === null) {
      kept.current = null;
      return null;
    }
    const office = replayedOffice(state, playing.timeline, playing.head);
    const signature = replaySignature(office);
    if (kept.current?.signature !== signature) {
      kept.current = { signature, model: buildOfficeModel(office) };
    }
    return kept.current.model;
  }, [state, playing]);

  const start = useCallback((timeline: Timeline, speed: ReplaySpeed) => {
    setPlaying({ timeline, speed, head: timeline.from, paused: false });
  }, []);
  const toggle = useCallback(
    () => setPlaying((now) => (now === null ? now : { ...now, paused: !now.paused })),
    [],
  );
  const stop = useCallback(() => setPlaying(null), []);
  const shown = useCallback((today: OfficeModel) => model ?? today, [model]);
  return {
    model,
    shown,
    head: playing?.head ?? null,
    speed: playing?.speed ?? null,
    paused: playing?.paused ?? false,
    start: on3d ? start : undefined,
    toggle,
    stop,
  };
}

function clockText(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** What the bar says of the moment shown: "Replay · 14:05 · 60×". */
export function replayLine(head: number, speed: ReplaySpeed): string {
  return `Replay · ${clockText(head)} · ${speed}×`;
}

interface BarProps {
  replay: FloorReplay;
  styles: OfficeStyles;
}

/** Over the floor while it shows the past: the moment, Pause or Resume, and the way back to now. */
export function FloorReplayBar({ replay, styles }: BarProps) {
  const { head, speed, paused, toggle, stop } = replay;
  const press = useCallback(async () => toggle(), [toggle]);
  const end = useCallback(async () => stop(), [stop]);
  if (head === null || speed === null) return null;
  const label = paused ? "Resume" : "Pause";
  return (
    <View style={styles.banner}>
      <Text accessibilityLiveRegion="none" style={styles.machineValue}>
        {replayLine(head, speed)}
      </Text>
      <View style={styles.actions}>
        <ActionButton label={label} pendingLabel={label} onPress={press} styles={styles} />
        <ActionButton label="Now" pendingLabel="Now" onPress={end} styles={styles} primary />
      </View>
    </View>
  );
}
