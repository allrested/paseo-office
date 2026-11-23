import {
  defineAgentTool,
  type PluginHandlerContext,
  type PluginHookAgent,
  type PluginServerContext,
  type PluginSessionOpenRequest,
  type PluginSettingsState,
} from "@getpaseo/plugin/server";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { createOfficePlugin } from "./index.server.js";
import { EMPTY_BOARDS, type BoardStore } from "./server/board-store.js";
import { emptyChat, type ChatData, type ChatStore } from "./server/chat-store.js";
import { createFakeClock, settle } from "./server/fake-clock.js";
import type { LocalSchedules, OfficeCadence } from "./server/local-schedules.js";
import {
  NO_SAVED_TRACKERS,
  type SavedTrackers,
  type TrackerCredentialsStore,
} from "./server/tracker-credentials.js";
import {
  EMPTY_INCIDENTS,
  type IncidentsData,
  type IncidentsStore,
} from "./server/incidents-store.js";
import type { NotesStore, StoredNotes } from "./server/notes-writer.js";
import type { DutiesFile } from "./server/duty-service.js";
import { chatT } from "./shared/chat-words.js";
import { chatRpc, type ChatChange, type ChatMessage } from "./shared/contracts.js";
import type { officeHostSettings } from "./shared/settings.js";

type SettingsState = PluginSettingsState<typeof officeHostSettings.schema>;
type Handler = (input: object, context: PluginHandlerContext) => unknown;
type SettingsListener = (state: SettingsState) => void | Promise<void>;

interface Recorded {
  hooks: Map<string, Handler>;
  handlers: Map<string, Handler>;
  reads: number;
  /** Who follows the settings: the daemon calls each after a save. */
  listeners: Set<SettingsListener>;
  /**
   * The office's calls on its schedules, as "upsert <name> <expression> <zone>",
   * "upsert <name> every <ms>" or "remove <name>".
   */
  schedules: string[];
  /** When set, a schedule's save rejects with it. */
  scheduleFailure: Error | null;
  /** The handlers that answer due schedules, by handler name. */
  scheduleRuns: Map<string, (dueAt: number) => Promise<void>>;
}

interface Sent {
  agentId: string;
  text: string;
  options: unknown;
}

const SUNDAY_TO_THURSDAY = [0, 1, 2, 3, 4];
const NO_NOTES = {
  notesFolder: "",
  notesTimeZone: "",
  notesMode: "",
  notesDays: SUNDAY_TO_THURSDAY,
};
const NO_TRACKERS = {
  jiraProjects: "",
  sentryOrg: "",
  sentryProjects: "",
  weatherMode: "off" as const,
  weatherManual: "season" as const,
  weatherUrl: "",
  sentryUrl: "https://sentry.io",
};
const ON: SettingsState = {
  status: "ready",
  revision: "1",
  values: {
    archiveOnDeparture: false,
    agentTools: true,
    ...NO_NOTES,
    ...NO_TRACKERS,
    floorPlan: "pro",
  },
};
const OFF: SettingsState = {
  status: "ready",
  revision: "2",
  values: {
    archiveOnDeparture: false,
    agentTools: false,
    ...NO_NOTES,
    ...NO_TRACKERS,
    floorPlan: "pro",
  },
};
const OWN_TOOL = defineAgentTool({
  name: "other_tool",
  description: "Another plugin's tool",
  input: z.object({}),
  execute: () => ({}),
});

function cadenceText(cadence: OfficeCadence): string {
  if (cadence.type === "every") return `every ${cadence.everyMs}`;
  return `${cadence.expression} ${cadence.timezone}`;
}

/** The parts of the daemon's plugin API that the office calls. */
function fakeServer(recorded: Recorded, read: () => Promise<SettingsState>): PluginServerContext {
  // A partial fake: only the calls the office makes, so it is cast to the SDK's full interface.
  return {
    registerSettings: () => ({
      read: () => {
        recorded.reads += 1;
        return read();
      },
      subscribe: (listener: SettingsListener) => {
        recorded.listeners.add(listener);
        return () => {
          recorded.listeners.delete(listener);
        };
      },
    }),
    handle: (contract: { name: string }, handler: Handler) => {
      recorded.handlers.set(contract.name, handler);
    },
    addHook: (name: string, hook: Handler) => {
      recorded.hooks.set(name, hook);
      return () => {
        recorded.hooks.delete(name);
      };
    },
  } as unknown as PluginServerContext;
}

/** The office's own schedule engine, recording its calls and keeping the handlers it is given. */
function recordingSchedules(recorded: Recorded): LocalSchedules {
  return {
    upsert: async ({ name, cadence }) => {
      recorded.schedules.push(`upsert ${name} ${cadenceText(cadence)}`);
      if (recorded.scheduleFailure) throw recorded.scheduleFailure;
      return { id: "s1", nextRunAt: null };
    },
    remove: async (name) => {
      recorded.schedules.push(`remove ${name}`);
      return false;
    },
    list: async () => [],
    handle: (handler, run) => {
      recorded.scheduleRuns.set(handler, run);
      return () => {
        recorded.scheduleRuns.delete(handler);
      };
    },
    stop: () => undefined,
  };
}

/** A subscribed list as the client gives it: the snapshot at once, then nothing. */
function listOf(entries: object[]) {
  return {
    entries,
    pageInfo: { hasMore: false, nextCursor: null },
    subscription: {
      subscribe: (observer: { snapshot(snapshot: { entries: object[] }): void }) => {
        observer.snapshot({ entries });
        return () => undefined;
      },
      release: async () => undefined,
    },
  };
}

/** What the fake daemon lists and reads: the directory's agents, and each agent's timeline. */
interface FakeDirectory {
  agents: object[];
  timelines: Map<string, { turnId: string; item: object }[]>;
  /** What plugins keep on the workspace w1; a null value is a removed key. */
  workspaceMetadata?: Record<string, unknown>;
  /** Thrown by a metadata write, as a host without entity metadata does. */
  metadataFailure?: Error;
}

/** An idle agent as the daemon's agent list gives it. */
function listedAgent(id: string, title: string): object {
  return {
    id,
    title,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    createdAt: "2026-11-11T08:00:00.000Z",
    pendingPermissions: [],
  };
}

interface Writers {
  /** The agents created, as "<folder> <provider> <title>". */
  created: string[];
  prompts: string[];
  /** The mode each was created in. */
  modes: (string | undefined)[];
  archived: string[];
}

/** The daemon's API as hooks and handlers receive it: every agent exists, with the status given. */
function fakeContext(
  statuses: Map<string, string>,
  sent: Sent[],
  writers: Writers,
  directory: FakeDirectory,
): PluginHandlerContext & { signal: AbortSignal } {
  return {
    signal: new AbortController().signal,
    // A partial fake: only the calls the office makes, cast to the SDK's full API.
    paseo: {
      providers: {
        waitForReady: async () => ({
          entries: [
            {
              provider: "claude",
              status: "ready",
              enabled: true,
              label: "Claude",
              defaultModeId: "auto",
              modes: [
                { id: "plan", label: "Plan Mode" },
                { id: "acceptEdits", label: "Accept File Edits" },
                { id: "auto", label: "Auto mode" },
                { id: "bypassPermissions", label: "Bypass" },
              ],
              models: [{ id: "opus", isDefault: true }],
            },
          ],
        }),
      },
      workspaces: {
        ref: (id: string) => ({
          refresh: async () =>
            id === "w1" ? { name: "api", metadata: directory.workspaceMetadata } : null,
          setMetadata: async (patch: Record<string, unknown>) => {
            if (directory.metadataFailure) throw directory.metadataFailure;
            directory.workspaceMetadata = { ...directory.workspaceMetadata, ...patch };
          },
        }),
        list: async () => listOf([]),
        open: async (cwd: string) => ({
          id: "wks_notes",
          directory: cwd,
          agents: {
            create: async (options: {
              config: { provider: string; modeId?: string };
              title: string;
              prompt: string;
            }) => {
              writers.created.push(`${cwd} ${options.config.provider} ${options.title}`);
              writers.prompts.push(options.prompt);
              writers.modes.push(options.config.modeId);
              const id = `writer-${writers.created.length}`;
              statuses.set(id, "running");
              return { id };
            },
          },
        }),
      },
      agents: {
        list: async () => listOf(directory.agents.map((agent) => ({ agent }))),
        ref: (agentId: string) => ({
          timeline: {
            refetch: async () => ({ entries: directory.timelines.get(agentId) ?? [] }),
          },
          refresh: async () => ({
            agent: {
              id: agentId,
              status: statuses.get(agentId) ?? "idle",
              archivedAt: null,
              pendingPermissions: [],
            },
            project: null,
          }),
          send: async (text: string, options?: unknown) => {
            sent.push({ agentId, text, options });
          },
          commands: async () => ({
            agentId,
            commands: [
              { name: "compact", description: "", argumentHint: "" },
              { name: "clear", description: "", argumentHint: "" },
            ],
            error: null,
            requestId: "r",
          }),
          archive: async () => {
            writers.archived.push(agentId);
            return { archivedAt: "2026-11-11T09:05:00.000Z" };
          },
        }),
      },
    } as unknown as PluginHandlerContext["paseo"],
  };
}

function memoryNotesStore(): NotesStore & { kept: StoredNotes | null } {
  const store = {
    kept: null as StoredNotes | null,
    load: async () => store.kept,
    save: async (state: StoredNotes) => {
      store.kept = state;
    },
  };
  return store;
}

function memoryIncidentsStore(): IncidentsStore & { kept: IncidentsData } {
  // Copied on each load and save, as the file is.
  const store = {
    kept: structuredClone(EMPTY_INCIDENTS),
    load: async () => structuredClone(store.kept),
    save: async (data: IncidentsData) => {
      store.kept = structuredClone(data);
    },
  };
  return store;
}

function memoryTrackerStore(
  kept: SavedTrackers = NO_SAVED_TRACKERS,
): TrackerCredentialsStore & { kept: SavedTrackers } {
  const store = {
    kept,
    load: async () => structuredClone(store.kept),
    save: async (saved: SavedTrackers) => {
      store.kept = structuredClone(saved);
    },
  };
  return store;
}

function memoryChatStore(): ChatStore & { kept: ChatData } {
  // Copied on each load and save, as the file is.
  const store = {
    kept: emptyChat(),
    load: async () => structuredClone(store.kept),
    save: async (data: ChatData) => {
      store.kept = structuredClone(data);
    },
  };
  return store;
}

function memoryStore(): BoardStore {
  let current = EMPTY_BOARDS;
  return {
    load: async () => current,
    save: async (data) => {
      current = data;
    },
  };
}

function openRequest(overrides: Partial<PluginSessionOpenRequest>): PluginSessionOpenRequest {
  return {
    agentId: "agent-1",
    workspaceId: "w1",
    provider: "claude",
    cwd: "/workspace",
    reason: "create",
    purpose: "interactive",
    title: "Planner",
    background: false,
    labels: {},
    metadata: {},
    tools: [OWN_TOOL],
    env: {},
    mcpServers: {},
    ...overrides,
  };
}

function hookAgent(id: string): PluginHookAgent {
  return {
    id,
    workspaceId: "w1",
    parentAgentId: null,
    provider: "claude",
    cwd: "/workspace",
    title: null,
    background: false,
    metadata: {},
  };
}

/**
 * `env` is the daemon's environment the trackers' variables are read from; empty by default.
 * `chatStore` replaces the chat's memory store.
 */
function setup(
  read: () => Promise<SettingsState>,
  options: {
    env?: NodeJS.ProcessEnv;
    fetchFn?: typeof fetch;
    chatStore?: ChatStore;
    /** The tracker connections saved from the settings; none by default. */
    savedTrackers?: SavedTrackers;
    /** The kept duty list; an empty one by default, so no duty takes a post id. Null: none kept. */
    duties?: DutiesFile | null;
    /** Gives the fake server extras, as a host that kept plugin schedules has. */
    server?: (base: PluginServerContext) => PluginServerContext;
    /** The clock's start; Wednesday 11 November 2026, 12:00 in Riyadh by default. */
    start?: number;
  } = {},
) {
  const recorded: Recorded = {
    hooks: new Map(),
    handlers: new Map(),
    reads: 0,
    listeners: new Set(),
    schedules: [],
    scheduleFailure: null,
    scheduleRuns: new Map(),
  };
  const logs: string[] = [];
  const sent: Sent[] = [];
  const statuses = new Map<string, string>();
  const stopped: number[] = [];
  const writers: Writers = { created: [], prompts: [], modes: [], archived: [] };
  const directory: FakeDirectory = { agents: [], timelines: new Map() };
  const notesStore = memoryNotesStore();
  const incidentsStore = memoryIncidentsStore();
  const trackerStore = memoryTrackerStore(options.savedTrackers);
  const chatStore = options.chatStore ?? memoryChatStore();
  const clock = createFakeClock(options.start ?? Date.parse("2026-11-11T09:00:00.000Z"));
  const context = fakeContext(statuses, sent, writers, directory);
  const baseServer = fakeServer(recorded, read);
  const stop = createOfficePlugin(options.server?.(baseServer) ?? baseServer, {
    store: memoryStore(),
    notesStore,
    incidentsStore,
    trackerStore,
    chatStore,
    fetchFn: options.fetchFn ?? (() => Promise.reject(new Error("Unexpected weather request"))),
    tenureFile: { load: async () => null, save: async () => {} },
    dutiesFile: {
      load: async () =>
        options.duties === undefined ? { version: 1, duties: [] } : options.duties,
      save: async () => {},
    },
    liftFile: { load: async () => null, save: async () => {} },
    env: options.env ?? {},
    clock,
    log: (message) => logs.push(message),
    world: { read: async () => "the scene", readStreet: async () => "{}" },
    words: { read: async (language) => "words of " + language },
    machine: {
      procRoot: "/nonexistent-proc",
      cgroupRoot: "/nonexistent-cgroup",
      platform: "linux",
      selfPid: 1,
      stop: (pid) => void stopped.push(pid),
      sleep: async () => undefined,
    },
    skillFolders: [{ label: ".claude", path: "/nonexistent-skills" }],
    hostTimeZone: "Asia/Riyadh",
    schedules: recordingSchedules(recorded),
  });
  async function open(
    overrides: Partial<PluginSessionOpenRequest> = {},
  ): Promise<PluginSessionOpenRequest | undefined> {
    return recorded.hooks.get("agent.open.before")?.(
      { request: openRequest(overrides) },
      context,
    ) as PluginSessionOpenRequest | undefined;
  }
  return {
    recorded,
    logs,
    sent,
    statuses,
    stopped,
    writers,
    directory,
    notesStore,
    incidentsStore,
    trackerStore,
    clock,
    context,
    stop,
    open,
  };
}

test("an interactive session keeps its own tools and gets the three office tools", async () => {
  const { open, stop } = setup(async () => ON);
  const result = await open();
  expect(result?.tools.map((tool) => tool.name)).toEqual([
    "other_tool",
    "office_read",
    "office_post",
    "office_update",
  ]);
  // Nothing else of the request changes.
  expect({ ...result, tools: [] }).toEqual(openRequest({ tools: [] }));
  await stop();
});

test("a session opened before the setting is known waits for it, and gets no tools when it is off", async () => {
  let answer: (state: SettingsState) => void = () => undefined;
  const pending = new Promise<SettingsState>((resolve) => {
    answer = resolve;
  });
  const { open, stop } = setup(() => pending);
  const opening = open();
  answer(OFF);
  expect(await opening).toBeUndefined();
  await stop();
});

test("the setting is read at each open, so a change holds from the next session on", async () => {
  // The office reads the settings at load too, for the notes schedule and the writer.
  const states = [ON, OFF, ON];
  let atLoad: number | null = null;
  const { open, stop, recorded } = setup(async () =>
    atLoad === null ? ON : (states[recorded.reads - atLoad - 1] ?? ON),
  );
  await settle();
  atLoad = recorded.reads;
  const results = [await open(), await open(), await open()];
  expect(results.map((result) => result?.tools.length)).toEqual([4, undefined, 4]);
  await stop();
});

test("a session opened to read history gets no tools, and the setting is not read for it", async () => {
  const { open, stop, recorded } = setup(async () => ON);
  await settle();
  const atLoad = recorded.reads;
  expect(await open({ purpose: "history" })).toBeUndefined();
  expect(recorded.reads).toBe(atLoad);
  await stop();
});

test("a setting that cannot be read leaves the session as it is and is logged", async () => {
  const { open, stop, logs } = setup(async () => {
    throw new Error("settings store is down");
  });
  expect(await open()).toBeUndefined();
  await settle();
  // The reads at load, for the notes schedule and the writer, fail too.
  expect([...logs].sort()).toEqual(
    [
      "[office] The office's settings cannot be read: settings store is down",
      "[office] agent.open.before failed: settings store is down",
      "[office] notes writer load failed: settings store is down",
    ].sort(),
  );
  await stop();
});

test("settings that are not ready are logged, and both schedules' cards show why", async () => {
  const invalid: SettingsState = {
    status: "invalid",
    revision: "bad",
    error: "notesFolder: Required",
  };
  const { recorded, context, logs, stop } = setup(async () => invalid);
  await settle();
  const message = "The office's settings cannot be read: notesFolder: Required";
  expect(logs).toContain(`[office] ${message}`);
  // The duty board's zone is then the host's: its 8:00 run still comes.
  expect(recorded.schedules).toContain("upsert duty-board 0 8 * * * Asia/Riyadh");
  const events: { type: string; state?: { notes?: unknown; incidents?: unknown } }[] = [];
  const leaving = new AbortController();
  const done = recorded.handlers.get("office.state")?.({}, {
    ...context,
    signal: leaving.signal,
    push: async (event: { type: string }) => void events.push(event),
  } as never);
  await settle();
  expect(events.at(-1)?.state?.notes).toMatchObject({ scheduleError: message });
  expect(events.at(-1)?.state?.incidents).toMatchObject({ scheduleError: message });
  leaving.abort();
  await done;
  await stop();
});

function notesSettings(
  notesFolder: string,
  notesTimeZone: string,
  notesDays = SUNDAY_TO_THURSDAY,
): SettingsState {
  return {
    status: "ready",
    revision: notesFolder + notesTimeZone + notesDays.join(""),
    values: {
      archiveOnDeparture: false,
      agentTools: true,
      notesFolder,
      notesTimeZone,
      notesMode: "",
      notesDays,
      ...NO_TRACKERS,
      floorPlan: "pro",
    },
  };
}

test("the notes schedule follows the host settings from load and on each save, until the office stops", async () => {
  const { recorded, stop } = setup(async () => notesSettings("/notes", ""));
  const notesCalls = () => recorded.schedules.filter((call) => call.includes(" standup-notes"));
  await settle();
  expect(notesCalls()).toEqual(["upsert standup-notes 0 8 * * 0,1,2,3,4 Asia/Riyadh"]);

  const follow = (state: SettingsState) =>
    Promise.all([...recorded.listeners].map((listener) => listener(state)));
  await follow(notesSettings("/notes", "Europe/Berlin"));
  // A document that is not valid leaves the schedule as it is.
  await follow({ status: "invalid", revision: "x", error: "Expected string" });
  await follow(notesSettings("", "Europe/Berlin"));
  await settle();
  expect(notesCalls()).toEqual([
    "upsert standup-notes 0 8 * * 0,1,2,3,4 Asia/Riyadh",
    "upsert standup-notes 0 8 * * 0,1,2,3,4 Europe/Berlin",
    "remove standup-notes",
  ]);

  await stop();
  expect(recorded.listeners.size).toBe(0);
});

test("a save that changes only the notes days sets the schedule again; no day removes it", async () => {
  const { recorded, stop } = setup(async () => notesSettings("/notes", ""));
  const notesCalls = () => recorded.schedules.filter((call) => call.includes(" standup-notes"));
  await settle();
  const follow = (state: SettingsState) =>
    Promise.all([...recorded.listeners].map((listener) => listener(state)));
  await follow(notesSettings("/notes", "", [1, 2, 3, 4, 5]));
  await follow(notesSettings("/notes", "", []));
  await settle();
  expect(notesCalls()).toEqual([
    "upsert standup-notes 0 8 * * 0,1,2,3,4 Asia/Riyadh",
    "upsert standup-notes 0 8 * * 1,2,3,4,5 Asia/Riyadh",
    "remove standup-notes",
  ]);
  await stop();
});

test("a post made through the board call wakes the agent it names over the daemon's API", async () => {
  const { recorded, sent, context, stop } = setup(async () => ON);
  const post = recorded.handlers.get("office.post.request");
  const result = await post?.({ board: "w1", kind: "note", text: "Your turn", to: "b" }, context);
  await settle();
  expect(result).toEqual({
    ok: true,
    post: {
      id: "p1",
      seq: 1,
      board: "w1",
      kind: "note",
      text: "Your turn",
      to: "b",
      author: "user",
      createdAt: "2026-11-11T09:00:00.000Z",
      updatedAt: "2026-11-11T09:00:00.000Z",
    },
  });
  expect(sent).toEqual([
    {
      agentId: "b",
      text: "Office board: 1 post(s) for you.\n- p1 from the user: Your turn",
      options: { activeTurnBehavior: "steer" },
    },
  ]);
  await stop();
});

test("a post for a running agent goes out when its turn ends", async () => {
  const { recorded, sent, statuses, context, stop } = setup(async () => ON);
  statuses.set("b", "running");
  const post = recorded.handlers.get("office.post.request");
  await post?.({ board: "w1", kind: "note", text: "Your turn", to: "b" }, context);
  await settle();
  expect(sent).toEqual([]);
  statuses.set("b", "idle");
  await recorded.hooks.get("agent.turn.after")?.(
    { agent: hookAgent("b"), turnId: "t1", outcome: { kind: "completed" } },
    context,
  );
  await settle();
  expect(sent.map((item) => item.agentId)).toEqual(["b"]);
  await stop();
});

test("the machine is read for a subscriber and no longer once it left", async () => {
  const { recorded, clock, context, stop } = setup(async () => ON);
  const events: unknown[] = [];
  const leaving = new AbortController();
  const machine = recorded.handlers.get("office.machine");
  const done = machine?.({}, {
    ...context,
    signal: leaving.signal,
    push: async (event: unknown) => void events.push(event),
  } as never);
  // The reading asks the file system, which takes longer than a round of promises.
  for (let round = 0; round < 200 && events.length === 0; round += 1) await settle();

  // No /proc at the test's root: a reading with nothing in it, not a failure. The test's host has
  // no closeRuntime on an agent's handle, as stock Paseo's has none.
  expect(events).toEqual([
    {
      type: "reading",
      machine: {
        readAt: "2026-11-11T09:00:00.000Z",
        memory: null,
        cpuPercent: null,
        agents: [],
        canCloseRuntime: false,
      },
    },
  ]);
  // The hourly prune, the chat's clock and the next reading.
  expect(clock.pending()).toBe(3);
  leaving.abort();
  await done;
  expect(clock.pending()).toBe(2);
  await stop();
});

test("a cleanup answers for each agent once, and leaves one that could not resume", async () => {
  const { recorded, statuses, stopped, context, stop } = setup(async () => ON);
  statuses.set("busy", "running");
  const cleanup = recorded.handlers.get("office.machine.cleanup.request");

  expect(await cleanup?.({ agentIds: ["busy", "idle", "busy"] }, context)).toEqual({
    results: [
      {
        agentId: "busy",
        ok: false,
        error: "The agent is not idle; clean up once its turn has ended",
      },
      {
        agentId: "idle",
        ok: false,
        error: "This agent has no saved session to resume, so it stays open",
      },
    ],
  });
  expect(stopped).toEqual([]);
  await stop();
});

test("the janitor sends the provider's command to an idle agent and refuses one at work", async () => {
  const { recorded, sent, statuses, context, stop } = setup(async () => ON);
  statuses.set("busy", "running");
  const janitor = recorded.handlers.get("office.janitor.request");

  expect(await janitor?.({ agentId: "idle", action: "clean" }, context)).toEqual({
    ok: true,
    error: null,
  });
  expect(await janitor?.({ agentId: "idle", action: "reset" }, context)).toEqual({
    ok: true,
    error: null,
  });
  expect(await janitor?.({ agentId: "busy", action: "reset" }, context)).toEqual({
    ok: false,
    error: "The agent is at work; reset it once its turn has ended",
  });
  expect(sent).toEqual([
    { agentId: "idle", text: "/compact", options: undefined },
    { agentId: "idle", text: "/clear", options: undefined },
  ]);
  await stop();
});

test("a script's log is refused while no office is open, when the host has no directory", async () => {
  const { recorded, context, stop } = setup(async () => ON);
  const log = recorded.handlers.get("office.script.log.request");
  expect(await log?.({ workspaceId: "w1", script: "dev" }, context)).toEqual({
    ok: false,
    error: "This host does not know the script",
  });
  await stop();
});

test("the 3D page script is answered from the world the plugin carries", async () => {
  const { recorded, context, stop } = setup(async () => ON);
  const world = recorded.handlers.get("office.world.request");
  expect(await world?.({}, context)).toBe("the scene");
  expect(await recorded.handlers.get("office.world.street")?.({}, context)).toBe("{}");
  expect(await recorded.handlers.get("office.world.words")?.({ language: "vi" }, context)).toBe(
    "words of vi",
  );
  await stop();
});

test("the skills are read from the host's folders, and no workspace's while no office is open", async () => {
  const { recorded, context, stop } = setup(async () => ON);
  const skills = recorded.handlers.get("office.skills.request");
  expect(await skills?.({}, context)).toEqual({
    host: [],
    workspaces: {},
    readAt: "2026-11-11T09:00:00.000Z",
  });
  await stop();
});

test("the entry serves the office state, the 3D page script, the machine, the janitor, a script's log, the skills and the five board calls, and stopping removes its hooks and timers", async () => {
  const { recorded, clock, stop } = setup(async () => ON);
  await settle();
  expect([...recorded.handlers.keys()]).toEqual([
    "office.state",
    "office.world.street",
    "office.world.logo",
    "office.world.request",
    "office.world.words",
    "office.ssh.servers",
    "office.ssh.reading",
    "office.machine.details",
    "office.machine",
    "office.machine.cleanup.request",
    "office.janitor.request",
    "office.script.log.request",
    "office.skills.request",
    "office.notes.read.request",
    "office.post.request",
    "office.update.request",
    "office.delete.request",
    "office.board.clear_done.request",
    "office.set_wakes_paused.request",
    "office.duties.save.request",
    "office.duty.acted.request",
    "office.notes.write.request",
    "office.incidents.dismiss.request",
    "office.team.rename.request",
    "office.notes.modes.request",
    "office.trackers.save.request",
    "office.trackers.test.request",
    "office.chat.request",
    "office.life",
    "office.street.events",
    "office.home.departure",
    "office.tenure.request",
  ]);
  expect([...recorded.scheduleRuns.keys()]).toEqual(["standup-notes", "duty-board", "incidents"]);
  expect([...recorded.hooks.keys()]).toEqual([
    "agent.open.before",
    "agent.turn.after",
    "agent.close.after",
    "agent.archive.after",
    "workspace.archive.after",
  ]);
  // The hourly prune and the chat's 30 s clock are waiting.
  expect(clock.pending()).toBe(2);
  await stop();
  expect(recorded.hooks.size).toBe(0);
  expect(recorded.scheduleRuns.size).toBe(0);
  expect(clock.pending()).toBe(0);
});

/** Subscribes to office.state as a page does; `events` records what it is pushed. */
function openOffice(recorded: Recorded, context: PluginHandlerContext) {
  const events: { type: string; state?: { chat?: unknown }; change?: ChatChange }[] = [];
  const leaving = new AbortController();
  const done = recorded.handlers.get("office.state")?.({}, {
    ...context,
    signal: leaving.signal,
    push: async (event: { type: string }) => void events.push(event),
  } as never);
  return {
    events,
    async leave() {
      leaving.abort();
      await done;
    },
  };
}

test("a group message and its no-session reply reach both the open office and the next snapshot", async () => {
  const { recorded, context, stop } = setup(async () => ON);
  await settle();
  const first = openOffice(recorded, context);
  await settle();
  // The engine's own welcome line opens a new conversation.
  expect(first.events.at(-1)?.state?.chat).toMatchObject({
    messages: [{ kind: "sys" }],
    typing: [],
  });

  const chat = recorded.handlers.get("office.chat.request");
  expect(await chat?.({ op: "send", text: "hello" }, context)).toEqual({ ok: true });
  expect(first.events.filter((event) => event.type === "chat")).toMatchObject([
    { type: "chat", change: { op: "add", message: { from: "me", text: "hello", tag: "group" } } },
    {
      type: "chat",
      change: {
        op: "add",
        message: { from: "__director", tag: "delivery", reply: { text: "hello" } },
      },
    },
  ]);

  const second = openOffice(recorded, context);
  await settle();
  expect(second.events.at(-1)?.state?.chat).toMatchObject({
    messages: [
      { kind: "sys" },
      { from: "me", text: "hello" },
      { from: "__director", tag: "delivery", reply: { text: "hello" } },
    ],
  });
  await first.leave();
  await second.leave();
  await stop();
});

test("a chat call with a bad op is refused by the contract", () => {
  expect(chatRpc.input.safeParse({ op: "shout", text: "hello" }).success).toBe(false);
  expect(chatRpc.input.safeParse({ op: "send", text: "hello" }).success).toBe(true);
});

/** The messages the chat events of `events` added. */
function chatAdds(events: { type: string; change?: ChatChange }[]): ChatMessage[] {
  return events.flatMap(({ change }) => (change?.op === "add" ? [change.message] : []));
}

test("a turn that ends answers the chat message that named its agent, as a reply", async () => {
  const { recorded, context, directory, sent, logs, stop } = setup(async () => ON);
  directory.agents.push(listedAgent("a1", "Mjd"));
  await settle();
  const office = openOffice(recorded, context);
  await settle();

  const chat = recorded.handlers.get("office.chat.request");
  expect(await chat?.({ op: "send", text: "@Mjd hi" }, context)).toEqual({ ok: true });
  await settle();
  const mine = chatAdds(office.events).find((message) => message.from === "me");
  expect(sent).toEqual([
    {
      agentId: "a1",
      text: "Team chat message from you: @Mjd hi",
      options: { activeTurnBehavior: "steer", messageId: `office-chat-${mine!.id}` },
    },
  ]);

  directory.timelines.set("a1", [
    { turnId: "t1", item: { type: "user_message", text: "Team chat message from you: @Mjd hi" } },
    { turnId: "t1", item: { type: "assistant_message", text: "Hi, on it." } },
  ]);
  await recorded.hooks.get("agent.turn.after")?.(
    { agent: hookAgent("a1"), turnId: "t1", outcome: { kind: "completed" } },
    context,
  );
  await settle();
  expect(chatAdds(office.events)).toContainEqual(
    expect.objectContaining({
      from: "a1",
      name: "Mjd",
      text: "Hi, on it.",
      reply: { id: mine?.id, name: "Boss", text: "@Mjd hi" },
    }),
  );
  expect(logs).toEqual([]);
  await office.leave();
  await stop();
});

test("an archived agent of the office leaves the chat", async () => {
  const { recorded, context, directory, logs, stop } = setup(async () => ON);
  directory.agents.push(listedAgent("a1", "Mjd"));
  await settle();
  const office = openOffice(recorded, context);
  await settle();

  await recorded.hooks.get("agent.archive.after")?.(
    { agent: hookAgent("a1"), archivedAt: "2026-11-11T09:01:00.000Z" },
    context,
  );
  expect(chatAdds(office.events)).toEqual([
    expect.objectContaining({ kind: "sys", text: chatT("chat.sys.left", { name: "Mjd" }) }),
  ]);
  expect(logs).toEqual([]);
  await office.leave();
  await stop();
});

test("an agent closed while the chat waits for it stops typing", async () => {
  const { recorded, context, directory, logs, stop } = setup(async () => ON);
  directory.agents.push(listedAgent("a1", "Mjd"));
  await settle();
  const office = openOffice(recorded, context);
  await settle();

  const chat = recorded.handlers.get("office.chat.request");
  expect(await chat?.({ op: "send", text: "@Mjd hi" }, context)).toEqual({ ok: true });
  await settle();
  const typingNames = () =>
    office.events.flatMap(({ change }) => (change?.op === "typing" ? [change.names] : []));
  expect(typingNames().at(-1)).toEqual(["Mjd"]);

  await recorded.hooks.get("agent.close.after")?.({ agent: hookAgent("a1") }, context);
  expect(typingNames().at(-1)).toEqual([]);
  expect(logs).toEqual([]);
  await office.leave();
  await stop();
});

test("a chat that cannot start answers its call with an error and the rest of the office goes on", async () => {
  const broken: ChatStore = {
    load: async () => {
      throw new Error("chat.json is locked");
    },
    save: async () => undefined,
  };
  const { recorded, context, logs, stop } = setup(async () => ON, { chatStore: broken });
  await settle();
  const chat = recorded.handlers.get("office.chat.request");
  await expect(chat?.({ op: "send", text: "hello" }, context)).rejects.toThrow(
    "The team chat did not start",
  );
  const post = recorded.handlers.get("office.post.request");
  expect(await post?.({ board: "w1", kind: "note", text: "Still here" }, context)).toMatchObject({
    ok: true,
  });
  expect(logs).toContain("[office] chat unavailable: chat.json is locked");
  await stop();
});

test("the chat's clock beats every 30 s until the office stops", async () => {
  const { clock, stop } = setup(async () => ON);
  await settle();
  // The hourly prune and the chat's clock.
  expect(clock.pending()).toBe(2);
  clock.advance(30_000);
  expect(clock.pending()).toBe(2);
  clock.advance(30_000);
  expect(clock.pending()).toBe(2);
  await stop();
  expect(clock.pending()).toBe(0);
});

test("an office stopped before its chat has loaded stops the chat's clock too", async () => {
  let load: (data: ChatData) => void = () => undefined;
  const slow: ChatStore = {
    load: () =>
      new Promise<ChatData>((resolve) => {
        load = resolve;
      }),
    save: async () => undefined,
  };
  const { clock, stop } = setup(async () => ON, { chatStore: slow });
  await settle();
  const stopping = stop();
  load(emptyChat());
  await stopping;
  await settle();
  expect(clock.pending()).toBe(0);
});

const NOTES_FOLDER = await mkdtemp(join(tmpdir(), "office-notes-"));
afterAll(() => rm(NOTES_FOLDER, { recursive: true, force: true }));

/** Host settings with the notes folder set to a directory that exists. */
const NOTES: SettingsState = {
  status: "ready",
  revision: "notes",
  values: {
    archiveOnDeparture: false,
    agentTools: true,
    ...NO_NOTES,
    notesFolder: NOTES_FOLDER,
    ...NO_TRACKERS,
    floorPlan: "pro",
  },
};

/** The writer leaves the day's entry in the notes: the fake clock's day in Asia/Riyadh. */
function writeEntry(): Promise<void> {
  const text = "# Notes\n\n---\n\n## 11 November 2026\n\nB\n";
  return writeFile(join(NOTES_FOLDER, "daily-standup-202611.md"), text, "utf8");
}

test("a team is given a name of the office's own, kept on its workspace, and an empty one takes it back", async () => {
  const { recorded, directory, context, logs, stop } = setup(async () => ON);
  const rename = recorded.handlers.get("office.team.rename.request");
  expect(await rename?.({ workspaceId: "w1", name: "  Payments \n team " }, context)).toEqual({
    ok: true,
    name: "Payments team",
  });
  expect(directory.workspaceMetadata).toEqual({ "office.team.name": "Payments team" });
  expect(await rename?.({ workspaceId: "w1", name: " " }, context)).toEqual({
    ok: true,
    name: "api",
  });
  expect(directory.workspaceMetadata).toEqual({ "office.team.name": null });

  expect(await rename?.({ workspaceId: "gone", name: "x" }, context)).toEqual({
    ok: false,
    problem: "The workspace is gone",
  });
  directory.metadataFailure = new Error("This host does not keep plugin data on workspaces");
  expect(await rename?.({ workspaceId: "w1", name: "x" }, context)).toEqual({
    ok: false,
    problem: "This host does not keep plugin data on workspaces",
  });
  expect(logs.at(-1)).toContain("team rename failed");
  await stop();
});

test("the writer starts in the settings' mode, and accepts edits while none is set", async () => {
  const withMode = (notesMode: string): SettingsState => ({
    status: "ready",
    revision: notesMode,
    values: {
      ...NO_TRACKERS,
      ...NO_NOTES,
      notesFolder: NOTES_FOLDER,
      notesMode,
      archiveOnDeparture: false,
      agentTools: true,
      floorPlan: "pro",
    },
  });
  let saved: SettingsState = NOTES;
  const { recorded, writers, context, stop } = setup(async () => saved);
  const modes = recorded.handlers.get("office.notes.modes.request");
  expect(await modes?.({}, context)).toEqual({
    ok: true,
    provider: "Claude",
    modes: [
      { id: "acceptEdits", label: "Accept File Edits" },
      { id: "auto", label: "Auto mode" },
      { id: "bypassPermissions", label: "Bypass" },
    ],
    modeId: "acceptEdits",
    fellBack: false,
  });
  // Codex's mode on a host whose writer is Claude: said, and the writer accepts edits.
  saved = withMode("full-access");
  expect(await modes?.({}, context)).toMatchObject({ modeId: "acceptEdits", fellBack: true });

  saved = withMode("bypassPermissions");
  const write = recorded.handlers.get("office.notes.write.request");
  expect(await write?.({}, context)).toEqual({ started: true });
  expect(writers.modes).toEqual(["bypassPermissions"]);
  await stop();
});

test("the bell's request starts one writer in the notes folder, and its good end with the entry archives it", async () => {
  const { recorded, writers, notesStore, context, clock, stop } = setup(async () => NOTES);
  const write = recorded.handlers.get("office.notes.write.request");
  expect(await write?.({}, context)).toEqual({ started: true });
  expect(await write?.({}, context)).toEqual({ started: false });
  expect(writers.created).toEqual([`${NOTES_FOLDER} claude/opus Stand-up notes`]);
  expect(writers.prompts[0]).toContain("daily-standup-202611.md");
  expect(notesStore.kept?.writerId).toBe("writer-1");

  await writeEntry();
  await recorded.hooks.get("agent.turn.after")?.(
    { agent: hookAgent("writer-1"), turnId: "t1", outcome: { kind: "completed" } },
    context,
  );
  expect(writers.archived).toEqual(["writer-1"]);
  expect(notesStore.kept).toEqual({
    writerId: null,
    writtenAt: clock.now(),
    failedAgentId: null,
    problem: null,
  });
  await stop();
});

test("the 8:00 run starts the writer with the run's Paseo API", async () => {
  const { recorded, writers, logs, clock, open, stop } = setup(async () => NOTES);
  await settle();
  // A run has no Paseo API of its own: a handler or hook brought it before.
  await open();
  await recorded.scheduleRuns.get("standup-notes")?.(clock.now());
  expect(writers.created).toHaveLength(1);
  expect(logs.filter((line) => line.includes("waiting for the Paseo API"))).toEqual([]);
  await stop();
});

const NOTES_WAITING =
  "[office] standup-notes run is waiting for the Paseo API: open the office, or let an agent open or end a turn";

test("a run due before any handler brought the Paseo API says so once and waits for it", async () => {
  const { recorded, writers, logs, clock, open, stop } = setup(async () => NOTES);
  await settle();
  const run = recorded.scheduleRuns.get("standup-notes")?.(clock.now());
  await settle();
  expect(writers.created).toHaveLength(0);
  // An hour later, the same day in Riyadh.
  clock.advance(60 * 60 * 1000);
  await open();
  await run;
  expect(writers.created).toHaveLength(1);
  expect(logs.filter((line) => line === NOTES_WAITING)).toHaveLength(1);
  await stop();
});

test("a notes run that could only start the next day starts no writer and says why", async () => {
  const { recorded, writers, logs, clock, open, stop } = setup(async () => NOTES);
  await settle();
  const run = recorded.scheduleRuns.get("standup-notes")?.(clock.now());
  await settle();
  clock.advance(24 * 60 * 60 * 1000);
  await open();
  await run;
  expect(writers.created).toHaveLength(0);
  expect(logs).toContain(
    "[office] standup-notes run dropped: it was due on 2026-11-11 and could only start on 2026-11-12",
  );
  await stop();
});

test("a stored schedule of an earlier version that cannot be removed is logged, and the other is still removed", async () => {
  const removed: string[] = [];
  const { logs, stop } = setup(async () => ON, {
    server: (base) =>
      ({
        ...base,
        schedules: {
          remove: async (name: string) => {
            if (name === "standup-notes") throw new Error("store is down");
            removed.push(name);
            return true;
          },
        },
      }) as unknown as PluginServerContext,
  });
  await settle();
  expect(removed).toEqual(["incidents"]);
  expect(
    logs.some((line) => line.includes("standup-notes") && line.includes("store is down")),
  ).toBe(true);
  await stop();
});

test("on a host that kept plugin schedules the office removes its two stored ones; on stock it touches none", async () => {
  const removed: string[] = [];
  const keeping = setup(async () => ON, {
    server: (base) =>
      ({
        ...base,
        schedules: {
          remove: async (name: string) => {
            removed.push(name);
            return true;
          },
        },
      }) as unknown as PluginServerContext,
  });
  await settle();
  expect(removed).toEqual(["standup-notes", "incidents"]);
  await keeping.stop();

  const stock = setup(async () => ON);
  await settle();
  expect(stock.logs).toEqual([]);
  await stock.stop();
});

test("a writer whose turn fails or is stopped is left, and its reason kept", async () => {
  const { recorded, writers, notesStore, statuses, context, stop } = setup(async () => NOTES);
  const write = recorded.handlers.get("office.notes.write.request");
  const turnEnded = recorded.hooks.get("agent.turn.after");
  await write?.({}, context);
  await turnEnded?.(
    {
      agent: hookAgent("writer-1"),
      turnId: "t1",
      outcome: { kind: "failed", error: { message: "Rate limited" } },
    },
    context,
  );
  expect(notesStore.kept).toMatchObject({ failedAgentId: "writer-1", problem: "Rate limited" });

  // A failed turn leaves the agent idle, so a new writer may start.
  statuses.set("writer-1", "idle");
  await write?.({}, context);
  await turnEnded?.(
    {
      agent: hookAgent("writer-2"),
      turnId: "t2",
      outcome: { kind: "canceled", reason: "interrupted" },
    },
    context,
  );
  expect(notesStore.kept).toMatchObject({ failedAgentId: "writer-2", problem: "interrupted" });
  expect(writers.archived).toEqual([]);
  await stop();
});

test("a writer closed by a graceful restart stays the office's: resumed it blocks the bell, and its end with the entry is recorded", async () => {
  const { recorded, writers, notesStore, statuses, context, clock, stop } = setup(
    async () => NOTES,
  );
  const write = recorded.handlers.get("office.notes.write.request");
  await write?.({}, context);
  // The daemon closes every agent as it shuts down.
  statuses.set("writer-1", "closed");
  await recorded.hooks.get("agent.close.after")?.({ agent: hookAgent("writer-1") }, context);
  expect(notesStore.kept).toMatchObject({
    writerId: null,
    failedAgentId: "writer-1",
    problem: "it was closed before it finished",
  });

  // Started again, the daemon resumes the writer's turn.
  statuses.set("writer-1", "running");
  expect(await write?.({}, context)).toEqual({ started: false });
  expect(writers.created).toHaveLength(1);
  await writeEntry();
  await recorded.hooks.get("agent.turn.after")?.(
    { agent: hookAgent("writer-1"), turnId: "t2", outcome: { kind: "completed" } },
    context,
  );
  expect(writers.archived).toEqual(["writer-1"]);
  expect(notesStore.kept).toEqual({
    writerId: null,
    writtenAt: clock.now(),
    failedAgentId: null,
    problem: null,
  });
  await stop();
});

test("a writer archived by someone else frees the bell", async () => {
  const { recorded, writers, context, stop } = setup(async () => NOTES);
  const write = recorded.handlers.get("office.notes.write.request");
  await write?.({}, context);
  await recorded.hooks.get("agent.archive.after")?.(
    { agent: hookAgent("writer-1"), archivedAt: "2026-11-11T09:01:00.000Z" },
    context,
  );
  expect(await write?.({}, context)).toEqual({ started: true });
  expect(writers.created).toHaveLength(2);
  await stop();
});

test("an open office receives host branding, saved overrides and cleared defaults", async () => {
  const { recorded, context, stop } = setup(async () => NOTES, {
    env: { PASEO_BRAND_NAME: "Host office", PASEO_BRAND_COLOR: "#224466" },
  });
  await settle();
  const events: { type: string; state?: { brand?: unknown } }[] = [];
  const leaving = new AbortController();
  const done = recorded.handlers.get("office.state")?.({}, {
    ...context,
    signal: leaving.signal,
    push: async (event: { type: string }) => {
      if (event.type === "snapshot") events.push(event);
    },
  } as never);
  try {
    await settle();
    const latest = () => events.at(-1)?.state?.brand;
    expect(latest()).toEqual({ name: "Host office", color: "#224466" });
    for (const brandName of ["Studio", ""]) {
      const state = { ...NOTES, values: { ...NOTES.values, brandName } } as SettingsState;
      await Promise.all([...recorded.listeners].map((listener) => listener(state)));
      await settle();
      expect(latest()).toEqual({ name: brandName || "Host office", color: "#224466" });
    }
  } finally {
    leaving.abort();
    await done;
    await stop();
  }
});

test("an open office gets the notes state in its snapshot, and a schedule that fails after a save", async () => {
  const { recorded, context, stop } = setup(async () => NOTES);
  await settle();
  const events: { type: string; state?: { notes?: unknown } }[] = [];
  const leaving = new AbortController();
  const done = recorded.handlers.get("office.state")?.({}, {
    ...context,
    signal: leaving.signal,
    push: async (event: { type: string }) => void events.push(event),
  } as never);
  await settle();
  expect(events.at(-1)?.state?.notes).toEqual({
    folderSet: true,
    writing: false,
    writtenAt: null,
    failedAgentId: null,
    problem: null,
    scheduleError: null,
  });

  recorded.scheduleFailure = new Error("Invalid cron time zone: Mars/Base");
  const zone = {
    ...NOTES,
    revision: "zone",
    values: { ...NOTES.values, notesTimeZone: "Mars/Base" },
  } as SettingsState;
  await Promise.all([...recorded.listeners].map((listener) => listener(zone)));
  await settle();
  expect(events.at(-1)?.state?.notes).toMatchObject({
    scheduleError: "Invalid cron time zone: Mars/Base",
  });

  leaving.abort();
  await done;
  await stop();
});

const servers: Server[] = [];

afterEach(async () => {
  const closing = servers.splice(0).map(
    (server) =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  await Promise.all(closing);
});

interface JiraStandIn {
  base: string;
  /** The JQL of each search. */
  searches: string[];
  /** While set, every request is refused with HTTP 401. */
  refusing: boolean;
}

/** A local server standing in for Jira, with one bug made at 08:58 UTC on the fake clock's day. */
async function jiraStandIn(): Promise<JiraStandIn> {
  const searches: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (standIn.refusing) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ errorMessages: ["Unauthorized"] }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    if (url.pathname === "/rest/api/3/myself") {
      res.end(JSON.stringify({ timeZone: "UTC" }));
      return;
    }
    searches.push(url.searchParams.get("jql") ?? "");
    const created = "2026-11-11T08:58:00.000+0000";
    const bug = { key: "OPS-7", fields: { summary: "Checkout fails on a split bill", created } };
    res.end(JSON.stringify({ issues: [bug] }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  const standIn = { base: `http://127.0.0.1:${address.port}`, searches, refusing: false };
  return standIn;
}

/** The three Jira variables, with placeholder values: no test holds a real token. */
function jiraVariables(base: string): NodeJS.ProcessEnv {
  return {
    ATLASSIAN_BASE_URL: base,
    ATLASSIAN_EMAIL: "office@example.test",
    ATLASSIAN_API_TOKEN: "placeholder-jira-token",
  };
}

/** Host settings that check Jira's OPS project for new bugs. */
const JIRA_ON: SettingsState = {
  status: "ready",
  revision: "jira",
  values: {
    archiveOnDeparture: false,
    agentTools: true,
    ...NO_NOTES,
    ...NO_TRACKERS,
    floorPlan: "pro",
    jiraProjects: "OPS",
  },
};

test("a due incidents run calls the check; dismiss answers its count", async () => {
  const jira = await jiraStandIn();
  const { recorded, incidentsStore, context, open, clock, stop } = setup(async () => JIRA_ON, {
    env: jiraVariables(jira.base),
  });
  await settle();
  // Checked 5 minutes ago, so the bug made since is news.
  incidentsStore.kept = {
    version: 1,
    trackers: { jira: { checkedAt: clock.now() - 300_000, seen: {} } },
    open: [],
  };
  // A run has no Paseo API of its own: a handler or hook brought it before.
  await open();
  await recorded.scheduleRuns.get("incidents")?.(clock.now());
  expect(jira.searches).toEqual([
    'project in ("OPS") AND issuetype = Bug AND created >= "2026-11-11 08:45" ORDER BY created ASC',
  ]);
  expect(incidentsStore.kept.open).toEqual([
    {
      id: "jira:OPS-7",
      source: "jira",
      key: "OPS-7",
      title: "Checkout fails on a split bill",
      url: `${jira.base}/browse/OPS-7`,
      createdAt: Date.parse("2026-11-11T08:58:00.000Z"),
      foundAt: clock.now(),
    },
  ]);

  const dismiss = recorded.handlers.get("office.incidents.dismiss.request");
  expect(await dismiss?.({}, context)).toEqual({ dismissed: 1 });
  expect(await dismiss?.({ ids: ["jira:OPS-7"] }, context)).toEqual({ dismissed: 0 });
  expect(incidentsStore.kept.open).toEqual([]);
  await stop();
});

test("a saved Jira connection turns the check on, and its token never reaches a client", async () => {
  const jira = await jiraStandIn();
  const { recorded, trackerStore, context, logs, stop } = setup(async () => JIRA_ON);
  const incidentsCalls = () => recorded.schedules.filter((call) => call.includes(" incidents"));
  await settle();
  // No variable and nothing saved: the project alone does not start the check.
  expect(incidentsCalls()).toEqual(["remove incidents"]);
  const events: { type: string; state?: { incidents?: unknown } }[] = [];
  const leaving = new AbortController();
  const done = recorded.handlers.get("office.state")?.({}, {
    ...context,
    signal: leaving.signal,
    push: async (event: { type: string }) => void events.push(event),
  } as never);
  await settle();

  const save = recorded.handlers.get("office.trackers.save.request");
  const typed = { baseUrl: `${jira.base}/`, email: "office@example.test", token: "typed-token" };
  expect(await save?.({ action: "save-jira", ...typed, token: "" }, context)).toEqual({
    ok: false,
    problem: "Enter the Jira API token",
  });
  expect(await save?.({ action: "save-jira", ...typed }, context)).toEqual({ ok: true });
  await settle();
  expect(trackerStore.kept).toEqual({
    version: 1,
    jira: { baseUrl: jira.base, email: "office@example.test", token: "typed-token" },
  });
  expect(incidentsCalls().at(-1)).toBe("upsert incidents every 300000");
  expect(events.at(-1)?.state?.incidents).toMatchObject({
    jiraReady: true,
    connections: {
      jira: { source: "saved", baseUrl: jira.base, email: "office@example.test" },
      sentry: { source: "none" },
    },
  });
  expect(JSON.stringify(events)).not.toContain("typed-token");
  expect(logs.join("\n")).not.toContain("typed-token");

  // Cleared: no sign-in is left, so the check stops.
  expect(await save?.({ action: "clear", tracker: "jira" }, context)).toEqual({ ok: true });
  await settle();
  expect(trackerStore.kept).toEqual({ version: 1 });
  expect(incidentsCalls().at(-1)).toBe("remove incidents");
  expect(events.at(-1)?.state?.incidents).toMatchObject({ jiraReady: false });
  leaving.abort();
  await done;
  await stop();
});

test("a connection test asks the tracker once and saves nothing", async () => {
  const jira = await jiraStandIn();
  const { recorded, trackerStore, context, stop } = setup(async () => JIRA_ON, {
    savedTrackers: {
      version: 1,
      jira: { baseUrl: jira.base, email: "office@example.test", token: "kept-token" },
    },
  });
  await settle();
  const probe = recorded.handlers.get("office.trackers.test.request");
  const typed = { tracker: "jira", baseUrl: jira.base, email: "office@example.test" };
  // No token typed: the saved one is tried.
  expect(await probe?.({ ...typed, token: "" }, context)).toEqual({ ok: true });
  expect(
    await probe?.({ ...typed, baseUrl: "http://jira.example.test", token: "t" }, context),
  ).toEqual({
    ok: false,
    problem: "The Jira address must be an https address (plain http only on this machine)",
  });
  // The settings name no Sentry organisation to ask about.
  expect(await probe?.({ tracker: "sentry", token: "t" }, context)).toEqual({
    ok: false,
    problem: "Set the Sentry organisation first",
  });
  expect(trackerStore.kept.jira?.token).toBe("kept-token");
  await stop();
});

test("an open office gets the incidents state with which trackers' variables are set, and a schedule that fails after a save", async () => {
  const { recorded, context, stop } = setup(async () => JIRA_ON, {
    env: jiraVariables("https://jira.example.test"),
  });
  const incidentsCalls = () => recorded.schedules.filter((call) => call.includes(" incidents"));
  const follow = (state: SettingsState) =>
    Promise.all([...recorded.listeners].map((listener) => listener(state)));
  await settle();
  const events: { type: string; state?: { incidents?: unknown } }[] = [];
  const leaving = new AbortController();
  const done = recorded.handlers.get("office.state")?.({}, {
    ...context,
    signal: leaving.signal,
    push: async (event: { type: string }) => void events.push(event),
  } as never);
  await settle();
  expect(events.at(-1)?.state?.incidents).toEqual({
    open: [],
    problems: {},
    jiraReady: true,
    sentryReady: false,
    connections: {
      jira: { source: "env", baseUrl: "https://jira.example.test", email: "office@example.test" },
      sentry: { source: "none" },
    },
    scheduleError: null,
  });
  expect(incidentsCalls()).toEqual(["upsert incidents every 300000"]);

  recorded.scheduleFailure = new Error("Plugin schedules are unavailable");
  await follow({ ...JIRA_ON, revision: "again" });
  await settle();
  expect(events.at(-1)?.state?.incidents).toMatchObject({
    scheduleError: "Plugin schedules are unavailable",
  });

  // No project left: the schedule goes, and the error with it.
  recorded.scheduleFailure = null;
  await follow(ON);
  await settle();
  expect(events.at(-1)?.state?.incidents).toMatchObject({ scheduleError: null });
  expect(incidentsCalls()).toEqual([
    "upsert incidents every 300000",
    "upsert incidents every 300000",
    "remove incidents",
  ]);

  leaving.abort();
  await done;
  await stop();
});

test("a tracker's problem goes once no tracker is on", async () => {
  const jira = await jiraStandIn();
  jira.refusing = true;
  // What the daemon reads back is what was saved last.
  let saved = JIRA_ON;
  const { recorded, context, open, clock, stop } = setup(async () => saved, {
    env: jiraVariables(jira.base),
  });
  await settle();
  const events: { type: string; state?: { incidents?: unknown } }[] = [];
  const leaving = new AbortController();
  const done = recorded.handlers.get("office.state")?.({}, {
    ...context,
    signal: leaving.signal,
    push: async (event: { type: string }) => void events.push(event),
  } as never);
  await settle();
  await open();
  await recorded.scheduleRuns.get("incidents")?.(clock.now());
  await settle();
  expect(events.at(-1)?.state?.incidents).toMatchObject({
    problems: { jira: "Jira refused the token: check ATLASSIAN_API_TOKEN" },
  });

  // The last project removed: no run comes again to clear the problem.
  saved = ON;
  await Promise.all([...recorded.listeners].map((listener) => listener(saved)));
  await settle();
  expect(events.at(-1)?.state?.incidents).toMatchObject({
    open: [],
    problems: {},
    jiraReady: true,
    sentryReady: false,
    scheduleError: null,
  });

  leaving.abort();
  await done;
  await stop();
});

test("weather is read only for an open office, reaches its snapshot and stops when it closes", async () => {
  const url = "http://127.0.0.1:9/weather.json?key=SECRET";
  const fetchFn = vi.fn(async () =>
    Response.json({ current: { weather_code: 63, temperature_2m: 14.2, cloud_cover: 90 } }),
  );
  const values = { ...ON.values, weatherMode: "service" as const, weatherUrl: url };
  const { recorded, clock, context, stop } = setup(async () => ({ ...ON, values }), { fetchFn });
  await settle();
  expect(fetchFn).not.toHaveBeenCalled();
  const office = openOffice(recorded, context);
  await settle();
  expect(fetchFn).toHaveBeenCalledExactlyOnceWith(
    url,
    expect.objectContaining({ redirect: "manual" }),
  );
  expect(office.events.at(-1)?.state).toMatchObject({
    weather: {
      scene: { kind: "reading", code: 63, temp: 14.2, cloud: 0.9 },
      problem: null,
      readAt: clock.now(),
    },
  });
  await office.leave();
  clock.advance(3 * 3600_000);
  await settle();
  expect(fetchFn).toHaveBeenCalledTimes(1);
  await stop();
});

test("a page hears the staff scenes' data as it subscribes: the lift is serviced from the start", async () => {
  const { recorded, context, stop } = setup(async () => ON);
  await settle();
  const events: unknown[] = [];
  const leaving = new AbortController();
  const done = recorded.handlers.get("office.life")?.({}, {
    ...context,
    signal: leaving.signal,
    push: async (event: unknown) => void events.push(event),
  } as never);
  for (let round = 0; round < 50 && events.length === 0; round += 1) await settle();

  // "the scene" is the fake world's script: its build is a hash of it, and the first start ever
  // is not a new build.
  expect(events).toEqual([
    {
      type: "life",
      born: {},
      tenure: { days: 30, choices: [30], projects: [] },
      lift: { left: 180_000, total: 180_000, newBuild: false, sticker: null },
    },
  ]);
  leaving.abort();
  await done;
  await stop();
});

test("a tenure write the ledger does not hold is refused", async () => {
  const { recorded, context, stop } = setup(async () => ON);
  const write = recorded.handlers.get("office.tenure.request");
  expect(await write?.({ op: "official", name: "api" }, context as never)).toEqual({ ok: false });
  await stop();
});

test("a host without a duty list posts the pantry chores at 08:00; a save and the 3D office's report change the board", async () => {
  const { recorded, context, stop } = setup(async () => ON, { duties: null });
  await settle();
  expect(recorded.schedules).toContain("upsert duty-board 0 8 * * * Asia/Riyadh");
  const office = openOffice(recorded, context);
  await settle();
  const snapshot = () =>
    office.events.findLast((event) => event.type === "snapshot")?.state as
      | {
          duties?: { duties: { name: string }[]; day: string | null };
          boards: Record<string, { id: string; state?: string; claimedBy?: string }[]>;
        }
      | undefined;
  expect(snapshot()?.duties?.day).toBe("2026-11-11");
  expect(snapshot()?.duties?.duties.map((duty) => duty.name)).toEqual([
    "Wash the cups",
    "Take out the bin",
    "Water the plants",
    "Wipe the tables",
  ]);
  expect(snapshot()?.boards.duty?.map((post) => post.id)).toEqual(["p1", "p2", "p3", "p4"]);
  const save = recorded.handlers.get("office.duties.save.request");
  expect(await save?.({ duties: [{ name: "", instructions: "", days: [] }] }, context)).toEqual({
    ok: false,
    error: "Unable to save: duty 1 has no name",
  });
  expect(
    await save?.({ duties: [{ id: "cups", name: "Mugs", instructions: "", days: [3] }] }, context),
  ).toEqual({ ok: true });
  await settle();
  expect(snapshot()?.duties?.duties.map((duty) => duty.name)).toEqual(["Mugs"]);
  const acted = recorded.handlers.get("office.duty.acted.request");
  expect(await acted?.({ id: "p1", agentId: "agent-1" }, context)).toMatchObject({
    ok: true,
    post: { id: "p1", state: "done", claimedBy: "agent-1" },
  });
  await settle();
  const board = office.events.findLast((event) => event.type === "board") as unknown as {
    board: string;
    posts: { id: string; state?: string }[];
  };
  expect(board.board).toBe("duty");
  expect(board.posts.map((post) => [post.id, post.state])).toEqual([["p1", "done"]]);
  await office.leave();
  await stop();
});

test("the duty board's 08:00 run takes the instant it was due, so a run a millisecond early posts the day", async () => {
  const { recorded, context, stop } = setup(async () => ON, {
    duties: null,
    // 07:59:59.999 in Riyadh.
    start: Date.parse("2026-11-11T04:59:59.999Z"),
  });
  await settle();
  await recorded.scheduleRuns.get("duty-board")?.(Date.parse("2026-11-11T05:00:00.000Z"));
  const office = openOffice(recorded, context);
  await settle();
  const snapshot = office.events.findLast((event) => event.type === "snapshot")?.state as
    | { duties?: { day: string | null }; boards: Record<string, { id: string }[]> }
    | undefined;
  expect(snapshot?.duties?.day).toBe("2026-11-11");
  expect(snapshot?.boards.duty?.map((post) => post.id)).toEqual(["p1", "p2", "p3", "p4"]);
  await office.leave();
  await stop();
});

test("a notes time zone the host does not know leaves the duty board on the host's zone", async () => {
  const unknownZone: SettingsState = {
    ...ON,
    values: { ...ON.values, notesTimeZone: "Mars/Olympus_Mons" },
  };
  const { recorded, context, logs, stop } = setup(async () => unknownZone, { duties: null });
  await settle();
  expect(recorded.schedules).toContain("upsert duty-board 0 8 * * * Asia/Riyadh");
  expect(logs.filter((line) => line.includes("duty board"))).toEqual([]);
  const office = openOffice(recorded, context);
  await settle();
  const snapshot = office.events.findLast((event) => event.type === "snapshot")?.state as
    | { duties?: { day: string | null }; boards: Record<string, { id: string }[]> }
    | undefined;
  expect(snapshot?.duties?.day).toBe("2026-11-11");
  expect(snapshot?.boards.duty?.map((post) => post.id)).toEqual(["p1", "p2", "p3", "p4"]);
  await office.leave();
  await stop();
});
