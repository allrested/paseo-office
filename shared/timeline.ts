import { z } from "zod";
import { ACTIVITY_KINDS, type ActivityKind } from "./names.js";

/** What an agent is at, as the timeline draws it: at work, waiting for the user, resting, stopped on an error. */
export const TIMELINE_STATES = ["work", "wait", "rest", "fail"] as const;
export type TimelineState = (typeof TIMELINE_STATES)[number];

const SpanSchema = z.object({ from: z.number(), to: z.number(), state: z.enum(TIMELINE_STATES) });
export type TimelineSpan = z.output<typeof SpanSchema>;

const StepSchema = z.object({ at: z.number(), kind: z.enum(ACTIVITY_KINDS) });
export type TimelineStep = z.output<typeof StepSchema>;

/** The most steps of one lane that are sent: the newest. The counts cover them all. */
export const LANE_STEPS_MAX = 600;

export const TimelineLaneSchema = z.object({
  id: z.string(),
  name: z.string(),
  team: z.string(),
  provider: z.string(),
  /** In order, none overlapping; a time the office was not watching has no span. */
  spans: z.array(SpanSchema),
  steps: z.array(StepSchema),
  /** Tool calls in the range by what they were for: files changed, commands run. */
  edits: z.number(),
  commands: z.number(),
  /** What the agent's turns cost in the range; null when its provider says no cost. */
  costUsd: z.number().nullable(),
});
export type TimelineLane = z.output<typeof TimelineLaneSchema>;

export const TimelineSchema = z.object({
  from: z.number(),
  to: z.number(),
  lanes: z.array(TimelineLaneSchema),
});
export type Timeline = z.output<typeof TimelineSchema>;

const HOUR = 3_600_000;
export const DAY_MS = 24 * HOUR;
export const TIMELINE_RANGES = [
  { id: "1h", label: "1 hour", ms: HOUR },
  { id: "6h", label: "6 hours", ms: 6 * HOUR },
  { id: "24h", label: "24 hours", ms: DAY_MS },
] as const;
export type TimelineRange = (typeof TIMELINE_RANGES)[number]["id"];

/** How many times faster than the clock a replay runs. */
export const REPLAY_SPEEDS = [30, 60, 120] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

const EDITS: ReadonlySet<ActivityKind> = new Set(["edit", "write"]);
const COMMANDS: ReadonlySet<ActivityKind> = new Set(["command", "test", "deploy"]);
export const isEdit = (kind: ActivityKind) => EDITS.has(kind);
export const isCommand = (kind: ActivityKind) => COMMANDS.has(kind);

/** What the agent was at then; null while the office was not watching it. */
export function stateAt(lane: TimelineLane, at: number): TimelineState | null {
  return lane.spans.find((span) => span.from <= at && at < span.to)?.state ?? null;
}

// How long a tool call stays what the agent "is at" in a replay: the reads are 5 s apart.
const STEP_SHOWN_MS = 60_000;

const KIND_WORDS: Readonly<Record<ActivityKind, string>> = {
  read: "reading",
  search: "searching",
  skill: "reading a skill",
  edit: "editing",
  write: "writing a file",
  command: "running a command",
  web: "on the web",
  tool: "using a tool",
  subagent: "handing work to a sub-agent",
  plan: "planning",
  test: "running tests",
  commit: "committing",
  push: "pushing",
  deploy: "deploying",
};
const STATE_WORDS: Readonly<Record<TimelineState, string>> = {
  work: "at work",
  wait: "waiting for you",
  rest: "resting",
  fail: "stopped on an error",
};

/** What the agent was doing then, in a few words. */
export function doingAt(lane: TimelineLane, at: number): string {
  const state = stateAt(lane, at);
  if (state === null) return "not watched";
  if (state !== "work") return STATE_WORDS[state];
  // (no findLast: the phone's engine lacks it)
  let kind: ActivityKind | null = null;
  for (const step of lane.steps) {
    if (step.at > at) break;
    if (at - step.at < STEP_SHOWN_MS) kind = step.kind;
  }
  return kind === null ? STATE_WORDS.work : KIND_WORDS[kind];
}

/** "3 h 20 min", "45 min", "under a minute". */
export function durationText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

export interface WeekRecap {
  /** Time at work, of every agent together. */
  workMs: number;
  /** Turns started: a rest, an error or an unwatched time that turned into work. */
  prompts: number;
  edits: number;
  commands: number;
  /** Null when no provider said a cost. */
  costUsd: number | null;
  /** The team with the most time at work; null when nobody worked. */
  busiestTeam: string | null;
  /** Time at work in each of the 24 hours ending at `to`, oldest first. */
  days: { from: number; workMs: number }[];
}

export interface PlanEater {
  id: string;
  name: string;
  team: string;
  workMs: number;
  /** Null when its provider says no cost. */
  costUsd: number | null;
}

/** The lanes that used the most: by cost where a provider says one, else by time at work. */
export function planEaters(timeline: Timeline, most = 5): PlanEater[] {
  return timeline.lanes
    .map((lane) => ({
      id: lane.id,
      name: lane.name,
      team: lane.team,
      costUsd: lane.costUsd,
      workMs: lane.spans.reduce(
        (total, span) => total + (span.state === "work" ? span.to - span.from : 0),
        0,
      ),
    }))
    .filter((eater) => eater.workMs > 0 || (eater.costUsd ?? 0) > 0)
    .sort((a, b) => (b.costUsd ?? 0) - (a.costUsd ?? 0) || b.workMs - a.workMs)
    .slice(0, most);
}

function overlap(span: TimelineSpan, from: number, to: number): number {
  return Math.max(0, Math.min(span.to, to) - Math.max(span.from, from));
}

function promptsOf(lane: TimelineLane): number {
  let prompts = 0;
  lane.spans.forEach((span, index) => {
    if (span.state !== "work") return;
    const before = lane.spans[index - 1];
    // Work straight after a wait is the same turn going on: the user answered, nobody prompted.
    const sameTurn = before !== undefined && before.state === "wait" && before.to === span.from;
    if (!sameTurn) prompts += 1;
  });
  return prompts;
}

/** A timeline's totals, with its time at work in days that end at the timeline's end. */
export function weekRecap(timeline: Timeline): WeekRecap {
  const days: WeekRecap["days"] = [];
  for (let from = timeline.to - DAY_MS; from >= timeline.from; from -= DAY_MS) {
    days.unshift({ from, workMs: 0 });
  }
  const byTeam = new Map<string, number>();
  let costUsd: number | null = null;
  let workMs = 0;
  for (const lane of timeline.lanes) {
    if (lane.costUsd !== null) costUsd = (costUsd ?? 0) + lane.costUsd;
    for (const span of lane.spans) {
      if (span.state !== "work") continue;
      const worked = span.to - span.from;
      workMs += worked;
      byTeam.set(lane.team, (byTeam.get(lane.team) ?? 0) + worked);
      for (const day of days) day.workMs += overlap(span, day.from, day.from + DAY_MS);
    }
  }
  let busiestTeam: string | null = null;
  for (const [team, worked] of byTeam) {
    if (busiestTeam === null || worked > (byTeam.get(busiestTeam) ?? 0)) busiestTeam = team;
  }
  const sum = (pick: (lane: TimelineLane) => number) =>
    timeline.lanes.reduce((total, lane) => total + pick(lane), 0);
  return {
    workMs,
    prompts: sum(promptsOf),
    edits: sum((lane) => lane.edits),
    commands: sum((lane) => lane.commands),
    costUsd,
    busiestTeam,
    days,
  };
}
