import { createLogoReader } from "./server/brand-logo.js";
import { readSentImage } from "./server/sent-image.js";
import { hostBrand } from "./shared/branding.js";
import { createHash } from "node:crypto";
import { execCommand } from "@getpaseo/plugin/server";
import { createTenure, TenureLedgerSchema, type TenureLedger } from "./server/tenure.js";
import { createLiftService, LiftKeptSchema, type LiftKept } from "./server/lift-service.js";
import { readRepoAge } from "./server/repo-age.js";
import { createStreetWatch, streetReaders } from "./server/street-watch.js";
import { streetSubscription } from "./shared/contracts.js";
import { createLifeFeed } from "./server/life-feed.js";
import { createLifeFile, createSaveQueue, type LifeFile } from "./server/life-store.js";
import {
  autoStartFile,
  intakeFile,
  liftFile,
  tenureFile,
  timelineFile,
  timelineLegacyFile,
  vaultDir,
  vaultLegacyFile,
} from "./server/paths.js";
import { createTimelineStore, type TimelineStore } from "./server/timeline-store.js";
import { createVaultStore, type VaultStore } from "./server/vault-store.js";
import { createDepartureArchiver } from "./server/home-departure.js";
import {
  lifeSubscription,
  homeDepartureRpc,
  tenureRpc,
  undoRpc,
  type LifeEvent,
} from "./shared/contracts.js";
import { embeddedWorldWords, type WorldWords } from "./server/world-words.js";
import { homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import type {
  PluginServerContext,
  PluginSettingsState,
  PluginTurnOutcome,
} from "@getpaseo/plugin/server";
import { embeddedWorldScript, type WorldScript } from "./server/world-script.js";
import { createBoardStore, type BoardStore } from "./server/board-store.js";
import { createChatService, type ChatService } from "./server/chat-service.js";
import { createChatStore, type ChatStore } from "./server/chat-store.js";
import { errorMessage } from "./server/errors.js";
import { createHub } from "./server/hub.js";
import { createWeatherService } from "./server/weather-service.js";
import { createWeatherReader } from "./server/weather-read.js";
import { createIncidentsCheck, type IncidentsCheckState } from "./server/incidents-check.js";
import { TrackerProblem } from "./server/incidents-http.js";
import { probeJira } from "./server/incidents-jira.js";
import {
  createIncidentsSchedule,
  INCIDENTS_SCHEDULE,
  incidentsReaders,
  type IncidentsSettings,
} from "./server/incidents-schedule.js";
import { probeSentry } from "./server/incidents-sentry.js";
import { createIncidentsStore, type IncidentsStore } from "./server/incidents-store.js";
import { projectPlanUsage } from "./server/plan-usage.js";
import { createPlanWatch } from "./server/plan-watch.js";
import {
  autoStartFileStore,
  createAutoStart,
  type AutoStart,
  type AutoStartCountFile,
} from "./server/auto-start.js";
import {
  createIntake,
  INTAKE_SCHEDULE,
  intakeFileStore,
  type Intake,
  type IntakeSeenFile,
} from "./server/intake-service.js";
import { createJiraSource } from "./server/intake-jira.js";
import { createHostAlert } from "./server/host-alert.js";
import { promptReport } from "./shared/vault.js";
import { pinnedNote } from "./shared/alerts.js";
import { extra } from "./shared/host-extras.js";
import { createWatchers } from "./server/watchers.js";
import { createNotifier } from "./server/notify.js";
import {
  alertNotice,
  hostNotice,
  incidentNotice,
  planNotice,
  testNotice,
  wanted,
  type Notice,
} from "./shared/notify.js";
import type { NotifyLevel } from "./shared/settings.js";
import { turnItems } from "./server/live-ports.js";
import { readForgotten, type Checkout } from "./server/forgotten-work.js";
import { createUndo, editedFiles } from "./server/undo-turn.js";
import { VAULT_TAIL_LIMIT, createVault, type Vault } from "./server/vault.js";
import { TIMELINE_KEEP_MS, createTimelineLog, type TimelineLog } from "./server/timeline.js";
import {
  NO_ROSTER,
  ROSTER_MEMBER_KEY,
  rosterOf,
  shownTeamName,
  type Roster,
} from "./shared/roster.js";
import { TEAM_NAME_KEY, tidyTeamName } from "./shared/team-name.js";
import {
  changeSavedTrackers,
  createTrackerCredentialsStore,
  NO_SAVED_TRACKERS,
  trackerCredentials,
  type TrackerCredentialsStore,
} from "./server/tracker-credentials.js";
import { tidyAgent } from "./server/janitor.js";
import {
  liveAgentPorts,
  liveChatPorts,
  liveHubPorts,
  liveJanitorPorts,
  liveNotesPorts,
  readWriterModes,
  liveScriptLogPorts,
  liveSkillsPorts,
} from "./server/live-ports.js";
import { createSshMonitor } from "./server/ssh/monitor.js";
import { sshReadingRpc, sshServersRpc } from "./shared/ssh.js";
import { cleanUpAgent } from "./server/machine/cleanup.js";
import { liveCleanupPorts, liveMachinePorts } from "./server/machine/live-ports.js";
import { hostDetailsRpc, type HostSample } from "./shared/host-details.js";
import { recordSample } from "./server/machine/details.js";
import { MAC_CLEANUP_REFUSAL } from "./server/machine/macos.js";
import { createMachineReader, readDetails } from "./server/machine/machine.js";
import { createMachineWatch } from "./server/machine/watch.js";
import { nodeNotesFs, readMonthNotes } from "./server/notes-files.js";
import {
  createNotesSchedule,
  lateNotesRun,
  missedNotesRun,
  NOTES_SCHEDULE,
  notesTimeZone,
} from "./server/notes-schedule.js";
import { createNotesStore, createNotesWriter, type NotesStore } from "./server/notes-writer.js";
import { createLocalSchedules, type LocalSchedules } from "./server/local-schedules.js";
import {
  DUTY_SCHEDULE,
  createDutyService,
  dutiesFileStore,
  type DutiesFile,
} from "./server/duty-service.js";
import { createOffice } from "./server/office.js";
import { createPaseoHolder } from "./server/paseo-holder.js";
import {
  boardsFile,
  chatFile,
  dutiesFile,
  hostSkillFolders,
  incidentsFile,
  trackersFile,
  notesWriterFile,
  type SkillFolder,
} from "./server/paths.js";
import { readScriptLog } from "./server/script-log.js";
import { readSkills } from "./server/skills.js";
import { nodeClock, type Clock } from "./server/timers.js";
import {
  chatRpc,
  cleanupRpc,
  clearDoneRpc,
  deleteRpc,
  dutiesSaveRpc,
  dutyActedRpc,
  incidentsDismissRpc,
  intakeRunRpc,
  notifyTestRpc,
  notesModesRpc,
  planUsageRpc,
  timelineRpc,
  alertDismissRpc,
  alertsRpc,
  forgottenRpc,
  vaultReportRpc,
  vaultSearchRpc,
  vaultTalkRpc,
  teamRenameRpc,
  trackersSaveRpc,
  trackersTestRpc,
  type TrackersChange,
  type TrackersProbe,
  type TrackersResult,
  janitorRpc,
  machineSubscription,
  notesReadRpc,
  notesWriteRpc,
  officeStateSubscription,
  postRpc,
  scriptLogRpc,
  setWakesPausedRpc,
  skillsRpc,
  startRpc,
  updateRpc,
  sentImageRpc,
  worldLogoRpc,
  worldRpc,
  streetRpc,
  worldWordsRpc,
} from "./shared/contracts.js";
import { chatWords } from "./shared/chat-words.js";
import { officeHostSettings } from "./shared/settings.js";

/** What the office needs from outside the daemon's plugin API. */
export interface OfficePluginDeps {
  fetchFn?: typeof fetch;
  store: BoardStore;
  /** Where the stand-up notes writer keeps its state. */
  notesStore: NotesStore;
  /** Where the incidents check keeps the open incidents and what each tracker has shown. */
  incidentsStore: IncidentsStore;
  /** Where the tracker connections saved from the settings are kept. */
  trackerStore: TrackerCredentialsStore;
  /** Where the team chat keeps its conversation. */
  chatStore: ChatStore;
  tenureFile: LifeFile<TenureLedger>;
  /** Where the timeline is kept; without it the timeline lasts as long as the server. */
  timelineStore?: TimelineStore;
  /** Where the history vault is kept; without it the vault lasts as long as the server. */
  vaultStore?: VaultStore;
  liftFile: LifeFile<LiftKept>;
  /** The owner's duty list. */
  dutiesFile: LifeFile<DutiesFile>;
  /** How many backlog tasks the office started by itself today. */
  autoStartFile: AutoStartCountFile;
  /** The tickets the intake posted. */
  intakeFile: IntakeSeenFile;
  /** The daemon's environment: a tracker with no saved connection takes its token from it. */
  env: NodeJS.ProcessEnv;
  clock: Clock;
  log(message: string): void;
  /** The 3D office's page script. */
  world: WorldScript;
  words: WorldWords;
  /** Where the host's processes are read, and how one is asked to end. */
  machine: MachineHost;
  /** The host's skills folders the library lists. */
  skillFolders: readonly SkillFolder[];
  /** The IANA zone of the stand-up notes' 8:00 run when the settings name none. */
  hostTimeZone: string;
  /** The office's own schedule engine; a test hands in a recording one. */
  schedules: LocalSchedules;
}

export interface MachineHost {
  procRoot: string;
  cgroupRoot: string;
  /** `process.platform`. */
  platform: string;
  /** The office's own process: it and its ancestors are never asked to end. */
  selfPid: number;
  /** Sends SIGTERM. */
  stop(pid: number): void;
  sleep(ms: number): Promise<void>;
}

/** `zone`, or `hostTimeZone` when this host's Intl does not know it. */
function knownZone(zone: string, hostTimeZone: string): string {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return hostTimeZone;
  }
}

/** Why a turn did not complete, for the notes writer; null for one that did. */
function turnProblem(outcome: PluginTurnOutcome): string | null {
  switch (outcome.kind) {
    case "completed":
      return null;
    case "failed":
      return outcome.error.message;
    case "canceled":
      return outcome.reason;
  }
}

// Runs inside the daemon process: every handler, hook and timer catches its own errors.
export function createOfficePlugin(
  server: PluginServerContext,
  deps: OfficePluginDeps,
): () => Promise<void> {
  const { log } = deps;
  const holder = createPaseoHolder();
  // Off until the settings are read: nothing is named before the host has said it may be.
  let stepsNamed = false;
  // The owner's pinned notes; empty until the settings are read.
  let pinnedNotes = "";
  // The owner's webhook and the office's name in its messages; nothing is posted until the settings are read.
  let notifyUrl = "";
  let notifyLevel: NotifyLevel = "danger";
  // A message goes out when there is an address and the owner asked for its severity.
  const tell = (notice: Notice) => {
    if (notifyUrl !== "" && wanted(notice, notifyLevel)) void notifier.send(notice);
  };
  let officeName = "Office 3D";
  const notifier = createNotifier({ url: () => notifyUrl, fetchFn: deps.fetchFn, log });
  const watchers = createWatchers({
    raised: (alert, agent) => {
      tell(alertNotice(alert, agent, officeName));
    },
    guarding: () => loopGuard,
    steer: (agentId, text) => {
      if (!holder.held()) return;
      holder
        .require()
        .agents.ref(agentId)
        .send(text, { activeTurnBehavior: "steer" })
        .catch((error: unknown) => log(`[office] loop hint to ${agentId}: ${errorMessage(error)}`));
    },
    stop: async (agentId) => {
      if (!holder.held()) return false;
      const cancel = extra(holder.require().agents.ref(agentId), "cancel");
      if (cancel === null) return false;
      await cancel();
      return true;
    },
    now: () => deps.clock.now(),
    named: () => stepsNamed,
    pinnedNotes: () => pinnedNotes,
    remind: (agentId, notes) => {
      if (!holder.held()) return;
      holder
        .require()
        .agents.ref(agentId)
        .send(pinnedNote(notes), { activeTurnBehavior: "steer" })
        .catch((error: unknown) =>
          log(`[office] pinned notes to ${agentId}: ${errorMessage(error)}`),
        );
    },
  });
  const hubPorts = liveHubPorts(holder, deps.clock, log, () => stepsNamed, watchers.tail);
  // Set once its file is read; what the office sees before that is not kept.
  let timeline: TimelineLog | null = null;
  const hub = createHub({
    ...hubPorts,
    startActivity: (running, onChange) =>
      hubPorts.startActivity(running, (activity, doing, ...rest) => {
        timeline?.steps(doing);
        onChange(activity, doing, ...rest);
      }),
  });
  // Off until the settings are read: nothing is kept before the owner has said it may be.
  let vaultOn = false;
  let vault: Vault | null = null;
  let stopVault: (() => void) | undefined;
  const vaultReady = (async () => {
    const kept = (await deps.vaultStore?.load()) ?? null;
    vault = createVault(
      {
        tail: async (agentId) => {
          const page = await holder
            .require()
            .agents.ref(agentId)
            .timeline.refetch({ direction: "tail", limit: VAULT_TAIL_LIMIT });
          return page.entries.map((entry) => ({
            at: Date.parse(entry.timestamp),
            seq: entry.seqEnd,
            item: entry.item,
          }));
        },
        on: () => vaultOn,
        save: (agentId, talk) => deps.vaultStore?.save(agentId, talk),
        drop: (agentId) => deps.vaultStore?.drop(agentId),
        log,
      },
      kept,
    );
    stopVault = hub.watch(vault.view);
  })().catch((error: unknown) => log(`[office] history vault unavailable: ${errorMessage(error)}`));
  const stopWatchers = hub.watch(watchers.view);
  // The workspaces' folders as the directory last reported them, for the forgotten-work read.
  let checkouts: Checkout[] = [];
  const stopCheckouts = hub.watch((view) => {
    checkouts = (view?.workspaces ?? []).flatMap((workspace) => {
      const folder = view?.folders?.[workspace.id];
      return folder ? [{ workspaceId: workspace.id, name: workspace.name, folder }] : [];
    });
  });
  // What each agent's turns have cost, as the directory last reported; the boards' time and cost.
  // Empty while no directory runs: an unknown cost is left out, never guessed from an old one.
  let agentCosts = new Map<string, number>();
  // Which agents are in a turn; the boards settle a done task's cost once its agent's is over.
  let agentsWorking = new Map<string, boolean>();
  let stopTimeline: (() => void) | undefined;
  const timelineReady = (async () => {
    const kept = (await deps.timelineStore?.load()) ?? null;
    timeline = createTimelineLog(
      {
        now: () => deps.clock.now(),
        append: (lines) => deps.timelineStore?.append(lines),
        rewrite: (file) => deps.timelineStore?.rewrite(file),
      },
      kept,
    );
    stopTimeline = hub.watch(timeline.view);
  })().catch((error: unknown) => log(`[office] timeline unavailable: ${errorMessage(error)}`));
  hub.setBrand(hostBrand({}, deps.env));
  // The roster the names and the team tasks follow; off until the settings are read.
  let roster: Roster = NO_ROSTER;
  // Made once the office is: the office tells it of each board change and turn end.
  let autoStart: AutoStart | null = null;
  // Made once the office is: a board change can be a task from a ticket now done.
  let intake: Intake | null = null;
  const office = createOffice({
    store: deps.store,
    clock: deps.clock,
    hub,
    agents: liveAgentPorts(
      holder,
      () => roster,
      (agentId) => agentCosts.get(agentId),
      (agentId) => agentsWorking.get(agentId) === true,
    ),
    log,
    onChange: () => {
      autoStart?.boardChanged();
      intake?.boardChanged();
    },
  });
  const stopCosts = hub.watch((view) => {
    // No directory, no figures: the last ones would go stale while the pickup hands out work. A
    // claim then keeps no cost, and a cost that waited for its turn's end is dropped unsettled.
    if (view === null) {
      agentCosts = new Map();
      agentsWorking = new Map();
      void office.settleSpentOf(new Map());
      return;
    }
    // A view that lists nobody is not taken for everyone gone: the figures stand until one does.
    if (view.agents.length === 0) return;
    agentCosts = new Map(
      view.agents.flatMap((agent) =>
        agent.costUsd === undefined ? [] : [[agent.id, agent.costUsd] as const],
      ),
    );
    agentsWorking = new Map(
      view.agents.map(
        (agent) =>
          [agent.id, agent.status === "running" || agent.status === "initializing"] as const,
      ),
    );
    void office.settleSpentOf(
      new Map(view.agents.map((agent) => [agent.id, agent.status] as const)),
    );
  });

  const samples: HostSample[] = [];
  // Told only while the owner keeps the office watching; a reading with no office open is one too.
  const hostAlert = createHostAlert((percent) =>
    tell(hostNotice(percent, deps.clock.now(), officeName)),
  );
  const reader = createMachineReader({
    procRoot: deps.machine.procRoot,
    cgroupRoot: deps.machine.cgroupRoot,
    platform: deps.machine.platform,
    ...liveMachinePorts(holder, () => deps.clock.now()),
  });
  const machine = createMachineWatch({
    async read() {
      const reading = await reader.read();
      if (reading) {
        recordSample(samples, reading);
        if (keepWatching) hostAlert.observe(reading);
      }
      return reading;
    },
    timers: deps.clock,
    log,
  });
  // The providers whose plan the owner left out; empty until the settings are read.
  let planHidden: ReadonlySet<string> = new Set();
  const planWatch = createPlanWatch({
    async read() {
      return projectPlanUsage((await holder.require().providers.listUsage()).providers);
    },
    counted: (provider) => !planHidden.has(provider),
    raised: ({ provider, window }) =>
      tell(planNotice(provider.name, window.label, window.usedPct, deps.clock.now(), officeName)),
    // The gate's only reading: with Keep watching off there is none, and nothing starts by itself.
    observed: (reading) => autoStart?.planRead(reading),
    timers: deps.clock,
    log,
  });
  // Starts the lobby's oldest backlog task while the plan, the claims and the day's count allow.
  autoStart = createAutoStart({
    board: office,
    file: deps.autoStartFile,
    now: () => deps.clock.now(),
    changed: (state) => hub.setAutoStart(state),
    log,
  });
  const ssh = createSshMonitor(deps.env, homedir(), deps.machine.procRoot);
  const cleanupPorts = {
    procRoot: deps.machine.procRoot,
    selfPid: deps.machine.selfPid,
    stop: deps.machine.stop,
    sleep: deps.machine.sleep,
    ...liveCleanupPorts(holder),
  };

  const janitorPorts = liveJanitorPorts(holder);
  const logPorts = liveScriptLogPorts(holder, hub, () => deps.clock.now());
  const skillsPorts = liveSkillsPorts(holder, hub, deps.skillFolders, () => deps.clock.now(), log);

  const settings = server.registerSettings(officeHostSettings);
  // COMPAT(officeStoredSchedules): a host that kept plugin schedules stored two for an earlier version of
  // this plugin; this removes them. Delete once no such host runs the office.
  if ("schedules" in server) {
    const storedSchedules = (server as { schedules: { remove(name: string): Promise<boolean> } })
      .schedules;
    void (async () => {
      for (const name of [NOTES_SCHEDULE, INCIDENTS_SCHEDULE]) {
        try {
          await storedSchedules.remove(name);
        } catch (error) {
          log(
            `[office] the stored ${name} schedule of an earlier version was not removed: ${errorMessage(error)}`,
          );
        }
      }
    })();
  }
  // The office keeps its own schedules: nothing is stored, so they are set from the settings at
  // each load, which also picks up a change of the host's zone, and again at each save.
  const notesSchedule = createNotesSchedule({
    schedules: deps.schedules,
    hostTimeZone: deps.hostTimeZone,
    log,
  });
  async function readHostSettings() {
    const state = await settings.read();
    if (state.status !== "ready") {
      throw new Error(`The office's settings cannot be read: ${state.error}`);
    }
    return state.values;
  }
  // One writer of the day's stand-up entry at a time, started at 8:00 and by the bell.
  const writer = createNotesWriter({
    ...liveNotesPorts(holder, hub),
    settings: readHostSettings,
    hostTimeZone: deps.hostTimeZone,
    now: () => deps.clock.now(),
    load: () => deps.notesStore.load(),
    save: (state) => deps.notesStore.save(state),
    changed: (state) => hub.setNotes({ ...state, scheduleError: notesSchedule.error() }),
    log,
  });
  // The duty list, posted on the duty board at each duty's time (08:00 unless set) in the notes'
  // zone, and caught up at the start and at each save. A zone that cannot be read, or that Intl
  // does not know, is the host's.
  const duties = createDutyService({
    file: deps.dutiesFile,
    board: office,
    schedules: deps.schedules,
    zone: () =>
      readHostSettings().then(
        (values) => knownZone(notesTimeZone(values, deps.hostTimeZone), deps.hostTimeZone),
        () => deps.hostTimeZone,
      ),
    now: () => deps.clock.now(),
    listed: (list) => office.setDuties(list),
    changed: (state) => hub.setDuties(state),
    log,
  });
  void duties.start();
  // Every 5 minutes while a tracker is on; it follows the settings as the 8:00 schedule does.
  const incidentsSchedule = createIncidentsSchedule({ schedules: deps.schedules, log });
  // The check's last state, kept so a save that changes the schedule's error pushes it again.
  // Null until the store was read: the snapshot has no incidents before then.
  let checked: IncidentsCheckState | null = null;
  // The connections saved from the settings, read once and kept: a save replaces them here too.
  let savedTrackers = NO_SAVED_TRACKERS;
  const trackersLoaded = deps.trackerStore.load().then(
    (saved) => {
      savedTrackers = saved;
      return undefined;
    },
    (error: unknown) => log(`[office] tracker connections failed to load: ${errorMessage(error)}`),
  );
  const credentials = () => trackerCredentials(savedTrackers, deps.env);
  // The owner's JQL, as the settings last had it; empty while they cannot be read. Never logged.
  let intakeJql = "";
  // Every 10 minutes while a source is set up: each new ticket becomes a lobby task.
  intake = createIntake({
    sources: [
      createJiraSource({
        env: () => credentials().jira,
        jql: () => intakeJql,
        ...(deps.fetchFn === undefined ? {} : { fetchFn: deps.fetchFn }),
      }),
    ],
    board: {
      allPosts: () => office.allPosts(),
      post: (input) => office.post(input),
      markWroteBack: (id) => office.markWroteBack(id),
      label: (author) => office.label(author),
    },
    file: deps.intakeFile,
    schedules: deps.schedules,
    now: () => deps.clock.now(),
    changed: (state) => hub.setIntake(state),
    log,
  });
  function pushIncidents(): void {
    if (checked === null) return;
    const { jira, sentry } = credentials();
    hub.setIncidents({
      ...checked,
      jiraReady: jira !== null,
      sentryReady: sentry !== null,
      connections: {
        jira: {
          source: jira?.source ?? "none",
          baseUrl: jira?.baseUrl ?? "",
          email: jira?.email ?? "",
        },
        sentry: { source: sentry?.source ?? "none" },
      },
      scheduleError: incidentsSchedule.error(),
    });
  }
  // The settings are read at each run, so a save holds from the next check.
  const incidents = createIncidentsCheck({
    readers: async () => {
      await trackersLoaded;
      return incidentsReaders(await readHostSettings(), credentials());
    },
    store: deps.incidentsStore,
    now: () => deps.clock.now(),
    log,
    changed: (state) => {
      checked = state;
      pushIncidents();
    },
    opened: (incident) => {
      tell(incidentNotice(incident, officeName));
    },
  });
  incidents
    .start()
    .catch((error: unknown) => log(`[office] incidents load failed: ${errorMessage(error)}`));
  // The weather: read from the user's address only while an office is open, on its own timers.
  const weather = createWeatherService({
    clock: deps.clock,
    read: createWeatherReader({ fetchFn: deps.fetchFn }),
    changed: (state) => hub.setWeather(state),
    log,
  });
  const stopWatchingWeather = hub.watch((view) => weather.officeOpen(view !== null));
  const now = () => deps.clock.now();
  const listeners = new Map<(event: LifeEvent) => void, () => void>();
  const tenureSaves = createSaveQueue(deps.tenureFile, deps.clock, log);
  let liftSaved = Promise.resolve();
  let stopLife: (() => void) | undefined;
  async function startLife() {
    const [ledger, kept, script] = await Promise.all([
      deps.tenureFile.load(),
      deps.liftFile.load(),
      deps.world.read(),
    ]);
    const lift = createLiftService({
      last: kept,
      build: createHash("sha256").update(script).digest("hex").slice(0, 7),
      now: now(),
      save: (data) => {
        liftSaved = deps.liftFile
          .save(data)
          .catch((error) => log("[office] lift save failed: " + errorMessage(error)));
      },
    });
    const feed = createLifeFeed({
      now,
      tenure: createTenure({ store: { load: () => ledger, save: tenureSaves.save }, now }),
      lift,
      days: () => ({ choices: [30], days: 30 }),
      age: (folder) => readRepoAge(folder, execCommand),
      emit: (snapshot) => {
        for (const send of listeners.keys()) send({ type: "life", ...snapshot });
      },
    });
    stopLife = hub.watch(feed.view);
    return feed;
  }
  const lifeReady = startLife().catch((error: unknown) => {
    log("[office] staff scenes unavailable: " + errorMessage(error));
    return null;
  });
  const streets = createStreetWatch(streetReaders(execCommand), deps.clock, log);
  const stopStreet = hub.watch(streets.view);
  // One service for the office's life, made as the server starts. Its file is read first; until
  // then the chat call waits, and a snapshot has no chat.
  let chat: ChatService | null = null;
  let stopWatching: (() => void) | null = null;
  // What the chat's people write follows the host's setting from the next line on; the lines
  // already in the chat stay as they were written.
  let chatLines = chatWords("international");
  function chatTr(key: string, vars?: object | null): string;
  function chatTr(key: string, vars: object | null, as: "list"): string[];
  function chatTr(key: string, vars?: object | null, as?: "list"): string | string[] {
    return as === "list" ? chatLines(key, vars ?? null, as) : chatLines(key, vars);
  }
  const chatPorts = liveChatPorts(holder);
  async function startChat(): Promise<void> {
    const service = await createChatService({
      store: deps.chatStore,
      lobbyPosts: office.lobbyPosts,
      clock: deps.clock,
      tr: chatTr,
      ...chatPorts,
      emit: (change) => hub.chatChange(change),
      log,
    });
    chat = service;
    stopWatching = hub.watch((view) => service.view(view));
    hub.setChat(() => service.snapshot());
  }
  const chatReady = startChat().catch((error: unknown) =>
    log(`[office] chat unavailable: ${errorMessage(error)}`),
  );
  let agentToolsOn = false;
  // Whether the owner has the office go on reading with no office open; off until the settings are read.
  let keepWatching = false;
  // Whether a request for a call that just failed three times running is refused; off until the settings say.
  let loopGuard = false;
  // Whether a turn's work tree is snapshotted so its edits can be undone; off until the settings say.
  let undoOn = false;
  const undo = createUndo({ exec: execCommand, enabled: () => undoOn, log });
  // The directory needs the Paseo API, which the first handler or hook brings.
  const followWatching = () => {
    const on = keepWatching && holder.held();
    hub.keepOpen(on);
    machine.keep(on);
    planWatch.keep(on);
  };
  void holder.wait().then(followWatching);
  void holder.wait().then(() => office.setPickupEnabled(agentToolsOn));
  // Neither schedule can follow settings it cannot read: both cards say why until a save is read.
  function settingsUnreadable(reason: string): void {
    agentToolsOn = false;
    stepsNamed = false;
    vaultOn = false;
    pinnedNotes = "";
    notifyUrl = "";
    keepWatching = false;
    loopGuard = false;
    undoOn = false;
    followWatching();
    office.setPickupEnabled(false);
    autoStart?.settingsChanged(null);
    intakeJql = "";
    void intake?.settingsChanged(null);
    const message = `The office's settings cannot be read: ${reason}`;
    log(`[office] ${message}`);
    notesSchedule.fail(message);
    incidentsSchedule.fail(message);
    hub.setNotes({ ...writer.state(), scheduleError: notesSchedule.error() });
    pushIncidents();
    // The duty board's zone is then the host's, so its 8:00 run still comes.
    void duties.settingsChanged();
  }
  async function followSettings(
    state: PluginSettingsState<typeof officeHostSettings.schema>,
  ): Promise<void> {
    if (state.status !== "ready") {
      settingsUnreadable(state.error);
      return;
    }
    hub.setBrand(hostBrand(state.values, deps.env));
    officeName = hostBrand(state.values, deps.env)?.name ?? "Office 3D";
    notifyUrl = state.values.notifyUrl.trim();
    notifyLevel = state.values.notifyLevel;
    roster = rosterOf(state.values);
    hub.setRoster(roster);
    agentToolsOn = state.values.agentTools;
    stepsNamed = !state.values.streamerMode;
    vaultOn = state.values.historyVault;
    chatLines = chatWords(state.values.chatCulture);
    pinnedNotes = state.values.pinnedNotes;
    keepWatching = state.values.keepWatching;
    planHidden = new Set(state.values.planHidden);
    loopGuard = state.values.loopGuard;
    undoOn = state.values.undoTurn;
    followWatching();
    office.setPickupEnabled(agentToolsOn && holder.held());
    autoStart?.settingsChanged({
      autoStart: state.values.autoStart,
      autoStartUnderPct: state.values.autoStartUnderPct,
      autoStartAtOnce: state.values.autoStartAtOnce,
      autoStartPerDay: state.values.autoStartPerDay,
      planHidden: state.values.planHidden,
      intakeAutoStart: state.values.intakeAutoStart,
      // The notes' day: a calendar day from midnight in their zone.
      zone: knownZone(notesTimeZone(state.values, deps.hostTimeZone), deps.hostTimeZone),
    });
    weather.settingsChanged(state.values);
    intakeJql = state.values.jiraIntakeJql;
    await trackersLoaded;
    await intake?.settingsChanged({
      lands: state.values.intakeLands,
      writeBack: state.values.intakeWriteBack,
    });
    const notesSaved = await notesSchedule.sync(state.values);
    // The schedule was just set: at the daemon's start, or by a changed zone, folder or days. A
    // run that came due earlier today is made up.
    if (notesSaved && missedNotesRun(state.values, deps.hostTimeZone, deps.clock.now())) {
      void startNotesRun(deps.clock.now(), { unlessWritten: true }).catch((error: unknown) =>
        log(`[office] ${NOTES_SCHEDULE} make-up run failed: ${errorMessage(error)}`),
      );
    }
    await duties.settingsChanged();
    // The writer reads the folder again, and its push carries the schedule's error with it.
    await writer
      .settingsChanged()
      .catch((error: unknown) => log(`[office] notes state failed: ${errorMessage(error)}`));
    await followTrackers(state.values);
  }
  async function followTrackers(values: IncidentsSettings): Promise<void> {
    await trackersLoaded;
    const trackersOn = Object.keys(incidentsReaders(values, credentials())).length > 0;
    await incidentsSchedule.sync(trackersOn);
    // With every tracker off no run comes again. One run with no reader drops the problems and
    // closes what is a day old.
    if (!trackersOn) await incidents.check();
    pushIncidents();
  }
  const stopFollowingSettings = settings.subscribe(followSettings);
  settings
    .read()
    .then(followSettings, (error: unknown) => settingsUnreadable(errorMessage(error)))
    .catch((error: unknown) =>
      log(`[office] following the settings failed: ${errorMessage(error)}`),
    );

  async function guarded<T>(name: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      log(`[office] ${name} failed: ${errorMessage(error)}`);
      throw error;
    }
  }

  // The handler's promise settles when the subscriber leaves (or the directory cannot start),
  // and settling closes the subscription; see Hub.attach.
  server.handle(officeStateSubscription, (_input, context) => {
    holder.remember(context.paseo);
    return hub.attach(context);
  });
  server.handle(streetRpc, () => guarded("street", () => deps.world.readStreet()));
  const readLogo = createLogoReader();
  server.handle(worldLogoRpc, async () => {
    const current = await settings.read();
    const url = hostBrand(current.status === "ready" ? current.values : {}, deps.env)?.logoUrl;
    return url ? { url, data: await readLogo(url) } : null;
  });
  server.handle(sentImageRpc, async ({ url }) => ({ data: await readSentImage(url) }));
  server.handle(worldRpc, () => guarded("world", () => deps.world.read()));
  server.handle(worldWordsRpc, (input) => guarded("words", () => deps.words.read(input.language)));
  // The readings stop with the last subscriber: nothing walks /proc while no office is open.
  server.handle(sshServersRpc, (_input, context) => ssh.list(context.paseo));
  server.handle(sshReadingRpc, ({ id }, context) => ssh.read(context.paseo, id));
  server.handle(hostDetailsRpc, () => readDetails(deps.machine, homedir(), samples));
  server.handle(machineSubscription, (_input, context) => {
    holder.remember(context.paseo);
    return machine.attach(context);
  });
  server.handle(cleanupRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("cleanup", async () => {
      if (deps.machine.platform === "darwin") {
        const refused = input.agentIds.map((agentId) => ({
          agentId,
          ok: false,
          error: MAC_CLEANUP_REFUSAL,
        }));
        return { results: refused };
      }
      // One at a time: each close waits for its runtime's processes.
      const results = [];
      for (const agentId of new Set(input.agentIds)) {
        results.push(await cleanUpAgent(cleanupPorts, agentId));
      }
      machine.refresh();
      return { results };
    });
  });
  server.handle(janitorRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("janitor", async () => {
      const result = await tidyAgent(janitorPorts, input.agentId, input.action);
      if (result.ok && input.action === "reset") hub.contextReset(input.agentId);
      return result;
    });
  });
  server.handle(scriptLogRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("script log", () => readScriptLog(logPorts, input.workspaceId, input.script));
  });
  server.handle(skillsRpc, (_input, context) => {
    holder.remember(context.paseo);
    return guarded("skills", () => readSkills(skillsPorts));
  });
  server.handle(notesReadRpc, (input) =>
    guarded("notes read", () =>
      readMonthNotes(
        { settings, hostTimeZone: deps.hostTimeZone, now: () => deps.clock.now(), fs: nodeNotesFs },
        input.month,
      ),
    ),
  );
  server.handle(postRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("post", () => office.post(input));
  });
  server.handle(updateRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("update", () => office.update(input));
  });
  server.handle(startRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("start", () => office.start(input.id));
  });
  server.handle(deleteRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("delete", () => office.remove(input.id));
  });
  server.handle(clearDoneRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("clear", () => office.clearDone(input.board));
  });
  server.handle(setWakesPausedRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("pause", () => office.setWakesPaused(input.paused));
  });
  server.handle(dutiesSaveRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("duties save", () => duties.save(input.duties));
  });
  server.handle(dutyActedRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("duty acted", () => office.actDuty(input.id, input.agentId));
  });
  // The bell. A start never rejects: why none started is in the snapshot's notes.
  server.handle(notesWriteRpc, (_input, context) => {
    holder.remember(context.paseo);
    return writer.start();
  });
  // On stock Paseo the API reaches the plugin only on a handler's or hook's context, so after a
  // restart on a quiet host a run waits until the office is opened or an agent's turn moves.
  async function paseoForRun(name: string): Promise<void> {
    if (!holder.held()) {
      log(
        `[office] ${name} run is waiting for the Paseo API: open the office, or let an agent open or end a turn`,
      );
    }
    await holder.wait();
  }
  // The 8:00 run ends once the writer started; the writer's own end is its turn's hook. A run
  // made up after a restart is the same, given the day it came due.
  async function startNotesRun(
    dueAt: number,
    options?: { unlessWritten?: boolean },
  ): Promise<void> {
    await paseoForRun(NOTES_SCHEDULE);
    // The writer writes the day it starts on: a run that waited past midnight would write the
    // wrong day. Settings that cannot be read are left to the writer, which shows why.
    const zone = await readHostSettings().then(
      (values) => notesTimeZone(values, deps.hostTimeZone),
      () => null,
    );
    const late = zone === null ? null : lateNotesRun(dueAt, deps.clock.now(), zone);
    if (late !== null) {
      log(
        `[office] ${NOTES_SCHEDULE} run dropped: it was due on ${late.dueDay} and could only start on ${late.startDay}`,
      );
      return;
    }
    await writer.start(options);
  }
  const stopNotesRuns = deps.schedules.handle(NOTES_SCHEDULE, (dueAt) => startNotesRun(dueAt));
  // The duty board's runs, at 08:00 and at each duty's time: what is due is posted, and done
  // duties of earlier days leave.
  const stopDutyRuns = deps.schedules.handle(DUTY_SCHEDULE, (dueAt) => duties.sync(dueAt));
  server.handle(notifyTestRpc, () => notifier.send(testNotice(deps.clock.now(), officeName)));
  server.handle(incidentsDismissRpc, ({ ids }) =>
    guarded("incidents dismiss", async () => ({ dismissed: await incidents.dismiss(ids) })),
  );
  async function saveTrackers(input: TrackersChange): Promise<TrackersResult> {
    await trackersLoaded;
    const changed = changeSavedTrackers(savedTrackers, input);
    if ("problem" in changed) return { ok: false, problem: changed.problem };
    await deps.trackerStore.save(changed.saved);
    savedTrackers = changed.saved;
    // A sign-in saved or cleared sets the intake up, or stops it.
    await intake?.sync();
    // The check's schedule follows the new connection; the settings may be unreadable.
    await readHostSettings().then(followTrackers, pushIncidents);
    return { ok: true };
  }
  async function probeTracker(input: TrackersProbe): Promise<void | string> {
    const kept = credentials();
    if (input.tracker === "jira") {
      // The typed connection as a save would keep it, with the token in use when none is typed.
      const token = input.token.trim() || (kept.jira?.token ?? "");
      const typed = changeSavedTrackers(NO_SAVED_TRACKERS, {
        action: "save-jira",
        ...input,
        token,
      });
      if ("problem" in typed) return typed.problem;
      if (typed.saved.jira === undefined) return "Enter the Jira connection";
      return probeJira({ ...typed.saved.jira, tokenVariable: "the Jira API token" });
    }
    const token = input.token.trim() || (kept.sentry?.token ?? "");
    if (token === "") return "Enter the Sentry auth token";
    const { sentryUrl: url, sentryOrg: org } = await readHostSettings();
    if (org.trim() === "") return "Set the Sentry organisation first";
    return probeSentry({ url, org, token, tokenVariable: "the Sentry auth token" });
  }
  async function testTracker(input: TrackersProbe): Promise<TrackersResult> {
    await trackersLoaded;
    try {
      const problem = await probeTracker(input);
      return typeof problem === "string" ? { ok: false, problem } : { ok: true };
    } catch (error) {
      // A tracker's problem is written to be shown; anything else may quote what was typed.
      if (error instanceof TrackerProblem) return { ok: false, problem: error.message };
      throw error;
    }
  }
  server.handle(timelineRpc, async ({ from, to }) => {
    await timelineReady;
    if (timeline === null) return { ok: false as const, problem: "The timeline cannot be read" };
    const end = Math.min(to, deps.clock.now());
    const start = Math.max(from, end - TIMELINE_KEEP_MS);
    return { ok: true as const, timeline: timeline.read(start, end) };
  });
  server.handle(forgottenRpc, async () => ({
    items: await readForgotten(checkouts, execCommand),
  }));
  server.handle(alertsRpc, async () => ({ alerts: watchers.alerts() }));
  server.handle(alertDismissRpc, async ({ id }) => {
    watchers.dismiss(id);
    return { alerts: watchers.alerts() };
  });
  server.handle(vaultSearchRpc, async ({ query }) => {
    await vaultReady;
    return { on: vaultOn, hits: vaultOn ? (vault?.search(query) ?? []) : [] };
  });
  server.handle(vaultTalkRpc, async ({ agentId }) => {
    await vaultReady;
    return { talk: vaultOn ? (vault?.talk(agentId) ?? null) : null };
  });
  server.handle(vaultReportRpc, async () => {
    await vaultReady;
    const from = deps.clock.now() - 7 * 24 * 60 * 60 * 1000;
    return { on: vaultOn, report: vault?.report(from) ?? promptReport([]) };
  });
  server.handle(planUsageRpc, async (_input, context) => {
    holder.remember(context.paseo);
    try {
      const listed = await context.paseo.providers.listUsage();
      return { ok: true as const, providers: projectPlanUsage(listed.providers) };
    } catch (error) {
      // A host older than provider usage has no such call: the floor then shows no limit.
      return { ok: false as const, problem: errorMessage(error) };
    }
  });
  server.handle(teamRenameRpc, async ({ workspaceId, name }, context) => {
    holder.remember(context.paseo);
    try {
      const workspace = context.paseo.workspaces.ref(workspaceId);
      const current = await workspace.refresh();
      if (current === null) return { ok: false as const, problem: "The workspace is gone" };
      const next = tidyTeamName(name);
      // Null removes the key, and the team goes by the workspace's name again.
      await workspace.setMetadata({ [TEAM_NAME_KEY]: next === "" ? null : next });
      // Cleared, the team goes by the workspace's name again.
      const shown = shownTeamName(
        { name: current.name, metadata: { ...current.metadata, [TEAM_NAME_KEY]: next } },
        roster,
      );
      // The directory's next view would carry the tenure over too; a restart before it would not.
      (await lifeReady)?.renamed(shownTeamName(current, roster), shown);
      return { ok: true as const, name: shown };
    } catch (error) {
      log(`[office] team rename failed: ${errorMessage(error)}`);
      return { ok: false as const, problem: errorMessage(error) };
    }
  });
  server.handle(notesModesRpc, async (_input, context) => {
    holder.remember(context.paseo);
    try {
      const values = await readHostSettings();
      // The provider is asked for the notes folder, as the writer's start asks it.
      const cwd = values.notesFolder.trim() || homedir();
      return { ok: true as const, ...(await readWriterModes(holder, cwd, values.notesMode)) };
    } catch (error) {
      return { ok: false as const, problem: errorMessage(error) };
    }
  });
  // One save at a time: each starts from what the one before it kept.
  let trackerSaves: Promise<unknown> = Promise.resolve();
  server.handle(trackersSaveRpc, (input) => {
    const run = trackerSaves.then(() =>
      guarded("tracker connection save", () => saveTrackers(input)),
    );
    trackerSaves = run.catch(() => undefined);
    return run;
  });
  server.handle(trackersTestRpc, (input) =>
    guarded("tracker connection test", () => testTracker(input)),
  );
  server.handle(chatRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("chat", async () => {
      await chatReady;
      if (chat === null) throw new Error("The team chat did not start");
      return chat.request(input);
    });
  });
  server.handle(lifeSubscription, async (_input, context) => {
    holder.remember(context.paseo);
    const feed = await lifeReady;
    if (!feed || context.signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const send = (event: LifeEvent) => {
        void context
          .push(event)
          .catch((error) => log("[office] life push failed: " + errorMessage(error)));
      };
      const close = () => {
        listeners.delete(send);
        context.signal.removeEventListener("abort", close);
        resolve();
      };
      listeners.set(send, close);
      context.signal.addEventListener("abort", close, { once: true });
      send({ type: "life", ...feed.snapshot() });
    });
  });
  server.handle(streetSubscription, (_input, context) => streets.attach(context));
  const archiveDeparture = createDepartureArchiver(
    () => hub.read(),
    async () => {
      const state = await settings.read();
      return state.status === "ready" && state.values.archiveOnDeparture === true;
    },
  );
  server.handle(homeDepartureRpc, (input, context) =>
    guarded("home departure", async () => {
      holder.remember(context.paseo);
      return { archived: await archiveDeparture(context.paseo, input.agentId, input.idleSince) };
    }),
  );
  server.handle(undoRpc, (input, context) =>
    guarded("undo", async () => {
      holder.remember(context.paseo);
      const none = { files: 0, restored: 0, skipped: [] };
      if (input.op === "status") return { ...none, files: undo.available(input.agentId) };
      const result = await undo.undo(input.agentId);
      return result === null ? none : { files: 0, ...result };
    }),
  );
  server.handle(tenureRpc, async (input, context) => {
    holder.remember(context.paseo);
    return (await lifeReady)?.write(input) ?? { ok: false };
  });
  // A check never rejects: a tracker that fails shows its problem on the Incidents card. It is
  // about now, so a run that waited checks when it resumes.
  const stopIncidentsRuns = deps.schedules.handle(INCIDENTS_SCHEDULE, async () => {
    await paseoForRun(INCIDENTS_SCHEDULE);
    await incidents.check();
  });
  // A run needs no Paseo API: it posts as the user, and the pickup hands the task out later.
  const stopIntakeRuns = deps.schedules.handle(INTAKE_SCHEDULE, async () => {
    await intake?.run();
  });
  server.handle(intakeRunRpc, async () => {
    if (intake === null) throw new Error("The intake did not start");
    return intake.run();
  });

  const removeHooks = [
    server.addHook("agent.open.before", async ({ request }, context) => {
      try {
        holder.remember(context.paseo);
        office.noteAgent({
          id: request.agentId,
          workspaceId: request.workspaceId,
          title: request.title,
        });
        if (request.purpose !== "interactive") return undefined;
        // Read here and not kept: a session opened while a first read was still on its way would
        // get the tools after the owner turned them off. A read that fails gives no tools.
        const state = await settings.read();
        if (state.status === "ready" && !state.values.agentTools) return undefined;
        return { ...request, tools: [...request.tools, ...office.tools] };
      } catch (error) {
        log(`[office] agent.open.before failed: ${errorMessage(error)}`);
        return undefined;
      }
    }),
    server.addHook("agent.turn.before", async ({ agent }, context) => {
      try {
        holder.remember(context.paseo);
        await undo.begin(agent.id, agent.cwd);
      } catch (error) {
        log(`[office] agent.turn.before failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("agent.turn.after", async ({ agent, outcome, turnId }, context) => {
      // Not waited for: a second snapshot takes as long as the first, and nothing here needs it.
      if (undoOn && turnId !== null) {
        void (async () => {
          const files = editedFiles(await turnItems(context.paseo, agent.id, turnId));
          await undo.end(agent.id, agent.cwd, files);
        })().catch((error: unknown) => log(`[office] undo read failed: ${errorMessage(error)}`));
      }
      try {
        holder.remember(context.paseo);
        office.noteAgent(agent);
        office.turnEnded(agent.id);
        if (outcome.kind === "completed" && turnId !== null) {
          await office
            .checkCompletion(
              agent.id,
              async () => (await chatPorts.readTurn(agent.id, turnId)).text,
            )
            .catch((error: unknown) =>
              log(`[office] lobby completion check failed: ${errorMessage(error)}`),
            );
        }
        await (
          await lifeReady
        )?.turnEnded(agent.id, async () => {
          // With the office closed there is no subscribed roster. Resolve the hook's team on demand.
          const workspaceId =
            agent.workspaceId ??
            (agent.parentAgentId
              ? (await context.paseo.agents.ref(agent.parentAgentId).refresh())?.agent.workspaceId
              : null);
          if (!workspaceId) return null;
          const workspace = await context.paseo.workspaces.ref(workspaceId).refresh();
          return workspace
            ? shownTeamName(workspace, roster, agent.metadata?.[ROSTER_MEMBER_KEY])
            : null;
        });
      } catch (error) {
        log(`[office] agent.turn.after failed: ${errorMessage(error)}`);
      }
      try {
        void chat
          ?.turnEnded(agent, outcome, turnId)
          .catch((error: unknown) => log(`[office] chat turn end failed: ${errorMessage(error)}`));
      } catch (error) {
        log(`[office] chat turn end failed: ${errorMessage(error)}`);
      }
      // A stopped turn counts as failed: the entry is not written, and the writer is left.
      try {
        await writer.turnEnded(agent.id, outcome.kind !== "completed", turnProblem(outcome));
      } catch (error) {
        log(`[office] notes writer turn end failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("agent.permission.before", async ({ agent, request }, context) => {
      try {
        holder.remember(context.paseo);
        const reason = loopGuard ? watchers.repeats(agent.id, request) : null;
        if (reason === null) return;
        // Answered after the hook has returned: the daemon may not hold the request before then.
        deps.clock.setTimeout(() => {
          context.paseo.agents
            .ref(agent.id)
            .respondToPermission({
              requestId: request.id,
              response: { behavior: "deny", message: reason },
            })
            .catch((error: unknown) =>
              log(`[office] loop guard for ${agent.id}: ${errorMessage(error)}`),
            );
        }, 0);
      } catch (error) {
        log(`[office] agent.permission.before failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("agent.close.after", async ({ agent }) => {
      try {
        office.agentGone(agent.id, "closed");
        undo.forget(agent.id);
        await writer.agentClosed(agent.id);
      } catch (error) {
        log(`[office] agent.close.after failed: ${errorMessage(error)}`);
      }
      try {
        chat?.closed(agent.id);
      } catch (error) {
        log(`[office] chat close failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("agent.archive.after", async ({ agent }) => {
      try {
        office.agentGone(agent.id, "archived");
        undo.forget(agent.id);
        await writer.agentArchived(agent.id);
      } catch (error) {
        log(`[office] agent.archive.after failed: ${errorMessage(error)}`);
      }
      try {
        chat?.archived(agent.id);
      } catch (error) {
        log(`[office] chat archive failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("workspace.archive.after", async ({ workspace }) => {
      try {
        await office.workspaceArchived(workspace.id);
      } catch (error) {
        log(`[office] workspace.archive.after failed: ${errorMessage(error)}`);
      }
    }),
  ];

  return async () => {
    stopFollowingSettings();
    stopWatchingWeather();
    weather.stop();
    stopNotesRuns();
    stopDutyRuns();
    stopIncidentsRuns();
    stopIntakeRuns();
    intake?.stop();
    deps.schedules.stop();
    for (const remove of removeHooks) remove();
    stopStreet();
    streets.stop();
    await lifeReady;
    stopLife?.();
    stopTimeline?.();
    stopWatchers();
    stopCheckouts();
    stopCosts();
    stopVault?.();
    await deps.vaultStore?.flush();
    await deps.timelineStore?.flush();
    for (const close of listeners.values()) close();
    await Promise.all([tenureSaves.flush(), liftSaved]);
    autoStart?.stop();
    planWatch.keep(false);
    machine.keep(false);
    machine.stop();
    await ssh.stop();
    await office.stop();
    // A chat still loading would start its clock after this stop.
    await chatReady;
    stopWatching?.();
    await chat?.stop();
    await hub.stop();
  };
}

export default function contribute(server: PluginServerContext): () => Promise<void> {
  const log = (message: string) => console.error(message);
  return createOfficePlugin(server, {
    // The plugin runs in a subprocess the daemon starts, which inherits the daemon's whole
    // environment, so process.env holds the daemon's PASEO_HOME.
    store: createBoardStore({
      file: boardsFile(process.env, homedir()),
      now: () => Date.now(),
      log,
    }),
    notesStore: createNotesStore({ file: notesWriterFile(process.env, homedir()), log }),
    incidentsStore: createIncidentsStore({ file: incidentsFile(process.env, homedir()), log }),
    trackerStore: createTrackerCredentialsStore({
      file: trackersFile(process.env, homedir()),
      log,
    }),
    tenureFile: createLifeFile(tenureFile(process.env, homedir()), TenureLedgerSchema),
    timelineStore: createTimelineStore(
      timelineFile(process.env, homedir()),
      timelineLegacyFile(process.env, homedir()),
      nodeClock,
      log,
    ),
    vaultStore: createVaultStore(
      vaultDir(process.env, homedir()),
      vaultLegacyFile(process.env, homedir()),
      nodeClock,
      log,
    ),
    liftFile: createLifeFile(liftFile(process.env, homedir()), LiftKeptSchema),
    dutiesFile: dutiesFileStore(dutiesFile(process.env, homedir()), { now: () => Date.now(), log }),
    autoStartFile: autoStartFileStore(autoStartFile(process.env, homedir())),
    intakeFile: intakeFileStore(intakeFile(process.env, homedir())),
    chatStore: createChatStore({
      file: chatFile(process.env, homedir()),
      now: () => Date.now(),
      log,
    }),
    env: process.env,
    clock: nodeClock,
    log,
    world: embeddedWorldScript(),
    words: embeddedWorldWords(),
    machine: {
      procRoot: "/proc",
      cgroupRoot: "/sys/fs/cgroup",
      platform: process.platform,
      // readAncestors (server/machine/proc.ts) returns the pid it starts from and every ancestor.
      // This is the plugin's subprocess, so the plugin, the daemon worker and the supervisor are
      // protected.
      selfPid: process.pid,
      stop: (pid) => void process.kill(pid, "SIGTERM"),
      sleep: (ms) => delay(ms, undefined, { ref: false }),
    },
    skillFolders: hostSkillFolders(process.env, homedir()),
    hostTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    schedules: createLocalSchedules({ clock: nodeClock, log }),
  });
}
