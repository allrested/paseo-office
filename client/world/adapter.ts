import type { PlanUsage } from "../../shared/plan-usage.js";
import type { CacheClock } from "../../shared/settings.js";
import { shirtColor } from "../../shared/appearance.js";
import type { OfficeBrand } from "../brand.js";
import {
  agentTitle,
  attentionReason,
  waitingOnText,
  type OfficeModel,
  type OfficeRow,
} from "../../shared/model.js";
import type {
  WorkspacePullRequest,
  WeatherScene,
  ActivityKind,
  ActivityStep,
  Machine,
  OfficeAgent,
  TestResult,
} from "../../shared/contracts.js";
import { machineTitle, memoryPercent, memoryTone } from "../../shared/machine-text.js";
import { shortHolder } from "../../shared/duties.js";
import { USER_AUTHOR } from "../../shared/names.js";
import { dutyRowTitle } from "../duty-text.js";
import { relativeLuminance } from "../luminance.js";
import type {
  WorldWeather,
  WorldBoardRow,
  WorldBrand,
  WorldColors,
  WorldDuty,
  WorldEvent,
  WorldEventType,
  WorldMachine,
  WorldLimit,
  WorldSession,
} from "./world-api.js";

/** Desks of each floor plan of the vendored scene. */
export const PLAN_DESKS = { pro: 12, cozy: 9, hq: 44 } as const;
export type WorldPlan = keyof typeof PLAN_DESKS;

export interface WorldPeople {
  sessions: WorldSession[];
  /** Agents without a desk on this floor. */
  overflow: number;
  /** The tool call each seated agent is at, for the ones at one. */
  steps: ReadonlyMap<string, ActivityStep>;
}

/** An agent that waits on sub-agents is at work: it keeps its desk, and no game picks it. */
function statusOf(agent: OfficeAgent, waitingOn: number): WorldSession["status"] {
  if (agent.permissions.length > 0) return "wait";
  if (agent.status === "running" || agent.status === "initializing" || waitingOn > 0) return "work";
  return "rest";
}

function markOf(provider: string): WorldSession["agent"] {
  const id = provider.toLowerCase();
  if (id.includes("codex")) return "codex";
  if (id.includes("gemini") || id.includes("antigravity")) return "gemini";
  return "claude";
}

/** Who needs the user comes first when the desks run out, then who works, then who rests. */
function rank(session: WorldSession): number {
  if (session.status === "wait" || session.stuck) return 0;
  return session.status === "work" ? 1 : 2;
}

/** A sub-agent's id in the scene: its call's id is only unique within its parent's session. */
function subId(parentId: string, callId: string): string {
  return `${parentId}:${callId}`;
}

const NOBODY_OUT: ReadonlyMap<string, string> = new Map();
const CACHE_MS = { "5m": 5 * 60_000, "1h": 60 * 60_000 } as const;

/** The plans as the scene reads them: a name and how much of each limit is used. */
export function worldLimits(usage: readonly PlanUsage[]): WorldLimit[] {
  return usage.map((provider) => ({
    name: provider.name,
    windows: provider.windows.map((window) => ({
      pct: window.usedPct,
      resetsAt: window.resetsAt ?? 0,
    })),
  }));
}

/**
 * A resting person's prompt cache, guessed: warm for the setting's time after the turn's end.
 * Nothing for whoever is not resting, when the setting is off, or when the host did not say when
 * the turn ended.
 */
function cacheOf(
  agent: OfficeAgent,
  resting: boolean,
  idle: number,
  cacheClock: CacheClock,
): Pick<WorldSession, "cache"> {
  if (!resting || cacheClock === "off" || !Number.isFinite(idle)) return {};
  return {
    cache: {
      until: idle + CACHE_MS[cacheClock],
      ttl: cacheClock,
      tokens: agent.context?.usedTokens ?? 0,
      guessed: true,
    },
  };
}

function toSession(
  row: OfficeRow,
  team: string,
  checks: WorkspacePullRequest["checks"] | undefined,
  born: Readonly<Record<string, string>>,
  out: ReadonlyMap<string, string>,
  cacheClock: CacheClock,
): WorldSession {
  const { agent } = row;
  const title = agentTitle(agent);
  const status = statusOf(agent, row.waitingOn);
  const stuck = attentionReason(agent) === "error";
  const idle = agent.idleSince === undefined ? Number.NaN : Date.parse(agent.idleSince);
  return {
    id: agent.id,
    name: title,
    ...(agent.appearance
      ? { appearance: agent.appearance, shirt: shirtColor(agent.appearance) }
      : {}),
    title,
    dir: team,
    git: {
      repo: team,
      ...(checks === "failure" ? { ci: "red" as const } : {}),
      ...(checks === "success" ? { ci: "green" as const } : {}),
      ...(Object.hasOwn(born, team) ? { born: born[team] } : {}),
    },
    status,
    agent: markOf(agent.provider),
    ...(out.has(agent.provider) ? { acct: out.get(agent.provider) } : {}),
    lastPrompt: "",
    ...(status === "rest" && !stuck && Number.isFinite(idle)
      ? { doneAt: idle, idleSince: agent.idleSince }
      : {}),
    stuck,
    ...cacheOf(agent, status === "rest" && !stuck, idle, cacheClock),
    ...(row.waitingOn > 0 ? { waitingOn: row.waitingOn } : {}),
    subs: (row.subagents ?? []).map((sub) => ({ id: subId(agent.id, sub.id), type: sub.type })),
    ...(agent.context === undefined && agent.costUsd === undefined
      ? {}
      : {
          usage: {
            ctx: agent.context?.usedTokens ?? 0,
            ctxMax: agent.context?.maxTokens ?? 0,
            ...(agent.costUsd === undefined ? {} : { cost: agent.costUsd }),
          },
        }),
  };
}

/**
 * The office's agents as people on a floor with this many desks: a room is a team, seated
 * together. Who does not fit stays in the list view.
 */
export function worldPeople(
  model: OfficeModel,
  desks: number,
  born: Readonly<Record<string, string>> = {},
  out: ReadonlyMap<string, string> = NOBODY_OUT,
  cacheClock: CacheClock = "off",
): WorldPeople {
  const rows = model.rooms.flatMap((room) =>
    room.rows.map((row) => ({
      row,
      // A roster teammate sits with its team, whatever its workspace; anyone else with the room's.
      team: row.agent.team ?? room.name,
      checks: room.workspace?.pullRequest?.checks,
    })),
  );
  const all = rows.map(({ row, team, checks }) =>
    toSession(row, team, checks, born, out, cacheClock),
  );
  const order = new Map(all.map((session, index) => [session.id, index]));
  const seated =
    all.length <= desks
      ? all
      : [...all]
          .sort((a, b) => rank(a) - rank(b) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
          .slice(0, desks)
          .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const atDesk = new Set(seated.map((session) => session.id));
  const steps = new Map<string, ActivityStep>();
  for (const { row } of rows) {
    if (row.step !== null && atDesk.has(row.agent.id)) steps.set(row.agent.id, row.step);
  }
  return { sessions: seated, overflow: all.length - seated.length, steps };
}

/**
 * The people with when this view saw each resting one come to rest (`rests`, by agent id, as the
 * 2D office's `restsAfter` keeps it), where that is earlier than the host's time: a change on the
 * host after the turn ended, a new title say, moves the host's.
 */
export function withRestTimes(
  sessions: readonly WorldSession[],
  rests: ReadonlyMap<string, number>,
): WorldSession[] {
  return sessions.map((session) => {
    const seen = rests.get(session.id);
    if (seen === undefined || (session.doneAt ?? Infinity) <= seen) return session;
    return { ...session, doneAt: seen };
  });
}

function boardState(session: WorldSession): WorldBoardRow["state"] {
  if (session.status === "wait") return "wait";
  return session.status === "work" ? "doing" : "done";
}

/** What a person is at, in words: the board's line and a desk's name for a screen reader. */
export function boardText(session: WorldSession, activity: string | null): string {
  if (session.stuck) return "Stopped on an error";
  if (session.status === "wait") return "Waiting for your answer";
  if (session.waitingOn !== undefined) return waitingOnText(session.waitingOn);
  if (session.status === "work") return activity ?? "Working";
  return "Resting";
}

/** The whiteboard's rows: the people at a desk, who needs the user first. */
export function worldBoardRows(
  model: OfficeModel,
  sessions: readonly WorldSession[],
): WorldBoardRow[] {
  const activity = new Map(
    model.rooms.flatMap((room) => room.rows.map((row) => [row.agent.id, row.activity] as const)),
  );
  return [...sessions]
    .sort((a, b) => rank(a) - rank(b))
    .map((session) => ({
      id: session.id,
      name: session.name,
      text: boardText(session, activity.get(session.id) ?? null),
      state: boardState(session),
    }));
}

/** A kind of work, as the scene names it: each has a place the person walks to. */
const STEP_EVENT: Readonly<Record<ActivityKind, WorldEventType>> = {
  read: "read",
  search: "grep",
  skill: "skill",
  edit: "edit",
  write: "write",
  command: "bash",
  web: "web",
  tool: "mcp",
  subagent: "agent",
  plan: "plan",
  test: "test",
  commit: "commit",
  push: "push",
  // A deploy that starts is a command at the server room's console; `endOf` tells its end.
  deploy: "bash",
};

/** A step whose end is told as well as its start. */
type Run = "test" | "deploy";

function runOf(kind: ActivityKind): Run | null {
  return kind === "test" || kind === "deploy" ? kind : null;
}

type StepEvent = Pick<WorldEvent, "type" | "of" | "label">;

/**
 * How a run that ended is told. A test run's result goes on the test board. A deploy that
 * succeeded launches the rocket, and one that failed is a failure.
 */
function endOf(run: Run, result: TestResult): StepEvent {
  if (run === "test") return { type: result === "passed" ? "testok" : "testfail" };
  return result === "passed" ? { type: "deploy" } : { type: "fail", of: "deploy" };
}

/** What the scene was last told about a person. */
interface Told {
  status: WorldSession["status"];
  stuck: boolean;
  /** How many sub-agents it waited on, when at work only for that: its own turn had ended. */
  waitingOn: number | undefined;
  /** The key of the step the person was sent to; null when at none. */
  step: string | null;
  /** That step is a test run or a deploy, and the scene has not been told how it ended. */
  running: Run | null;
  /** How full the context was, 0 to 1; null when unknown. */
  full: number | null;
  /** The sub-agents the scene had been told of. */
  subs?: readonly string[];
}
export type WorldMemory = ReadonlyMap<string, Told>;

export interface WorldChanges {
  events: WorldEvent[];
  /** What the scene knows once it has the events. */
  memory: WorldMemory;
}

/**
 * A sub-agent that came since the scene was last told walks in, and one that is gone leaves.
 * Someone seen for the first time gets neither: the scene seats who is already there (`subs`).
 */
function subEvents(session: WorldSession, was: Told | undefined): WorldEvent[] {
  if (was === undefined) return [];
  const told = was.subs ?? [];
  const here = new Set(session.subs.map((sub) => sub.id));
  const starts = session.subs
    .filter((sub) => !told.includes(sub.id))
    .map(
      (sub): WorldEvent => ({
        sess: session.id,
        type: "substart",
        agent: sub.id,
        label: sub.type,
      }),
    );
  const stops = told
    .filter((id) => !here.has(id))
    .map((id): WorldEvent => ({ sess: session.id, type: "substop", agent: id }));
  return [...starts, ...stops];
}

/**
 * A turn that starts, one that ends, a new error; none for someone seen for the first time. An
 * agent that turns busy because a sub-agent started gets no prompt: nobody sent it one. Its own
 * turn starts when it runs again, from a rest or from that wait, and ends when it rests, which
 * for a waiting agent is when its last sub-agent ended.
 */
function turnEvent(session: WorldSession, was: Told | undefined): WorldEventType | null {
  if (was === undefined) return null;
  if (session.stuck && !was.stuck) return "fail";
  const runs = session.status === "work" && session.waitingOn === undefined;
  if (runs && (was.status === "rest" || was.waitingOn !== undefined)) return "prompt";
  return was.status !== "rest" && session.status === "rest" && !session.stuck ? "stop" : null;
}

/** How full a person's context is, 0 to 1; null when its provider has not said. */
export function fullness(session: Pick<WorldSession, "usage">): number | null {
  const { usage } = session;
  return usage === undefined || usage.ctxMax <= 0 ? null : Math.min(1, usage.ctx / usage.ctxMax);
}

/** Less than half of what it was, and at least a tenth of the window gone: no turn does that. */
export function tidied(before: number | null, now: number | null): boolean {
  return before !== null && now !== null && now < before / 2 && before - now >= 0.1;
}

function stepEvents(
  session: WorldSession,
  step: ActivityStep | undefined,
  was: Told | undefined,
): { events: StepEvent[]; step: string | null; running: Run | null } {
  const events: StepEvent[] = [];
  let told = was?.step ?? null;
  let running = was?.running ?? null;
  if (running !== null && step?.key !== told) {
    // The run's end was never seen: a test run's lamp on the test board goes out, and a deploy
    // ends without a word.
    if (running === "test") events.push({ type: "testend" });
    running = null;
  }
  if (step === undefined) return { events, step: null, running };
  if (running !== null) {
    if (step.result !== undefined) {
      events.push(endOf(running, step.result));
      running = null;
    }
  } else if (session.status === "work" && step.key !== told) {
    told = step.key;
    const run = runOf(step.kind);
    if (run !== null && step.result !== undefined) {
      events.push(endOf(run, step.result));
    } else {
      running = run;
      events.push({
        type: STEP_EVENT[step.kind],
        ...(step.label === undefined ? {} : { label: step.label }),
      });
    }
  }
  return { events, step: told, running };
}

/**
 * What changed since the scene was last told, as things its people do. A turn that starts is a
 * prompt carried to the desk, one that ends is reported and followed by a rest, an error is a
 * failure. An agent whose turn has ended while agents it started are still at work is sent to
 * wait at its desk, once, and its turn is reported when the last of them ends. A new tool call
 * of an agent at work sends the person to that work's place, and that
 * is said at once, so an office just opened shows what everyone is at. A call seen while its
 * agent waits for the user is told once the agent works again: the approval is often for it.
 * A test run is told twice, when it starts and when it ends. A deploy too: it starts as a
 * command at the console, and ends as the rocket's launch or as a failure; one cancelled or never
 * seen to end is not told. A context that empties, by a compaction or by a new conversation, is
 * paper carried to the shredder.
 */
export function worldChanges(before: WorldMemory | null, people: WorldPeople): WorldChanges {
  const events: WorldEvent[] = [];
  const memory = new Map<string, Told>();
  for (const session of people.sessions) {
    const was = before?.get(session.id);
    const turn = turnEvent(session, was);
    if (turn !== null) events.push({ sess: session.id, type: turn });
    if (session.waitingOn !== undefined && session.waitingOn !== was?.waitingOn) {
      events.push({ sess: session.id, type: "subwait" });
    }
    const full = fullness(session);
    if (tidied(was?.full ?? null, full)) events.push({ sess: session.id, type: "compact" });
    for (const event of subEvents(session, was)) events.push(event);
    const steps = stepEvents(session, people.steps.get(session.id), was);
    for (const event of steps.events) events.push({ sess: session.id, ...event });
    memory.set(session.id, {
      status: session.status,
      stuck: session.stuck,
      waitingOn: session.waitingOn,
      step: steps.step,
      running: steps.running,
      full,
      subs: session.subs.map((sub) => sub.id),
    });
  }
  return { events, memory };
}

/**
 * The host's readings for the scene. An agent with a port open has a server box on its desk; one
 * that left something running has its box in the server room, port or not.
 */
export function worldMachine(machine: Machine | null): WorldMachine | null {
  if (machine === null) return null;
  const { memory } = machine;
  return {
    mem:
      memory === null
        ? null
        : {
            used: memory.usedBytes,
            total: memory.totalBytes,
            pressure: memoryTone(memoryPercent(machine)) === "danger" ? "critical" : "normal",
          },
    cpu: { percent: machine.cpuPercent ?? 0 },
    devServers: machine.agents
      .filter((agent) => agent.forgotten || agent.ports.length > 0)
      .map((agent) => ({
        owner: { alive: !agent.forgotten, sid: agent.agentId },
        label: machineTitle(agent),
        ports: [...agent.ports],
        cpu: 0,
      })),
  };
}

/** The line with a floor: nobody is in, or some have no desk on it; null otherwise. */
export function floorNote(agents: number, overflow: number, replayed = false): string | null {
  // A replay's bar says who was seen then: an empty floor is not a host without agents.
  if (agents === 0 && replayed) return null;
  if (agents === 0) return "No agents on this host yet. One that starts takes a desk here.";
  if (overflow <= 0) return null;
  const who = overflow === 1 ? "1 agent has" : `${overflow} agents have`;
  return `${who} no desk on this floor. The list shows everyone.`;
}

/** The team name of a room, as the scene knows it; null for a room that is not there. */
export function teamOfRoom(model: OfficeModel, roomId: string | null): string | null {
  if (roomId === null) return null;
  return model.rooms.find((room) => room.id === roomId)?.name ?? null;
}

export interface BoardChoice {
  /** The team whose chip was chosen; null for the whiteboard, which belongs to no team. */
  project: string | null;
  /** The workspace tab's room. */
  focusRoomId: string | null;
  selectedAgentId: string | null;
}

/**
 * The room whose board a tap in the scene opens. The scene has one whiteboard for every team, so
 * a tap on it opens the nearest room the surface knows: the tab's, the chosen agent's, or the
 * lobby, which the model puts first.
 */
export function boardRoom(model: OfficeModel, choice: BoardChoice): string | null {
  if (choice.project !== null) {
    return model.rooms.find((room) => room.name === choice.project)?.id ?? null;
  }
  const selected =
    choice.selectedAgentId === null ? undefined : model.roomOfAgent.get(choice.selectedAgentId);
  for (const id of [choice.focusRoomId, selected]) {
    if (id != null && model.rooms.some((room) => room.id === id)) return id;
  }
  return model.rooms[0]?.id ?? null;
}

/** A dark theme draws the office by night. */
export function isDarkTheme(colors: Pick<WorldColors, "surface0">): boolean {
  return relativeLuminance(colors.surface0) < 0.4;
}

/** The name on the lobby's sign of a host without a brand: the product's. */
const PRODUCT_NAME = "Paseo";

/** What the lobby's sign shows: the host's brand, or the product's name over the scene's mark. */
export function worldBrand(brand: OfficeBrand | null): WorldBrand {
  return {
    name: brand?.name ?? PRODUCT_NAME,
    logoUrl: brand?.logoUrl ?? null,
    ...(brand?.color ? { color: brand.color } : {}),
  };
}

/** What the scene is told of the weather: the host's scene, or none while the host has not said. */
export function worldWeather(scene: WeatherScene | undefined): WorldWeather {
  if (scene === undefined || scene.kind === "none") return { kind: "none" };
  if (scene.kind === "season") return { kind: "season" };
  return { kind: "reading", code: scene.code, temp: scene.temp, cloud: scene.cloud };
}

/** Who has a duty, as the pantry's board names them: the agent's title cut short. */
function dutyHolder(model: OfficeModel, claimedBy: string | undefined): WorldDuty["holder"] {
  if (claimedBy === undefined || claimedBy === USER_AUTHOR) return null;
  const agent = model.agents.get(claimedBy);
  const title = agent ? agentTitle(agent) : `Agent ${claimedBy.slice(0, 8)}`;
  return { id: claimedBy, name: shortHolder(title) };
}

/** The day's duties for the pantry's board: names, holders and states, never instructions. */
export function worldDuties(model: OfficeModel): WorldDuty[] {
  return model.duties.map((row) => ({
    id: row.post.id,
    name: dutyRowTitle(row),
    chore: row.duty?.chore ?? null,
    pretend: (row.duty?.instructions.trim() ?? "") === "",
    holder: dutyHolder(model, row.post.claimedBy),
    state: row.post.state ?? "open",
    owed: row.owed,
  }));
}
