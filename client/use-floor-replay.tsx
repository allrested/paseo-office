import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import { Text } from "./text.js";
import type { OfficeSnapshot } from "../shared/contracts.js";
import { buildOfficeModel, type OfficeModel } from "../shared/model.js";
import type { Timeline } from "../shared/timeline.js";
import { ActionButton } from "./action-button.js";
import { replayedOffice, replaySignature } from "./floor-replay.js";
import { SegmentPill } from "./segment-pill.js";
import type { OfficeStyles } from "./styles.js";

/** A replay's head moves this often; each move is this long times the speed. */
const TICK_MS = 250;
/** How fast the floor replays, in times the clock: slow enough to watch one turn, fast enough for a day. */
export const FLOOR_SPEEDS = [10, 30, 60, 120, 600] as const;
/** How far Back and Forward move the head. */
export const SKIP_MS = 10 * 60_000;

interface Playing {
  timeline: Timeline;
  speed: number;
  head: number;
  paused: boolean;
}

export interface FloorReplay {
  /** The floor's people as the timeline saw them at the head; null while nothing is replayed. */
  model: OfficeModel | null;
  /** Where the replay is, for the bar; null while nothing is replayed. */
  head: number | null;
  /** The range replayed; null while nothing is replayed. */
  from: number | null;
  to: number | null;
  speed: number | null;
  paused: boolean;
  /** How many people the floor shows at the head. */
  seen: number;
  /**
   * Starts at the timeline's first moment and runs to its last, then ends by itself. Absent while
   * no 3D floor is showing: there is then nothing to replay on.
   */
  start: ((timeline: Timeline, speed: number) => void) | undefined;
  /** The model the floor draws: the replayed one while there is one, else today's. */
  shown(today: OfficeModel): OfficeModel;
  toggle(): void;
  setSpeed(speed: number): void;
  /** Moves the head to a share of the range, 0 at its start and 1 at its end. */
  seek(share: number): void;
  /** Moves the head by this long, back for a negative time; it stays inside the range. */
  skip(ms: number): void;
  stop(): void;
}

/** The head moved to `at`, kept inside the range and a moment short of its end. */
function headAt(playing: Playing, at: number): number {
  const { from, to } = playing.timeline;
  return Math.max(from, Math.min(at, to - 1));
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
      kept.current = { signature, model: { ...buildOfficeModel(office), replayed: true } };
    }
    return kept.current.model;
  }, [state, playing]);

  const start = useCallback((timeline: Timeline, speed: number) => {
    setPlaying({ timeline, speed, head: timeline.from, paused: false });
  }, []);
  const change = useCallback(
    (next: (now: Playing) => Playing) => setPlaying((now) => (now === null ? now : next(now))),
    [],
  );
  const toggle = useCallback(() => change((now) => ({ ...now, paused: !now.paused })), [change]);
  const setSpeed = useCallback((speed: number) => change((now) => ({ ...now, speed })), [change]);
  const seek = useCallback(
    (share: number) =>
      change((now) => {
        const { from, to } = now.timeline;
        return { ...now, head: headAt(now, from + (to - from) * Math.max(0, Math.min(1, share))) };
      }),
    [change],
  );
  const skip = useCallback(
    (ms: number) => change((now) => ({ ...now, head: headAt(now, now.head + ms) })),
    [change],
  );
  const stop = useCallback(() => setPlaying(null), []);
  const shown = useCallback((today: OfficeModel) => model ?? today, [model]);
  return {
    model,
    shown,
    head: playing?.head ?? null,
    from: playing?.timeline.from ?? null,
    to: playing?.timeline.to ?? null,
    speed: playing?.speed ?? null,
    paused: playing?.paused ?? false,
    seen: model?.agents.size ?? 0,
    start: on3d ? start : undefined,
    toggle,
    setSpeed,
    seek,
    skip,
    stop,
  };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;
const pad = (value: number) => String(value).padStart(2, "0");

/** The time of day shown, to the second: the head moves minutes in a second, and the seconds show it moving. */
export function replayClock(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** The day shown, as it is spoken of today: "Today", "Yesterday", or "Wed 25 Nov". */
export function replayDay(at: number, now: number): string {
  const midnight = (time: number) => new Date(time).setHours(0, 0, 0, 0);
  const days = Math.round((midnight(now) - midnight(at)) / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const date = new Date(at);
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

/** Who the floor shows at the moment: "3 people on the floor", or that nobody was seen. */
export function replaySeen(seen: number): string {
  if (seen === 0) return "Nobody was seen at this moment";
  return seen === 1 ? "1 person on the floor" : `${seen} people on the floor`;
}

interface BarProps {
  replay: FloorReplay;
  /** The device's time, to say which day the replay shows; the bar's own clock when absent. */
  now?: number;
  styles: OfficeStyles;
}

interface TrackProps {
  share: number;
  from: number;
  to: number;
  onSeek(share: number): void;
  styles: OfficeStyles;
}

/** Where the head is in the range: a press anywhere on it moves the head there. */
function Track({ share, from, to, onSeek, styles }: TrackProps) {
  const width = useRef(0);
  const measure = useCallback((event: LayoutChangeEvent) => {
    width.current = event.nativeEvent.layout.width;
  }, []);
  const press = useCallback(
    (event: GestureResponderEvent) => {
      if (width.current > 0) onSeek(event.nativeEvent.locationX / width.current);
    },
    [onSeek],
  );
  const ui = styles.replay;
  const value = useMemo(() => ({ min: 0, max: 100, now: Math.round(share * 100) }), [share]);
  const fill = useMemo(() => [ui.fill, { width: `${share * 100}%` as const }], [ui, share]);
  return (
    <View style={ui.trackRow}>
      <Text style={ui.edge}>{replayClock(from).slice(0, 5)}</Text>
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel="Replay position"
        accessibilityValue={value}
        onLayout={measure}
        onPress={press}
        style={ui.track}
      >
        <View style={ui.rail}>
          <View style={fill} />
        </View>
      </Pressable>
      <Text style={ui.edge}>{replayClock(to).slice(0, 5)}</Text>
    </View>
  );
}

/**
 * Over the floor while it shows the past: the day and the time shown, where that is in the range
 * (a press moves there), how many people the floor has then, and the controls: Pause or Resume,
 * ten minutes back or on, the speed, and Now.
 */
export function FloorReplayBar({ replay, now, styles }: BarProps) {
  const { head, from, to, speed, paused, toggle, stop, skip, seek, setSpeed, seen } = replay;
  const press = useCallback(async () => toggle(), [toggle]);
  const end = useCallback(async () => stop(), [stop]);
  const back = useCallback(async () => skip(-SKIP_MS), [skip]);
  const on = useCallback(async () => skip(SKIP_MS), [skip]);
  const restart = useCallback(async () => seek(0), [seek]);
  if (head === null || speed === null || from === null || to === null) return null;
  const ui = styles.replay;
  const label = paused ? "Resume" : "Pause";
  return (
    <View accessibilityRole="toolbar" aria-label="Replay" style={ui.bar}>
      <View style={ui.when}>
        <Text style={ui.kicker}>{paused ? "Replay paused" : "Replaying"}</Text>
        <View style={ui.clockRow}>
          <Text style={ui.day}>{replayDay(head, now ?? Date.now())}</Text>
          <Text accessibilityLiveRegion="none" style={ui.clock}>
            {replayClock(head)}
          </Text>
        </View>
        <Text style={ui.seen}>{replaySeen(seen)}</Text>
      </View>
      <View style={ui.middle}>
        <Track
          share={(head - from) / (to - from)}
          from={from}
          to={to}
          onSeek={seek}
          styles={styles}
        />
        <View style={ui.controls}>
          <ActionButton
            label="From the start"
            pendingLabel="From the start"
            onPress={restart}
            styles={styles}
          />
          <ActionButton
            label="−10 min"
            pendingLabel="−10 min"
            name="Back 10 minutes"
            onPress={back}
            styles={styles}
          />
          <ActionButton
            label={label}
            pendingLabel={label}
            onPress={press}
            styles={styles}
            primary
          />
          <ActionButton
            label="+10 min"
            pendingLabel="+10 min"
            name="Forward 10 minutes"
            onPress={on}
            styles={styles}
          />
          <View role="group" aria-label="Replay speed" style={styles.segments}>
            {FLOOR_SPEEDS.map((value) => (
              <SegmentPill
                key={value}
                value={value}
                name={`${value} times the clock`}
                text={`${value}×`}
                on={speed === value}
                disabled={false}
                onPress={setSpeed}
                styles={styles}
              />
            ))}
          </View>
          <ActionButton
            label="Back to now"
            pendingLabel="Back to now"
            onPress={end}
            styles={styles}
          />
        </View>
      </View>
    </View>
  );
}
