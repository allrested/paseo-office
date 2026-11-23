import type {
  ChatChange,
  ChatSnapshot,
  IncidentsState,
  WeatherState,
  Checklists,
  ChecklistCounts,
  DutyBoard,
  NotesState,
  OfficeAgent,
  OfficeEvent,
  OfficeSnapshot,
  OfficeWorkspace,
  Post,
  SubagentCalls,
  WakeState,
  WorkspaceScript,
} from "../shared/contracts.js";
import type { ActivityLines, ActivitySteps } from "./activity.js";
import { settleResets, sortWorkspaces } from "./directory.js";
import { errorMessage } from "./errors.js";
import type { Timers } from "./timers.js";
import {
  NO_ROSTER,
  ROSTER_MEMBER_KEY,
  ROSTER_TEAM_KEY,
  type Roster,
  type RosterMark,
} from "../shared/roster.js";
import { planRoster, rosterNames, type RosterWrite } from "./roster.js";
import { NEXT_KEY, NUMBER_KEY, officeNames, planNumbers } from "./subagent-names.js";

/** Directory updates come in bursts while agents stream; one event per window is enough. */
export const DIRECTORY_FLUSH_MS = 300;
/** A directory that ends on its own is reopened at most once per window. */
export const DIRECTORY_RESTART_MS = 5000;

export interface DirectoryView {
  /** Server-only workspace paths for repository history. */
  folders?: Readonly<Record<string, string>>;
  agents: readonly OfficeAgent[];
  workspaces: readonly OfficeWorkspace[];
}

export interface HubSubscriber {
  push(event: OfficeEvent): Promise<void>;
  signal: AbortSignal;
}

export interface HubPorts {
  /**
   * Starts the directory; calls onChange with the first view before it resolves. onEnd runs when
   * the directory stops on its own and will report no more changes.
   */
  openDirectory(
    onChange: (view: DirectoryView) => void,
    onEnd?: () => void,
  ): Promise<() => Promise<void>>;
  startActivity(
    running: () => readonly string[],
    onChange: (
      activity: ActivityLines,
      doing: ActivitySteps,
      checklists: Readonly<Checklists>,
      progress?: Readonly<ChecklistCounts>,
      subagents?: Readonly<SubagentCalls>,
    ) => void,
  ): () => void;
  timers: Timers;
  log(message: string): void;
  /** Stores data on an agent; the office keeps its sub-agent numbers there. */
  setAgentMetadata?(agentId: string, patch: Record<string, string | number>): Promise<void>;
  /** Stores the office's own data on a workspace: its roster team. */
  setWorkspaceMetadata?(workspaceId: string, patch: Record<string, string | number>): Promise<void>;
}

export interface Hub {
  /** Streams the office to one subscriber. Resolves when its signal aborts; rejects when the directory cannot start. */
  attach(subscriber: HubSubscriber): Promise<void>;
  setBoards(boards: Readonly<Record<string, readonly Post[]>>): void;
  setBoard(board: string, posts: readonly Post[]): void;
  removeBoard(board: string): void;
  setWake(wake: WakeState): void;
  /** The stand-up notes writer's state; the same state again sends nothing. */
  setNotes(notes: NotesState): void;
  /** The duty list and the duty board's day; the same again sends nothing. */
  setDuties(duties: DutyBoard): void;
  /** The open incidents and the trackers' state; the same state again sends nothing. */
  setIncidents(incidents: IncidentsState): void;
  /** A changed sky or service status is sent to every subscriber. */
  setBrand(brand: OfficeSnapshot["brand"]): void;
  /** The roster names follow from now on; what is open is planned and named again at once. */
  setRoster(roster: Roster): void;
  setWeather(weather: WeatherState): void;
  /**
   * The conversation each snapshot carries from now on; null removes it. Every subscriber gets a
   * fresh snapshot.
   */
  setChat(source: (() => ChatSnapshot) | null): void;
  /**
   * One change of the conversation, sent as a `chat` event to subscribers that have their
   * snapshot.
   */
  chatChange(change: ChatChange): void;
  /**
   * Calls `listener` with each view the directory reports, and with null when it stops; at once
   * with the current view when a directory is open. Returns what ends it.
   */
  watch(listener: (view: DirectoryView | null) => void): () => void;
  /**
   * The office now, for the stand-up report. While an office is open it is what its subscribers
   * see; while none is, a directory is opened for this read alone and closed again, so the read
   * has the agents and rooms but no "doing now" lines.
   */
  read(): Promise<OfficeSnapshot>;
  /**
   * The office reset this agent's conversation: its context reads empty from now until its
   * provider says another number than the one it says now.
   */
  contextReset(agentId: string): void;
  /**
   * A workspace's script as the directory last reported it; null when it has none by that name,
   * and while no office is open, when there is no directory.
   */
  script(workspaceId: string, name: string): WorkspaceScript | null;
  /** The ids of the workspaces the directory last reported; none while no office is open. */
  workspaceIds(): string[];
  stop(): Promise<void>;
}

const EMPTY_VIEW: DirectoryView = { agents: [], workspaces: [] };

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export function createHub(ports: HubPorts): Hub {
  const subscribers = new Set<HubSubscriber>();
  // Subscribers whose snapshot went out; changes reach only them, so a snapshot comes first.
  const ready = new WeakSet<HubSubscriber>();
  let view = EMPTY_VIEW;
  // The directory's own view, and the context each reset agent had; see settleResets.
  let reported = EMPTY_VIEW;
  let resets: ReadonlyMap<string, number> = new Map();
  let sentAgents = "";
  let sentWorkspaces = "";
  let activity: ActivityLines = {};
  let doing: ActivitySteps = {};
  // Kept after an agent stops, as the poller reads only running agents; dropped when it leaves.
  let checklists: Checklists = {};
  let checklistProgress: ChecklistCounts = {};
  /** The provider's own sub-agents each running agent has at work, as the last round read them. */
  let subagents: Readonly<SubagentCalls> = {};
  let boards: Record<string, readonly Post[]> = {};
  let wake: WakeState = { paused: false, queued: {} };
  let notes: NotesState | null = null;
  let sentNotes = "";
  let duties: DutyBoard | null = null;
  let sentDuties = "";
  let incidents: IncidentsState | null = null;
  let brand: OfficeSnapshot["brand"];
  let weather: WeatherState | null = null;
  let sentWeather = "";
  let sentIncidents = "";
  let chatSource: (() => ChatSnapshot) | null = null;
  const watchers = new Set<(view: DirectoryView | null) => void>();
  let starting: Promise<void> | null = null;
  let stopDirectory: (() => Promise<void>) | null = null;
  let stopActivity: (() => void) | null = null;
  let cancelFlush: (() => void) | null = null;
  // Each start and each idle moves on, so an old directory's end or a stale start is ignored.
  let generation = 0;
  let cancelCooldown: (() => void) | null = null;
  let restartQueued: number | null = null;

  function snapshot(): OfficeSnapshot {
    const copy: Record<string, Post[]> = {};
    for (const [board, posts] of Object.entries(boards)) copy[board] = [...posts];
    return {
      agents: [...view.agents],
      workspaces: [...view.workspaces],
      activity: { ...activity },
      doing: { ...doing },
      ...(Object.keys(subagents).length ? { subagents: { ...subagents } } : {}),
      checklists: { ...checklists },
      ...(Object.keys(checklistProgress).length
        ? { checklistProgress: { ...checklistProgress } }
        : {}),
      boards: copy,
      ...(brand ? { brand } : {}),
      wake: { paused: wake.paused, queued: { ...wake.queued } },
      ...(notes === null ? {} : { notes: { ...notes } }),
      ...(weather === null ? {} : { weather }),
      ...(incidents === null ? {} : { incidents: { ...incidents } }),
      ...(chatSource === null ? {} : { chat: chatSource() }),
      ...(duties === null ? {} : { duties: { ...duties, duties: [...duties.duties] } }),
    };
  }

  function broadcast(event: OfficeEvent): void {
    for (const subscriber of subscribers) {
      if (subscriber.signal.aborted || !ready.has(subscriber)) continue;
      subscriber
        .push(event)
        .catch((error: unknown) => ports.log(`[office] push failed: ${errorMessage(error)}`));
    }
  }

  function tell(
    next: DirectoryView | null,
    listeners: Iterable<(view: DirectoryView | null) => void> = watchers,
  ): void {
    for (const listener of listeners) {
      try {
        listener(next);
      } catch (error) {
        ports.log(`[office] chat watcher failed: ${errorMessage(error)}`);
      }
    }
  }

  function flushDirectory(): void {
    cancelFlush = null;
    const agents = JSON.stringify(view.agents);
    if (agents !== sentAgents) {
      sentAgents = agents;
      broadcast({ type: "agents", agents: [...view.agents] });
    }
    const workspaces = JSON.stringify(view.workspaces);
    if (workspaces !== sentWorkspaces) {
      sentWorkspaces = workspaces;
      broadcast({ type: "workspaces", workspaces: [...view.workspaces] });
    }
  }

  // Numbers sent and not yet reported back, by agent. They are planned as if stored, so a
  // number in flight is never handed out again, whatever order the echoes come back in.
  const pendingNumbers = new Map<string, Record<string, number>>();

  function withPending(agents: readonly OfficeAgent[]): OfficeAgent[] {
    return agents.map((agent) => {
      const patch = pendingNumbers.get(agent.id);
      if (patch === undefined) return agent;
      const number = patch[NUMBER_KEY];
      const next = patch[NEXT_KEY];
      if (
        (number === undefined || agent.number === number) &&
        (next === undefined || agent.next === next)
      ) {
        pendingNumbers.delete(agent.id);
        return agent;
      }
      return {
        ...agent,
        ...(number === undefined ? {} : { number }),
        ...(next === undefined ? {} : { next }),
      };
    });
  }

  function writeNumbers(agents: readonly OfficeAgent[]): void {
    const write = ports.setAgentMetadata;
    if (write === undefined) return;
    const send = (agentId: string, patch: Record<string, number>): Promise<boolean> =>
      write(agentId, patch).then(
        () => true,
        (error: unknown) => {
          pendingNumbers.delete(agentId);
          ports.log(`[office] subagent number failed: ${errorMessage(error)}`);
          return false;
        },
      );
    // A parent's next is stored before its sub-agents' numbers go out (see planNumbers).
    let parentStored: Promise<boolean> = Promise.resolve(true);
    for (const { agentId, patch } of planNumbers(withPending(agents))) {
      pendingNumbers.set(agentId, { ...pendingNumbers.get(agentId), ...patch });
      if (NEXT_KEY in patch) {
        parentStored = send(agentId, patch);
        continue;
      }
      void parentStored.then((stored) => {
        if (stored) return send(agentId, patch);
        pendingNumbers.delete(agentId);
        return false;
      });
    }
  }

  let roster: Roster = NO_ROSTER;
  // Marks sent and not yet reported back, by `workspace:<id>` or `agent:<id>`. They are planned
  // as if stored, so a team or teammate in flight is never handed out twice; names come from
  // what the directory reports, so none shows before its mark is stored.
  const pendingRoster = new Map<string, RosterMark>();

  function withPendingRoster<Entry extends { id: string; roster?: RosterMark }>(
    kind: RosterWrite["kind"],
    entries: readonly Entry[],
  ): Entry[] {
    return entries.map((entry) => {
      const key = `${kind}:${entry.id}`;
      const mark = pendingRoster.get(key);
      if (mark === undefined) return entry;
      if (entry.roster === mark) {
        pendingRoster.delete(key);
        return entry;
      }
      return { ...entry, roster: mark };
    });
  }

  function writeRoster(next: DirectoryView): void {
    const toWorkspace = ports.setWorkspaceMetadata;
    const toAgent = ports.setAgentMetadata;
    if (toWorkspace === undefined || toAgent === undefined) return;
    const planned = planRoster(
      roster,
      withPendingRoster("workspace", next.workspaces),
      withPendingRoster("agent", next.agents),
    );
    for (const { kind, id, mark } of planned) {
      const key = `${kind}:${id}`;
      pendingRoster.set(key, mark);
      const sent =
        kind === "workspace"
          ? toWorkspace(id, { [ROSTER_TEAM_KEY]: mark })
          : toAgent(id, { [ROSTER_MEMBER_KEY]: mark });
      sent.catch((error: unknown) => {
        // Planned again at the next change.
        pendingRoster.delete(key);
        ports.log(`[office] roster mark failed: ${errorMessage(error)}`);
      });
    }
  }

  /** The workspaces under their roster team's name, where the owner typed none. */
  function teamed(
    workspaces: readonly OfficeWorkspace[],
    teams: ReadonlyMap<string, string>,
  ): readonly OfficeWorkspace[] {
    if (teams.size === 0) return workspaces;
    return sortWorkspaces(
      workspaces.map((workspace) => {
        const team = teams.get(workspace.id);
        // A workspaceName says the owner typed a team name: it stays.
        if (team === undefined || workspace.workspaceName !== undefined) return workspace;
        return { ...workspace, name: team, workspaceName: workspace.name };
      }),
    );
  }

  function named(
    agents: readonly OfficeAgent[],
    given: ReadonlyMap<string, string>,
  ): OfficeAgent[] {
    const names = officeNames(agents, given);
    return agents.map((agent) => {
      const name = names.get(agent.id);
      return name === undefined ? agent : { ...agent, name };
    });
  }

  function activityEvent(): OfficeEvent {
    return {
      type: "activity",
      activity: { ...activity },
      doing: { ...doing },
      ...(Object.keys(subagents).length ? { subagents: { ...subagents } } : {}),
      checklists: { ...checklists },
      ...(Object.keys(checklistProgress).length
        ? { checklistProgress: { ...checklistProgress } }
        : {}),
    };
  }

  function onDirectory(next: DirectoryView): void {
    reported = next;
    const listed = new Set(next.agents.map((agent) => agent.id));
    const kept = Object.entries(checklists).filter(([agentId]) => listed.has(agentId));
    const keptProgress = Object.entries(checklistProgress).filter(([id]) => listed.has(id));
    if (
      kept.length < Object.keys(checklists).length ||
      keptProgress.length < Object.keys(checklistProgress).length
    ) {
      checklistProgress = Object.fromEntries(keptProgress);
      checklists = Object.fromEntries(kept);
      // An agent that left the list takes its checklist with it now, not at the next poll round.
      if (stopDirectory !== null) broadcast(activityEvent());
    }
    writeNumbers(next.agents);
    writeRoster(next);
    const settled = settleResets(next.agents, resets);
    resets = settled.resets;
    const names = rosterNames(roster, next.workspaces, next.agents);
    view = {
      agents: named(resets.size === 0 ? next.agents : settled.agents, names.members),
      workspaces: teamed(next.workspaces, names.teams),
      folders: next.folders,
    };
    tell(view);
    // Until the start finished, the first snapshot carries the view.
    if (stopDirectory === null || cancelFlush !== null) return;
    cancelFlush = ports.timers.setTimeout(() => {
      try {
        flushDirectory();
      } catch (error) {
        ports.log(`[office] directory flush failed: ${errorMessage(error)}`);
      }
    }, DIRECTORY_FLUSH_MS);
  }

  /**
   * Each report replaces the checklists of the agents it names; one reported empty goes. An agent
   * that left the list while the round read it stays gone.
   */
  function onActivity(
    next: ActivityLines,
    steps: ActivitySteps,
    report: Readonly<Checklists>,
    progress: Readonly<ChecklistCounts> = {},
    working: Readonly<SubagentCalls> = {},
  ): void {
    activity = next;
    doing = steps;
    subagents = working;
    const listed = new Set(view.agents.map((agent) => agent.id));
    const fresh = Object.entries(report).filter(([agentId]) => listed.has(agentId));
    const merged = Object.entries({ ...checklists, ...Object.fromEntries(fresh) });
    checklists = Object.fromEntries(merged.filter(([, list]) => list.length > 0));
    for (const [id, count] of Object.entries(progress)) {
      if (!listed.has(id)) continue;
      if (count.total > 0) checklistProgress[id] = count;
      else delete checklistProgress[id];
    }
    broadcast(activityEvent());
  }

  function running(): readonly string[] {
    return view.agents.filter((agent) => agent.status === "running").map((agent) => agent.id);
  }

  async function start(): Promise<void> {
    generation += 1;
    const mine = generation;
    const stop = await ports.openDirectory(onDirectory, () => onDirectoryEnd(mine));
    if (subscribers.size === 0 || mine !== generation) {
      view = EMPTY_VIEW;
      reported = EMPTY_VIEW;
      tell(null);
      try {
        await stop();
      } catch (error) {
        // Whoever joined this start opens a fresh directory; a failed close is not theirs to see.
        ports.log(`[office] directory stop failed: ${errorMessage(error)}`);
      }
      return;
    }
    stopDirectory = stop;
    sentAgents = JSON.stringify(view.agents);
    sentWorkspaces = JSON.stringify(view.workspaces);
    stopActivity = ports.startActivity(running, onActivity);
    // Subscribers that already had a snapshot saw an older directory; attaches still waiting push their own.
    broadcast({ type: "snapshot", state: snapshot() });
  }

  async function ensureStarted(): Promise<void> {
    // A start that found nobody waiting closes its directory; whoever arrived meanwhile starts again.
    while (stopDirectory === null && subscribers.size > 0) {
      starting ??= start().finally(() => {
        starting = null;
      });
      await starting;
    }
  }

  async function restart(): Promise<void> {
    await idle();
    if (subscribers.size === 0) return;
    try {
      await ensureStarted();
    } catch (error) {
      queueRestart();
      throw error;
    }
  }

  /**
   * Keeps one rule: while anyone is attached and no directory runs, a start is in flight or a
   * restart timer is pending. Restarts stay at least one window apart.
   */
  function queueRestart(): void {
    if (subscribers.size === 0 || stopDirectory !== null || starting !== null) return;
    restartQueued = generation;
    cancelCooldown ??= ports.timers.setTimeout(onCooldownEnd, DIRECTORY_RESTART_MS);
  }

  function runRestart(): void {
    restartQueued = null;
    cancelCooldown = ports.timers.setTimeout(onCooldownEnd, DIRECTORY_RESTART_MS);
    restart().catch((error: unknown) =>
      ports.log(`[office] directory restart failed: ${errorMessage(error)}`),
    );
  }

  function onCooldownEnd(): void {
    cancelCooldown = null;
    try {
      if (restartQueued === generation && subscribers.size > 0) runRestart();
      else restartQueued = null;
    } catch (error) {
      ports.log(`[office] directory restart failed: ${errorMessage(error)}`);
    }
  }

  function onDirectoryEnd(of: number): void {
    if (of !== generation) return;
    ports.log("[office] directory ended; restarting it");
    if (cancelCooldown === null) runRestart();
    else restartQueued = of;
  }

  async function idle(): Promise<void> {
    generation += 1;
    cancelFlush?.();
    cancelFlush = null;
    stopActivity?.();
    stopActivity = null;
    activity = {};
    doing = {};
    checklists = {};
    checklistProgress = {};
    subagents = {};
    const stop = stopDirectory;
    stopDirectory = null;
    view = EMPTY_VIEW;
    reported = EMPTY_VIEW;
    pendingNumbers.clear();
    tell(null);
    if (stop === null) return;
    try {
      await stop();
    } catch (error) {
      ports.log(`[office] directory stop failed: ${errorMessage(error)}`);
    }
  }

  return {
    async attach(subscriber) {
      if (subscriber.signal.aborted) return;
      subscribers.add(subscriber);
      subscriber.signal.addEventListener(
        "abort",
        () => {
          subscribers.delete(subscriber);
          if (subscribers.size === 0) {
            idle().catch((error: unknown) =>
              ports.log(`[office] idle failed: ${errorMessage(error)}`),
            );
          }
        },
        { once: true },
      );
      try {
        await ensureStarted();
      } catch (error) {
        subscribers.delete(subscriber);
        ports.log(`[office] unable to start: ${errorMessage(error)}`);
        queueRestart();
        throw error;
      }
      if (subscriber.signal.aborted) return;
      ready.add(subscriber);
      await subscriber.push({ type: "snapshot", state: snapshot() });
      await waitForAbort(subscriber.signal);
    },
    setBoards(next) {
      boards = { ...next };
      broadcast({ type: "snapshot", state: snapshot() });
    },
    setBoard(board, posts) {
      boards = { ...boards, [board]: [...posts] };
      broadcast({ type: "board", board, posts: [...posts] });
    },
    removeBoard(board) {
      if (!Object.hasOwn(boards, board)) return;
      boards = Object.fromEntries(Object.entries(boards).filter(([key]) => key !== board));
      broadcast({ type: "board-removed", board });
    },
    setWake(next) {
      wake = { paused: next.paused, queued: { ...next.queued } };
      broadcast({ type: "wake", wake: { paused: wake.paused, queued: { ...wake.queued } } });
    },
    setNotes(next) {
      const text = JSON.stringify(next);
      if (text === sentNotes) return;
      sentNotes = text;
      notes = { ...next };
      broadcast({ type: "snapshot", state: snapshot() });
    },
    setDuties(next) {
      const text = JSON.stringify(next);
      if (text === sentDuties) return;
      sentDuties = text;
      duties = { ...next, duties: [...next.duties] };
      broadcast({ type: "snapshot", state: snapshot() });
    },
    setBrand(next) {
      if (JSON.stringify(brand) === JSON.stringify(next)) return;
      brand = next;
      broadcast({ type: "snapshot", state: snapshot() });
    },
    setRoster(next) {
      if (JSON.stringify(roster) === JSON.stringify(next)) return;
      roster = next;
      // What is open is planned and named again. A closed office is planned when it next opens:
      // its directory's first view goes through onDirectory.
      if (stopDirectory !== null) onDirectory(reported);
    },
    setWeather(next) {
      const text = JSON.stringify(next);
      if (text === sentWeather) return;
      sentWeather = text;
      weather = { ...next };
      broadcast({ type: "snapshot", state: snapshot() });
    },
    setIncidents(next) {
      const text = JSON.stringify(next);
      if (text === sentIncidents) return;
      sentIncidents = text;
      incidents = { ...next };
      broadcast({ type: "snapshot", state: snapshot() });
    },
    setChat(source) {
      chatSource = source;
      broadcast({ type: "snapshot", state: snapshot() });
    },
    chatChange(change) {
      broadcast({ type: "chat", change });
    },
    watch(listener) {
      watchers.add(listener);
      if (stopDirectory !== null && view !== EMPTY_VIEW) tell(view, [listener]);
      return () => {
        watchers.delete(listener);
      };
    },
    async read() {
      if (stopDirectory !== null) return snapshot();
      let latest = EMPTY_VIEW;
      const stop = await ports.openDirectory((next) => {
        latest = next;
      });
      try {
        await stop();
      } catch (error) {
        ports.log(`[office] directory stop failed: ${errorMessage(error)}`);
      }
      const names = rosterNames(roster, latest.workspaces, latest.agents);
      return {
        ...snapshot(),
        agents: named(latest.agents, names.members),
        workspaces: [...teamed(latest.workspaces, names.teams)],
      };
    },
    script(workspaceId, name) {
      const workspace = reported.workspaces.find((candidate) => candidate.id === workspaceId);
      return workspace?.scripts?.find((candidate) => candidate.name === name) ?? null;
    },
    workspaceIds() {
      return reported.workspaces.map((workspace) => workspace.id);
    },
    contextReset(agentId) {
      const before = reported.agents.find((agent) => agent.id === agentId)?.context?.usedTokens;
      if (before === undefined || before === 0) return;
      resets = new Map(resets).set(agentId, before);
      onDirectory(reported);
    },
    async stop() {
      resets = new Map();
      subscribers.clear();
      cancelCooldown?.();
      cancelCooldown = null;
      restartQueued = null;
      await idle();
    },
  };
}
