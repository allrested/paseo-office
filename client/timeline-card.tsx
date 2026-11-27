import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useRpc } from "@getpaseo/plugin/client";
import { timelineRpc } from "../shared/contracts.js";
import {
  DAY_MS,
  REPLAY_SPEEDS,
  TIMELINE_RANGES,
  doingAt,
  durationText,
  planEaters,
  weekRecap,
  type PlanEater,
  type ReplaySpeed,
  type Timeline,
  type TimelineLane,
  type TimelineRange,
  type TimelineState,
} from "../shared/timeline.js";
import { ActionButton } from "./action-button.js";
import { OfficeModal as Modal } from "./office-modal.js";
import { SegmentPill } from "./segment-pill.js";
import type { OfficeStyles } from "./styles.js";

type Tab = TimelineRange | "week";
const WEEK_MS = 7 * DAY_MS;
/** A replay's head moves this often; each move is this long times the speed. */
const TICK_MS = 100;
/** While nothing is replayed the lanes are read again this often. */
const REFRESH_MS = 30_000;

const layout = StyleSheet.create({
  lanes: { gap: 10 },
  lane: { gap: 4 },
  laneHead: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  laneName: { flexShrink: 1 },
  track: { height: 14, borderRadius: 4, overflow: "hidden" },
  piece: { position: "absolute", top: 0, bottom: 0 },
  step: { position: "absolute", top: 0, bottom: 0, width: 1, opacity: 0.55 },
  head: { position: "absolute", top: 0, bottom: 0, width: 2 },
  controls: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  figures: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  figure: { flexBasis: 120, flexGrow: 1, gap: 2 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 6, height: 72 },
  barColumn: { flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 4, height: "100%" },
  bar: { width: "100%", borderRadius: 3, minHeight: 2 },
});

function clockText(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function stateColor(styles: OfficeStyles, state: TimelineState): string {
  const dot = { work: "running", wait: "warning", fail: "danger", rest: "idle" } as const;
  return String(styles.dot[dot[state]].backgroundColor);
}

interface LaneProps {
  lane: TimelineLane;
  from: number;
  to: number;
  /** Where the replay is; null while nothing is replayed. */
  head: number | null;
  styles: OfficeStyles;
}

function Lane({ lane, from, to, head, styles }: LaneProps) {
  const width = to - from;
  const pieces = useMemo(() => {
    const percent = (at: number) => `${((at - from) / width) * 100}%` as const;
    return {
      spans: lane.spans.map((span) => ({
        key: `${span.from}`,
        style: [
          layout.piece,
          {
            left: percent(span.from),
            width: percent(from + (span.to - span.from)),
            backgroundColor: stateColor(styles, span.state),
            opacity: span.state === "rest" ? 0.3 : 1,
          } satisfies ViewStyle,
        ],
      })),
      steps: lane.steps.map((step, index) => ({
        key: `${step.at}:${index}`,
        style: [
          layout.step,
          { left: percent(step.at), backgroundColor: String(styles.host.name.color) },
        ],
      })),
    };
  }, [lane, from, width, styles]);
  const headStyle = useMemo(
    () =>
      head === null
        ? null
        : [
            layout.head,
            {
              left: `${((head - from) / width) * 100}%` as const,
              backgroundColor: String(styles.host.name.color),
            },
          ],
    [head, from, width, styles],
  );
  const doing = doingAt(lane, head ?? to - 1);
  const track = useMemo(() => [styles.host.track, layout.track], [styles]);
  const name = useMemo(() => [styles.host.name, layout.laneName], [styles]);
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${lane.name}, ${lane.team}: ${doing}`}
      style={layout.lane}
    >
      <View style={layout.laneHead}>
        <Text style={name} numberOfLines={1}>
          {lane.name}
        </Text>
        <Text style={styles.host.note} numberOfLines={1}>
          {lane.team} · {doing}
        </Text>
      </View>
      <View style={track}>
        {pieces.spans.map((piece) => (
          <View key={piece.key} style={piece.style} />
        ))}
        {pieces.steps.map((piece) => (
          <View key={piece.key} style={piece.style} />
        ))}
        {headStyle && <View style={headStyle} />}
      </View>
    </View>
  );
}

function Figure({ label, value, styles }: { label: string; value: string; styles: OfficeStyles }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={layout.figure}>
      <Text style={styles.host.title}>{value}</Text>
      <Text style={styles.host.note}>{label}</Text>
    </View>
  );
}

function eaterText(eater: PlanEater): string {
  const worked = `${durationText(eater.workMs)} at work`;
  return eater.costUsd === null ? worked : `$${eater.costUsd.toFixed(2)}, ${worked}`;
}

function Week({ timeline, styles }: { timeline: Timeline; styles: OfficeStyles }) {
  const recap = useMemo(() => weekRecap(timeline), [timeline]);
  const eaters = useMemo(() => planEaters(timeline), [timeline]);
  const most = Math.max(1, ...recap.days.map((day) => day.workMs));
  const bars = useMemo(
    () =>
      recap.days.map((day) => ({
        key: String(day.from),
        // The day a bar's 24 hours end in: the last one is today.
        label: WEEKDAYS[new Date(day.from + DAY_MS - 1).getDay()],
        text: durationText(day.workMs),
        style: [
          layout.bar,
          {
            height: `${(day.workMs / most) * 100}%` as const,
            backgroundColor: stateColor(styles, "work"),
            opacity: day.workMs === 0 ? 0.25 : 1,
          },
        ],
      })),
    [recap.days, most, styles],
  );
  if (recap.workMs === 0) {
    return (
      <Text style={styles.host.empty}>
        Nobody was seen at work in the last seven days. The office sees only while it is open.
      </Text>
    );
  }
  return (
    <View style={styles.host.body}>
      <View style={layout.figures}>
        <Figure label="At work" value={durationText(recap.workMs)} styles={styles} />
        <Figure label="Turns" value={String(recap.prompts)} styles={styles} />
        <Figure label="Edits" value={String(recap.edits)} styles={styles} />
        <Figure label="Commands" value={String(recap.commands)} styles={styles} />
        <Figure
          label="Cost"
          value={recap.costUsd === null ? "Not reported" : `$${recap.costUsd.toFixed(2)}`}
          styles={styles}
        />
        <Figure label="Busiest team" value={recap.busiestTeam ?? "None"} styles={styles} />
      </View>
      <View style={layout.bars}>
        {bars.map((bar) => (
          <View
            key={bar.key}
            accessible
            accessibilityLabel={`${bar.label}: ${bar.text} at work`}
            style={layout.barColumn}
          >
            <View style={bar.style} />
            <Text style={styles.host.note}>{bar.label}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.host.note}>
        Counted from what the office saw while it was open, in the 24 hours each bar ends.
      </Text>
      <View style={styles.host.group}>
        <Text accessibilityRole="header" style={styles.host.title}>
          What eats your plan
        </Text>
        {eaters.map((eater) => (
          <View
            key={eater.id}
            accessible
            accessibilityRole="text"
            accessibilityLabel={`${eater.name}: ${eaterText(eater)}`}
            style={layout.laneHead}
          >
            <Text style={styles.host.name} numberOfLines={1}>
              {eater.name}
            </Text>
            <Text style={styles.host.note}>
              {eater.team} · {eaterText(eater)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

interface Replay {
  head: number;
  playing: boolean;
}

/** A replay's head, moved while it plays; it stops at the end. */
function useReplay(timeline: Timeline | null, speed: ReplaySpeed) {
  const [replay, setReplay] = useState<Replay | null>(null);
  const end = timeline?.to ?? 0;
  const playing = replay?.playing ?? false;
  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => {
      setReplay((now) => {
        if (now === null || !now.playing) return now;
        const head = now.head + TICK_MS * speed;
        return head >= end ? { head: end, playing: false } : { head, playing: true };
      });
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [playing, speed, end]);
  const toggle = useCallback(() => {
    if (timeline === null) return;
    setReplay((now) => {
      // From the start when there is none, and again when the last one reached the end.
      if (now === null || now.head >= timeline.to) return { head: timeline.from, playing: true };
      return { head: now.head, playing: !now.playing };
    });
  }, [timeline]);
  const stop = useCallback(() => setReplay(null), []);
  return { replay, toggle, stop };
}

interface LanesProps {
  timeline: Timeline;
  replay: Replay | null;
  speed: ReplaySpeed;
  onSpeed(next: ReplaySpeed): void;
  onToggle(): void;
  onStop(): void;
  /** Replays these lanes on the 3D floor; absent where there is none to replay on. */
  onFloor: (() => void) | undefined;
  styles: OfficeStyles;
}

/** The replay's controls over a lane per agent. */
function Lanes({
  timeline,
  replay,
  speed,
  onSpeed,
  onToggle,
  onStop,
  onFloor,
  styles,
}: LanesProps) {
  const floor = useCallback(async () => onFloor?.(), [onFloor]);
  let playLabel = "Replay";
  if (replay?.playing) playLabel = "Pause";
  else if (replay !== null && replay.head < timeline.to) playLabel = "Resume";
  return (
    <>
      <View style={layout.controls}>
        <ActionButton
          label={playLabel}
          pendingLabel={playLabel}
          onPress={onToggle}
          disabled={timeline.lanes.length === 0}
          styles={styles}
          primary
        />
        {replay !== null && (
          <ActionButton label="Now" pendingLabel="Now" onPress={onStop} styles={styles} />
        )}
        {onFloor === undefined ? null : (
          <ActionButton
            label="Replay on the floor"
            pendingLabel="Replay on the floor"
            onPress={floor}
            disabled={timeline.lanes.length === 0}
            styles={styles}
          />
        )}
        <View role="group" aria-label="Replay speed" style={styles.segments}>
          {REPLAY_SPEEDS.map((value) => (
            <SegmentPill
              key={value}
              value={value}
              name={`${value} times the clock`}
              text={`${value}×`}
              on={speed === value}
              disabled={false}
              onPress={onSpeed}
              styles={styles}
            />
          ))}
        </View>
        <Text accessibilityLiveRegion="none" style={styles.machineValue}>
          {clockText(replay?.head ?? timeline.to)}
        </Text>
      </View>
      {timeline.lanes.length === 0 ? (
        <Text style={styles.host.empty}>
          Nobody was seen in this time. The office sees only while it is open.
        </Text>
      ) : (
        <View style={layout.lanes}>
          {timeline.lanes.map((lane) => (
            <Lane
              key={lane.id}
              lane={lane}
              from={timeline.from}
              to={timeline.to}
              head={replay?.head ?? null}
              styles={styles}
            />
          ))}
        </View>
      )}
      <Text style={styles.host.note}>
        Green is at work, amber waiting for you, red stopped on an error, grey resting. A gap is a
        time the office was closed. The marks are tool calls.
      </Text>
    </>
  );
}

interface Read {
  timeline: Timeline | null;
  problem: string | null;
}

/** The lanes of the last `ms`, read when the card shows and again while `fresh`. */
function useTimeline(open: boolean, ms: number, fresh: boolean): Read {
  const ask = useRpc(timelineRpc);
  // Kept in a ref: the read restarts with the range, not with the call's identity.
  const asking = useRef(ask);
  asking.current = ask;
  const [read, setRead] = useState<Read & { ms: number }>({ timeline: null, problem: null, ms });
  useEffect(() => {
    if (!open) return undefined;
    let ended = false;
    const load = async () => {
      const to = Date.now();
      try {
        const answer = await asking.current({ from: to - ms, to });
        if (ended) return;
        setRead(
          answer.ok
            ? { timeline: answer.timeline, problem: null, ms }
            : { timeline: null, problem: answer.problem, ms },
        );
      } catch (error) {
        const problem = error instanceof Error ? error.message : String(error);
        if (!ended) setRead({ timeline: null, problem, ms });
      }
    };
    void load();
    const timer = fresh ? setInterval(() => void load(), REFRESH_MS) : null;
    return () => {
      ended = true;
      if (timer !== null) clearInterval(timer);
    };
  }, [open, ms, fresh]);
  // Another range's lanes are not shown under this one's pills.
  return read.ms === ms ? read : { timeline: null, problem: null };
}

export interface TimelineCardProps {
  open: boolean;
  styles: OfficeStyles;
  /**
   * Replays the range on the floor, at the card's speed; the card closes for it. Absent where no
   * 3D floor is showing, and then no button offers it.
   */
  onFloorReplay?(timeline: Timeline, speed: ReplaySpeed): void;
  onClose(): void;
}

/**
 * What each agent was at over the last hours, a lane each, replayed at up to 120 times the
 * clock; and the week in figures. It shows what the office saw while it was open.
 */
export function TimelineCard({ open, styles, onFloorReplay, onClose }: TimelineCardProps) {
  const [tab, setTab] = useState<Tab>("1h");
  const [speed, setSpeed] = useState<ReplaySpeed>(60);
  const ms = tab === "week" ? WEEK_MS : (TIMELINE_RANGES.find((r) => r.id === tab)?.ms ?? 0);
  const [replaying, setReplaying] = useState(false);
  const { timeline, problem } = useTimeline(open, ms, !replaying);
  const { replay, toggle, stop } = useReplay(tab === "week" ? null : timeline, speed);
  useEffect(() => setReplaying(replay !== null), [replay]);
  const replayOnFloor = useCallback(() => {
    if (timeline === null || onFloorReplay === undefined) return;
    stop();
    onClose();
    onFloorReplay(timeline, speed);
  }, [timeline, onFloorReplay, stop, onClose, speed]);
  const choose = useCallback(
    (next: Tab) => {
      stop();
      setTab(next);
    },
    [stop],
  );
  const change = useCallback(
    (next: boolean) => {
      if (next) return;
      stop();
      onClose();
    },
    [onClose, stop],
  );
  const icon = useMemo(
    () => <Icon name="History" size={18} color={String(styles.host.label.color)} />,
    [styles],
  );
  return (
    <Modal icon={icon} title="Timeline" open={open} onOpenChange={change}>
      <Modal.Content>
        {open && (
          <View style={styles.host.body}>
            <View role="group" aria-label="Range" style={styles.segments}>
              {TIMELINE_RANGES.map((range) => (
                <SegmentPill
                  key={range.id}
                  value={range.id}
                  name={range.label}
                  on={tab === range.id}
                  disabled={false}
                  onPress={choose}
                  styles={styles}
                />
              ))}
              <SegmentPill
                value="week"
                name="This week"
                on={tab === "week"}
                disabled={false}
                onPress={choose}
                styles={styles}
              />
            </View>
            {problem && (
              <Text accessibilityRole="alert" style={styles.actionError}>
                The timeline cannot be read: {problem}
              </Text>
            )}
            {timeline === null && problem === null && (
              <Text style={styles.host.empty}>Reading the timeline...</Text>
            )}
            {timeline !== null && tab === "week" && <Week timeline={timeline} styles={styles} />}
            {timeline !== null && tab !== "week" && (
              <Lanes
                timeline={timeline}
                replay={replay}
                speed={speed}
                onSpeed={setSpeed}
                onToggle={toggle}
                onStop={stop}
                onFloor={onFloorReplay === undefined ? undefined : replayOnFloor}
                styles={styles}
              />
            )}
          </View>
        )}
      </Modal.Content>
    </Modal>
  );
}
