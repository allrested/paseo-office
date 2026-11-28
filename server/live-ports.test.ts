import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { GroupSessionUnavailable } from "./chat-service.js";
import { liveAgentPorts, liveChatPorts, liveNotesPorts } from "./live-ports.js";
import type { Paseo, PaseoHolder } from "./paseo-holder.js";
import { ROSTER_MEMBER_KEY, type Roster } from "../shared/roster.js";

interface FakeAgent {
  id: string;
  workspaceId?: string;
  status: string;
  archivedAt: string | null;
  pendingPermissions: unknown[];
  metadata?: Record<string, unknown>;
}

function agent(id: string, overrides: Partial<FakeAgent> = {}): FakeAgent {
  return { id, status: "idle", archivedAt: null, pendingPermissions: [], ...overrides };
}

/** The daemon finds an agent by its id or by a start of it, archived agents too. */
const KNOWN = new Map([
  ["b-full-id", agent("b-full-id", { workspaceId: "w1" })],
  ["b-fu", agent("b-full-id")],
  ["run", agent("run", { status: "running" })],
  ["old", agent("old", { archivedAt: "2026-11-10T08:00:00.000Z" })],
  ["shut", agent("shut", { status: "closed" })],
  ["seated", agent("seated", { metadata: { [ROSTER_MEMBER_KEY]: "m2" } })],
  ["passed", agent("passed", { metadata: { [ROSTER_MEMBER_KEY]: 3 } })],
]);

const GROUP = {
  group: true,
  messageId: "office-group-x",
  sentAt: Date.parse("2026-11-18T05:00:00Z"),
};

interface Sent {
  agentId: string;
  text: string;
  options: unknown;
}

/** The daemon's API as the office holds it: the agents of KNOWN, and a record of every send. */
function fakeHolder(sent: Sent[]): PaseoHolder {
  // A partial fake: only the calls the office makes, cast to the SDK's full API.
  const paseo = {
    agents: {
      ref: (agentId: string) => ({
        refresh: async () => {
          const found = KNOWN.get(agentId);
          return found ? { agent: found, project: null } : null;
        },
        send: async (text: string, options?: unknown) => {
          sent.push({ agentId, text, options });
        },
      }),
    },
  } as unknown as Paseo;
  return {
    remember: () => undefined,
    require: () => paseo,
    held: () => true,
    wait: async () => paseo,
  };
}

function setup() {
  const sent: Sent[] = [];
  return { ports: liveAgentPorts(fakeHolder(sent)), sent };
}

test("an agent's wake state is read from the daemon; one it does not know is gone", async () => {
  const { ports } = setup();
  expect(await ports.status("b-full-id")).toBe("wakeable");
  expect(await ports.status("run")).toBe("busy");
  expect(await ports.status("old")).toBe("gone");
  expect(await ports.status("nobody")).toBe("gone");
});

test("lobby pickup reads every page of idle agents, oldest idle first, then those at home, and rechecks the live state", async () => {
  const waiting = {
    ...agent("waiting"),
    labels: {},
    requiresAttention: true,
    attentionReason: "finished",
  };
  const unavailable = [
    { status: "running" },
    { status: "initializing" },
    { status: "error" },
    { archivedAt: "2026-11-18T08:00:00Z" },
    { activeTurn: { turnId: "t" } },
    { backgroundWork: { count: 1 } },
    { pendingPermissions: [{ id: "request" }] },
    { attentionReason: "permission" },
    { attentionReason: "error" },
    { requiresAttention: true, attentionReason: null },
    { background: true },
    { internal: true },
    { providerUnavailable: true },
    { labels: { "paseo.parent-agent-id": "parent" } },
    { title: "Stand-up notes" },
  ].map((fields, i) => Object.assign({}, waiting, fields, { id: String(i) }));
  const next = { ...waiting, id: "second", requiresAttention: false, attentionReason: null };
  const list = vi
    .fn()
    .mockResolvedValueOnce({
      entries: [waiting, ...unavailable].map((entry) => ({ agent: entry })),
      pageInfo: { nextCursor: "next" },
    })
    .mockResolvedValueOnce({ entries: [{ agent: next }], pageInfo: { nextCursor: null } })
    // Those at home, asked for after the idle: one that can be called back, one archived.
    .mockResolvedValueOnce({
      entries: [
        { agent: { ...next, id: "home", status: "closed" } },
        { agent: { ...next, id: "filed", status: "closed", archivedAt: "2026-11-18T08:00:00Z" } },
      ],
      pageInfo: { nextCursor: null },
    });
  const refresh = vi
    .fn()
    .mockResolvedValueOnce({ agent: waiting })
    .mockResolvedValueOnce({ agent: { ...waiting, activeTurn: { turnId: "new" } } })
    .mockResolvedValueOnce(null);
  const holder = {
    held: () => true,
    require: () => ({ agents: { list, ref: () => ({ refresh }) } }),
  } as unknown as PaseoHolder;
  const ports = liveAgentPorts(holder);
  expect(await ports.lobbyCandidates()).toEqual(["waiting", "second", "home"]);
  const options = {
    filter: { statuses: ["idle"] },
    sort: [{ key: "updated_at", direction: "asc" }],
  };
  expect(list.mock.calls).toEqual([
    [{ ...options, page: { limit: 200, cursor: undefined } }],
    [{ ...options, page: { limit: 200, cursor: "next" } }],
    [
      {
        filter: { statuses: ["closed"] },
        sort: [{ key: "updated_at", direction: "desc" }],
        page: { limit: 200, cursor: undefined },
      },
    ],
  ]);
  expect(await ports.lobbyEligible("waiting")).toBe(true);
  expect(await ports.lobbyEligible("waiting")).toBe(false);
  expect(await ports.lobbyEligible("gone")).toBe(false);
});

test("a cold office waits until a hook or handler has supplied its Paseo API", async () => {
  const holder = { held: () => false } as PaseoHolder;
  expect(await liveAgentPorts(holder).lobbyCandidates()).toEqual([]);
});

test("an agent's workspace is read from the daemon; an agent it does not know has none", async () => {
  const { ports } = setup();
  expect(await ports.workspaceOf("b-full-id")).toBe("w1");
  expect(await ports.workspaceOf("run")).toBeNull();
  expect(await ports.workspaceOf("nobody")).toBeNull();
});

test("an agent's team is its roster teammate's, read from its stored mark; a team is found by id or name", async () => {
  let roster: Roster = {
    on: true,
    edition: 1,
    teams: [
      { id: "t1", name: "PR-DEV", members: [{ id: "m1", name: "Tze Jun" }] },
      { id: "t2", name: "QA-PR", members: [{ id: "m2", name: "Rosalyn" }] },
    ],
  };
  const ports = liveAgentPorts(fakeHolder([]), () => roster);
  expect(await ports.teamOf("seated")).toBe("t2");
  expect(await ports.teamOf("passed")).toBeNull();
  expect(await ports.teamOf("b-full-id")).toBeNull();
  expect(await ports.teamOf("nobody")).toBeNull();
  expect(await ports.findTeam("qa-pr")).toBe("t2");
  expect(await ports.findTeam("t1")).toBe("t1");
  expect(await ports.findTeam("ops")).toBeNull();
  expect(ports.teamName("t2")).toBe("QA-PR");
  expect(ports.teamName("gone")).toBeNull();
  // The roster as it is now: switched off, it seats nobody and names no team.
  roster = { ...roster, on: false };
  expect(await ports.teamOf("seated")).toBeNull();
  expect(await ports.findTeam("t2")).toBeNull();
  expect(ports.teamName("t2")).toBeNull();
  expect(await liveAgentPorts(fakeHolder([])).findTeam("t2")).toBeNull();
});

test("a start of an id resolves to the full id; an agent that can get no post resolves to none", async () => {
  const { ports } = setup();
  expect(await ports.resolve("b-fu")).toBe("b-full-id");
  expect(await ports.resolve("run")).toBe("run");
  expect(await ports.resolve("nobody")).toBeNull();
  // The queue drops posts for archived agents unsent, so a post may not name one. One that is
  // closed and not archived is at home, and a post that names it calls it back.
  expect(await ports.resolve("old")).toBeNull();
  expect(await ports.resolve("shut")).toBe("shut");
});

test("a wake names its source agent; a wake as from the user names none and never cuts a turn", async () => {
  const { ports, sent } = setup();
  await ports.send("b-full-id", "Office board: 1 post(s) for you.", "a");
  await ports.send("b-full-id", "Office board: 2 post(s) for you.", null);
  expect(sent).toEqual([
    {
      agentId: "b-full-id",
      text: "Office board: 1 post(s) for you.",
      options: { sourceAgentId: "a" },
    },
    {
      agentId: "b-full-id",
      text: "Office board: 2 post(s) for you.",
      options: { activeTurnBehavior: "steer" },
    },
  ]);
});

test("a retried lobby assignment forwards the same client message id", async () => {
  const { ports, sent } = setup();
  await ports.send("b-full-id", "Lobby task p4", null, "assignment-id");
  expect(sent[0]?.options).toEqual({ activeTurnBehavior: "steer", messageId: "assignment-id" });
});

test("a chat prompt steers a running turn", async () => {
  const sent: Sent[] = [];
  const ports = liveChatPorts(fakeHolder(sent));
  await ports.send("run", "Team chat message from you: hi");
  expect(sent).toEqual([
    {
      agentId: "run",
      text: "Team chat message from you: hi",
      options: { activeTurnBehavior: "steer" },
    },
  ]);
});

test("a group prompt goes only to a session that is still available on the daemon", async () => {
  const sent: Sent[] = [];
  const ports = liveChatPorts(fakeHolder(sent));
  for (const id of ["run", "old", "shut", "nobody"]) {
    await expect(ports.send(id, "Reply to the group", undefined, GROUP)).rejects.toBeInstanceOf(
      GroupSessionUnavailable,
    );
  }
  await ports.send("b-full-id", "Reply to the group", undefined, GROUP);
  expect(sent).toEqual([
    {
      agentId: "b-full-id",
      text: "Reply to the group",
      options: { activeTurnBehavior: "steer", messageId: GROUP.messageId },
    },
  ]);
});

test("a send error after the eligibility check keeps its original delivery error", async () => {
  const error = new Error("Disconnected after send");
  const send = vi.fn().mockRejectedValue(error);
  const ref = { refresh: async () => ({ agent: agent("session") }), send };
  const holder = { require: () => ({ agents: { ref: () => ref } }) } as unknown as PaseoHolder;
  await expect(
    liveChatPorts(holder).send("session", "Group question", undefined, GROUP),
  ).rejects.toBe(error);
  expect(send).toHaveBeenCalledTimes(1);
});

test("the answer is the last assistant message of the turn the hook names", async () => {
  let options: unknown = null;
  const entries = [
    { turnId: "t0", item: { type: "assistant_message", text: "Earlier." } },
    { turnId: "t1", item: { type: "user_message", text: "hi" } },
    { turnId: "t1", item: { type: "assistant_message", text: "Done." } },
  ];
  const paseo = {
    agents: {
      ref: () => ({
        timeline: {
          refetch: async (given: unknown) => {
            options = given;
            return { entries };
          },
        },
      }),
    },
  };
  const holder = { remember: () => undefined, require: () => paseo } as unknown as PaseoHolder;
  const ports = liveChatPorts(holder);
  expect(await ports.readTurn("a", "t1")).toEqual({ matches: true, text: "Done." });
  expect(options).toEqual({ direction: "tail", limit: 1, wholeTurns: true });
  expect((await ports.readTurn("a", null)).text).toBeNull();
  expect((await ports.readTurn("a", "t9")).text).toBeNull();
});

test.each(["messageId", "clientMessageId"])(
  "the group answer follows its %s in the hook's turn",
  async (key) => {
    const cursor = { seq: 10, epoch: "epoch" };
    const newer = {
      turnId: "new",
      timestamp: "2026-11-18T05:05:00Z",
      item: { type: "assistant_message", text: "Unrelated" },
    };
    const older = {
      turnId: "group",
      item: { type: "assistant_message", text: "Private text before the group steer" },
    };
    const user = {
      turnId: "group",
      item: { type: "user_message", text: "hi", [key]: GROUP.messageId },
    };
    const answer = { turnId: "group", item: { type: "assistant_message", text: "Hello group!" } };
    const otherUser = {
      turnId: "group",
      item: { type: "user_message", text: "An additional request", [key]: "another-id" },
    };
    const refetch = vi
      .fn()
      .mockResolvedValueOnce({ entries: [newer] })
      .mockResolvedValueOnce({ entries: [newer], hasOlder: true, startCursor: cursor })
      .mockResolvedValueOnce({ entries: [older, user, answer] })
      .mockResolvedValueOnce({ entries: [older, user] })
      .mockResolvedValueOnce({ entries: [user, otherUser, answer] })
      .mockResolvedValueOnce({ entries: [otherUser, user, answer] })
      .mockResolvedValueOnce({ entries: [user, otherUser, answer] });
    const holder = {
      require: () => ({ agents: { ref: () => ({ timeline: { refetch } }) } }),
    } as unknown as PaseoHolder;
    const ports = liveChatPorts(holder);
    expect(await ports.readTurn("a", "new", GROUP)).toEqual({ matches: false, text: null });
    expect(await ports.readTurn("a", "group", GROUP)).toEqual({
      matches: true,
      text: "Hello group!",
    });
    expect(refetch.mock.calls[2]).toEqual([
      { direction: "before", cursor, limit: 1, wholeTurns: true },
    ]);
    expect(await ports.readTurn("a", "group", GROUP)).toEqual({ matches: true, text: null });
    for (let i = 0; i < 2; i++) {
      expect(await ports.readTurn("a", "group", GROUP)).toEqual({
        matches: true,
        privateTurn: true,
        text: null,
      });
    }
    expect(await ports.readTurn("a", "group", GROUP, ["another-id"])).toEqual({
      matches: true,
      text: "Hello group!",
    });
  },
);

interface Created {
  cwd: string;
  options: unknown;
}

interface ProviderEntry {
  provider: string;
  status: string;
  enabled: boolean;
  defaultModeId?: string | null;
  modes?: { id: string; label: string }[];
  models?: { id: string; isDefault?: boolean; isSelectable?: boolean }[];
}

/** The daemon's API as the notes writer uses it: a workspace per folder, and the providers given. */
function notesHolder(entries: ProviderEntry[], created: Created[], archived: string[]) {
  const paseo = {
    providers: {
      waitForReady: async ({ cwd }: { cwd: string }) => ({ cwd, entries }),
    },
    workspaces: {
      open: async (cwd: string) => ({
        id: "wks_notes",
        directory: cwd,
        agents: {
          create: async (options: unknown) => {
            created.push({ cwd, options });
            return { id: "writer-1" };
          },
        },
      }),
    },
    agents: {
      ref: (agentId: string) => ({
        refresh: async () => {
          const found = KNOWN.get(agentId);
          return found ? { agent: found, project: null } : null;
        },
        archive: async () => {
          archived.push(agentId);
          return { archivedAt: "2026-11-17T05:10:00.000Z" };
        },
      }),
    },
  };
  return { remember: () => undefined, require: () => paseo } as unknown as PaseoHolder;
}

const NO_HUB = {
  read: async () => {
    throw new Error("not read");
  },
};

test("the writer starts in the folder's workspace, on the first ready provider with its default model and the mode that accepts edits", async () => {
  const created: Created[] = [];
  const entries: ProviderEntry[] = [
    { provider: "codex", status: "error", enabled: true, models: [{ id: "gpt" }] },
    { provider: "opencode", status: "ready", enabled: false, models: [{ id: "big" }] },
    {
      provider: "claude",
      status: "ready",
      enabled: true,
      defaultModeId: "auto",
      modes: [
        { id: "default", label: "Always Ask" },
        { id: "acceptEdits", label: "Accept File Edits" },
        { id: "auto", label: "Auto mode" },
        { id: "bypassPermissions", label: "Bypass" },
      ],
      models: [
        { id: "haiku", isSelectable: false, isDefault: true },
        { id: "opus" },
        { id: "sonnet", isDefault: true },
      ],
    },
  ];
  const ports = liveNotesPorts(notesHolder(entries, created, []), NO_HUB);
  expect(await ports.startAgent({ cwd: "/n", title: "Stand-up notes", prompt: "Write" })).toBe(
    "writer-1",
  );
  expect(created).toEqual([
    {
      cwd: "/n",
      options: {
        config: { provider: "claude/sonnet", modeId: "acceptEdits" },
        title: "Stand-up notes",
        prompt: "Write",
      },
    },
  ]);
});

test("a provider with no mode that accepts edits starts the writer in its default mode", async () => {
  const created: Created[] = [];
  const entries: ProviderEntry[] = [
    {
      provider: "codex",
      status: "ready",
      enabled: true,
      defaultModeId: "auto-review",
      modes: [
        { id: "auto", label: "Default Permissions" },
        { id: "auto-review", label: "Auto-review" },
        { id: "full-access", label: "Full Access" },
      ],
      models: [{ id: "gpt", isDefault: true }],
    },
  ];
  await liveNotesPorts(notesHolder(entries, created, []), NO_HUB).startAgent({
    cwd: "/n",
    title: "Stand-up notes",
    prompt: "Write",
  });
  expect(created[0]?.options).toMatchObject({
    config: { provider: "codex/gpt", modeId: "auto-review" },
  });
});

test("a provider without a default model takes its first, and no mode when it names none", async () => {
  const created: Created[] = [];
  const entries = [
    { provider: "pi", status: "ready", enabled: true, defaultModeId: null, models: [{ id: "a" }] },
  ];
  await liveNotesPorts(notesHolder(entries, created, []), NO_HUB).startAgent({
    cwd: "/n",
    title: "Stand-up notes",
    prompt: "Write",
  });
  expect(created[0]?.options).toMatchObject({ config: { provider: "pi/a" } });
  expect(created[0]?.options).not.toHaveProperty("config.modeId");
});

test("a host with no ready provider starts no writer and says so", async () => {
  const created: Created[] = [];
  const entries = [{ provider: "claude", status: "loading", enabled: true, models: [] }];
  await expect(
    liveNotesPorts(notesHolder(entries, created, []), NO_HUB).startAgent({
      cwd: "/n",
      title: "Stand-up notes",
      prompt: "Write",
    }),
  ).rejects.toThrow("No agent provider is ready on this host");
  expect(created).toEqual([]);
});

test("a writer is at its turn only while it runs, and is archived through the daemon", async () => {
  const archived: string[] = [];
  const ports = liveNotesPorts(notesHolder([], [], archived), NO_HUB);
  expect(await ports.alive("run")).toBe(true);
  expect(await ports.alive("b-full-id")).toBe(false);
  expect(await ports.alive("old")).toBe(false);
  expect(await ports.alive("shut")).toBe(false);
  expect(await ports.alive("nobody")).toBe(false);
  await ports.archive("run");
  expect(archived).toEqual(["run"]);
});

test("only a directory is a folder", async () => {
  const home = await mkdtemp(join(tmpdir(), "office-notes-folder-"));
  try {
    await writeFile(join(home, "file.md"), "", "utf8");
    const ports = liveNotesPorts(notesHolder([], [], []), NO_HUB);
    expect(await ports.isDirectory(home)).toBe(true);
    expect(await ports.isDirectory(join(home, "file.md"))).toBe(false);
    expect(await ports.isDirectory(join(home, "missing"))).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("an entry is in the notes when its header starts a line of its month's file directly in the folder", async () => {
  const home = await mkdtemp(join(tmpdir(), "office-notes-entry-"));
  try {
    await mkdir(join(home, "sub"));
    await writeFile(
      join(home, "daily-standup-202611.md"),
      "# Notes\n\n## Contents\n\n- [18 November 2026](#18-november-2026)\n\n---\n\n## 17 November 2026\n\nB\n",
      "utf8",
    );
    await writeFile(join(home, "sub", "daily-standup-202610.md"), "## 01 October 2026\n", "utf8");
    const ports = liveNotesPorts(notesHolder([], [], []), NO_HUB);
    const entry = (month: string, header: string) => ({ folder: home, month, header });
    expect(await ports.hasEntry(entry("202611", "17 November 2026"))).toBe(true);
    // Named only in the Contents list.
    expect(await ports.hasEntry(entry("202611", "18 November 2026"))).toBe(false);
    // A month with no file, and a file in a subfolder.
    expect(await ports.hasEntry(entry("202612", "01 December 2026"))).toBe(false);
    expect(await ports.hasEntry(entry("202610", "01 October 2026"))).toBe(false);
    await expect(
      ports.hasEntry({
        folder: join(home, "missing"),
        month: "202611",
        header: "17 November 2026",
      }),
    ).rejects.toThrow("ENOENT");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
