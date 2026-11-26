import { z } from "zod";
import { ACTIVITY_KINDS, LOBBY, type ActivityKind, type ActivityStep } from "../shared/names.js";
import type { OfficeAgent } from "../shared/contracts.js";
import { agentTitle } from "../shared/model.js";
import {
  DAY_MS,
  LANE_STEPS_MAX,
  TIMELINE_STATES,
  isCommand,
  isEdit,
  type Timeline,
  type TimelineLane,
  type TimelineState,
} from "../shared/timeline.js";
import type { DirectoryView } from "./hub.js";

/** How long the office remembers, and the most marks it keeps: the oldest go first. */
export const TIMELINE_KEEP_MS = 8 * DAY_MS;
export const TIMELINE_MARKS_MAX = 40_000;
/** How far past the most the log may grow before it is cut back and its file written anew. */
export const TIMELINE_MARKS_SLACK = 2_000;

const STATES = [...TIMELINE_STATES, "off"] as const;
type Seen = (typeof STATES)[number];

/**
 * One thing seen of an agent at a time: its state changed (`s`, "off" when the office stopped
 * watching it), it started a tool call (`k`), or its turns cost more (`c`, the US dollars added).
 */
export const MarkSchema = z.object({
  t: z.number(),
  a: z.string(),
  s: z.enum(STATES).optional(),
  k: z.enum(ACTIVITY_KINDS).optional(),
  c: z.number().optional(),
});
type Mark = z.output<typeof MarkSchema>;

export const WhoSchema = z.object({ name: z.string(), team: z.string(), provider: z.string() });
type Who = z.output<typeof WhoSchema>;

/** One line of the log's file: a mark, or who an agent is (`w` is its id; the newest line holds). */
export type TimelineLine = Mark | ({ w: string } & Who);

export const TimelineFileSchema = z.object({
  version: z.literal(1),
  who: z.record(z.string(), WhoSchema),
  marks: z.array(MarkSchema),
});
export type TimelineFile = z.output<typeof TimelineFileSchema>;

export interface TimelinePorts {
  now(): number;
  /** What was added since the last call; the caller adds it to the file when it sees fit. */
  append(lines: readonly TimelineLine[]): void;
  /** The whole log, in place of the file: at the start, and when old marks were cut off. */
  rewrite(file: TimelineFile): void;
}

export interface TimelineLog {
  /** The office as the directory reports it; null when the office stops watching. */
  view(view: DirectoryView | null): void;
  /** The tool call each running agent is at, as the activity reads see it. */
  steps(doing: Readonly<Record<string, ActivityStep>>): void;
  read(from: number, to: number): Timeline;
}

function seenOf(agent: OfficeAgent): Seen {
  if (agent.status === "closed") return "off";
  if (agent.status === "error") return "fail";
  if (agent.permissions.length > 0) return "wait";
  return agent.status === "idle" ? "rest" : "work";
}

interface Building {
  lane: TimelineLane;
  state: Seen;
  since: number;
  cost: number | null;
}

/**
 * What the office saw each agent do, kept for eight days. It sees only while an office is open:
 * the time between is a gap in every lane, not a rest. `kept` is the file of an earlier run; its
 * agents are closed at its last mark, since nobody saw when they stopped.
 */
export function createTimelineLog(ports: TimelinePorts, kept: TimelineFile | null): TimelineLog {
  const who: TimelineFile["who"] = { ...kept?.who };
  let marks: Mark[] = kept?.marks.filter((mark) => mark.t >= ports.now() - TIMELINE_KEEP_MS) ?? [];
  const states = new Map<string, Seen>();
  const costs = new Map<string, number>();
  const calls = new Map<string, string>();
  for (const mark of marks) if (mark.s !== undefined) states.set(mark.a, mark.s);
  const last = marks.at(-1)?.t ?? 0;
  for (const [id, state] of states) if (state !== "off") marks.push({ t: last, a: id, s: "off" });
  states.clear();
  let pending: TimelineLine[] = [];

  function rewrite(): void {
    if (marks.length > TIMELINE_MARKS_MAX) marks = marks.slice(-TIMELINE_MARKS_MAX);
    const listed = new Set(marks.map((mark) => mark.a));
    for (const id of Object.keys(who)) if (!listed.has(id)) delete who[id];
    pending = [];
    ports.rewrite({ version: 1, who, marks });
  }
  // The kept file loses its old marks and gains the closing ones: written once, whole.
  if (kept !== null) rewrite();

  function add(entry: Mark): void {
    marks.push(entry);
    pending.push(entry);
  }

  function saved(): void {
    if (marks.length > TIMELINE_MARKS_MAX + TIMELINE_MARKS_SLACK) {
      rewrite();
      return;
    }
    ports.append(pending);
    pending = [];
  }

  function seeAgent(agent: OfficeAgent, team: string, t: number): boolean {
    let changed = false;
    const state = seenOf(agent);
    if ((states.get(agent.id) ?? "off") !== state) {
      states.set(agent.id, state);
      add({ t, a: agent.id, s: state });
      changed = true;
    }
    if (state !== "off" || changed) {
      const now = { name: agentTitle(agent), team, provider: agent.provider };
      const before = who[agent.id];
      if (
        before === undefined ||
        before.name !== now.name ||
        before.team !== now.team ||
        before.provider !== now.provider
      ) {
        who[agent.id] = now;
        // Goes out with the next mark: a new name alone is not worth a write.
        pending.push({ w: agent.id, ...now });
      }
    }
    const cost = agent.costUsd;
    if (cost === undefined) return changed;
    const before = costs.get(agent.id);
    costs.set(agent.id, cost);
    // The first reading is what the agent cost before the office looked: not this range's.
    if (before === undefined || cost <= before) return changed;
    add({ t, a: agent.id, c: cost - before });
    return true;
  }

  function stopWatching(ids: Iterable<string>, t: number): boolean {
    let changed = false;
    for (const id of ids) {
      if ((states.get(id) ?? "off") === "off") continue;
      states.set(id, "off");
      calls.delete(id);
      add({ t, a: id, s: "off" });
      changed = true;
    }
    return changed;
  }

  return {
    view(view) {
      const t = ports.now();
      if (view === null) {
        if (stopWatching([...states.keys()], t)) saved();
        costs.clear();
        return;
      }
      const teams = new Map(view.workspaces.map((workspace) => [workspace.id, workspace.name]));
      let changed = false;
      const here = new Set<string>();
      for (const agent of view.agents) {
        here.add(agent.id);
        const team = (agent.workspaceId && teams.get(agent.workspaceId)) || LOBBY;
        if (seeAgent(agent, team, t)) changed = true;
      }
      const gone = [...states.keys()].filter((id) => !here.has(id));
      if (stopWatching(gone, t)) changed = true;
      if (changed) saved();
    },
    steps(doing) {
      const t = ports.now();
      let changed = false;
      for (const [id, step] of Object.entries(doing)) {
        if (calls.get(id) === step.key || states.get(id) === undefined) continue;
        calls.set(id, step.key);
        add({ t, a: id, k: step.kind });
        changed = true;
      }
      if (changed) saved();
    },
    read(from, to) {
      const end = Math.min(to, ports.now());
      const building = new Map<string, Building>();
      const close = (lane: Building, at: number) => {
        const start = Math.max(lane.since, from);
        const stop = Math.min(at, end);
        if (lane.state !== "off" && stop > start) {
          lane.lane.spans.push({ from: start, to: stop, state: lane.state as TimelineState });
        }
      };
      for (const mark of marks) {
        if (mark.t > end) break;
        let lane = building.get(mark.a);
        if (lane === undefined) {
          const known = who[mark.a] ?? { name: mark.a, team: LOBBY, provider: "" };
          lane = {
            lane: {
              id: mark.a,
              ...known,
              spans: [],
              steps: [],
              edits: 0,
              commands: 0,
              costUsd: null,
            },
            state: "off",
            since: 0,
            cost: null,
          };
          building.set(mark.a, lane);
        }
        if (mark.s !== undefined) {
          close(lane, mark.t);
          lane.state = mark.s;
          lane.since = mark.t;
        }
        if (mark.t < from) continue;
        if (mark.k !== undefined) countStep(lane.lane, mark.t, mark.k);
        if (mark.c !== undefined) lane.lane.costUsd = (lane.lane.costUsd ?? 0) + mark.c;
      }
      const lanes: TimelineLane[] = [];
      for (const lane of building.values()) {
        close(lane, end);
        if (lane.lane.spans.length === 0) continue;
        lane.lane.steps = lane.lane.steps.slice(-LANE_STEPS_MAX);
        lanes.push(lane.lane);
      }
      lanes.sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
      return { from, to: end, lanes };
    },
  };
}

function countStep(lane: TimelineLane, at: number, kind: ActivityKind): void {
  lane.steps.push({ at, kind });
  if (isEdit(kind)) lane.edits += 1;
  if (isCommand(kind)) lane.commands += 1;
}
