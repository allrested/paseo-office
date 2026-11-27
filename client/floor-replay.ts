import type { OfficeAgent, OfficeSnapshot } from "../shared/contracts.js";
import type { ActivityStep } from "../shared/names.js";
import { doingAt, stateAt, type Timeline, type TimelineLane } from "../shared/timeline.js";

/** How long a tool call stays what a replayed agent is at: the reads are 5 s apart. */
const STEP_SHOWN_MS = 60_000;
/** The request a replayed agent that waited for the user is drawn with. */
const WAITED = { id: "replay", kind: "other" as const, title: "Waited for you" };

function stepAt(lane: TimelineLane, at: number): ActivityStep | null {
  let step: ActivityStep | null = null;
  for (const each of lane.steps) {
    if (each.at > at) break;
    if (at - each.at < STEP_SHOWN_MS) step = { kind: each.kind, key: `replay:${each.at}` };
  }
  return step;
}

/**
 * The office as the timeline saw it at `at`, for the floor to draw: who was there, and each at
 * work, waiting, resting or stopped, with the kind of thing it was at. An agent the office was
 * not watching then is not on the floor, and one that has since been archived cannot be drawn:
 * the timeline keeps its lane, the office no longer its agent. The boards, the chat and the rest
 * of the snapshot are today's.
 */
export function replayedOffice(
  state: OfficeSnapshot,
  timeline: Timeline,
  at: number,
): OfficeSnapshot {
  const lanes = new Map(timeline.lanes.map((lane) => [lane.id, lane]));
  const agents: OfficeAgent[] = [];
  const activity: Record<string, string> = {};
  const doing: Record<string, ActivityStep> = {};
  for (const agent of state.agents) {
    const lane = lanes.get(agent.id);
    const was = lane === undefined ? null : stateAt(lane, at);
    if (lane === undefined || was === null) continue;
    if (was === "work") {
      agents.push({ ...agent, status: "running", permissions: [] });
      activity[agent.id] = doingAt(lane, at);
      const step = stepAt(lane, at);
      if (step !== null) doing[agent.id] = step;
    } else if (was === "wait") {
      agents.push({ ...agent, status: "running", permissions: [WAITED] });
    } else {
      agents.push({ ...agent, status: was === "fail" ? "error" : "idle", permissions: [] });
    }
  }
  const { subagents: _live, ...rest } = state;
  return { ...rest, agents, activity, doing, checklists: {} };
}

/** What changes the floor between two moments of a replay: the same text, the same floor. */
export function replaySignature(state: OfficeSnapshot): string {
  return JSON.stringify([
    state.agents.map((agent) => [agent.id, agent.status, agent.permissions.length]),
    state.doing,
  ]);
}
