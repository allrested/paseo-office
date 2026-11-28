import { expect, test } from "vitest";
import type { Post, PostResult } from "../shared/contracts.js";
import type { PlanUsage } from "../shared/plan-usage.js";
import {
  READING_STALE_MS,
  createAutoStart,
  gateDecision,
  type AutoStartCount,
  type AutoStartSettings,
  type AutoStartState,
  type GateInput,
} from "./auto-start.js";
import { createFakeClock, settle } from "./fake-clock.js";

function plan(provider: string, ...pcts: number[]): PlanUsage {
  return {
    provider,
    name: provider === "claude" ? "Claude" : provider,
    plan: null,
    windows: pcts.map((usedPct, i) => ({
      id: `w${i}`,
      label: i === 0 ? "5 hours" : `week ${i}`,
      usedPct,
      resetsAt: null,
    })),
  };
}

const NOW = Date.parse("2026-11-28T10:00:00.000Z");

/** Every check passes: the gate is open. */
function open(overrides: Partial<GateInput> = {}): GateInput {
  return {
    now: NOW,
    settings: {
      autoStart: true,
      autoStartUnderPct: 70,
      autoStartAtOnce: 3,
      autoStartPerDay: 10,
      planHidden: [],
    },
    reading: { at: NOW - 60_000, usage: [plan("claude", 10, 20)] },
    held: 1,
    claimed: 0,
    startedToday: 0,
    ...overrides,
  };
}

function settings(overrides: Partial<GateInput["settings"]>): GateInput["settings"] {
  return { ...open().settings, ...overrides };
}

test("the gate is open when every check passes", () => {
  expect(gateDecision(open())).toEqual({ open: true });
});

test("off: the setting is off, before anything else", () => {
  expect(
    gateDecision(
      open({
        settings: settings({ autoStart: false }),
        held: 0,
        reading: null,
        claimed: 9,
        startedToday: null,
      }),
    ),
  ).toEqual({ open: false, reason: "off" });
});

test("empty: no held task, before the reading", () => {
  expect(gateDecision(open({ held: 0, reading: null, startedToday: null }))).toEqual({
    open: false,
    reason: "empty",
  });
});

test("no-reading: none yet, before the limits and the counts", () => {
  expect(gateDecision(open({ reading: null, claimed: 9, startedToday: null }))).toEqual({
    open: false,
    reason: "no-reading",
  });
});

test("no-reading: a reading 15 minutes old still counts, one a millisecond older does not", () => {
  const usage = [plan("claude", 10)];
  expect(gateDecision(open({ reading: { at: NOW - READING_STALE_MS, usage } }))).toEqual({
    open: true,
  });
  expect(gateDecision(open({ reading: { at: NOW - READING_STALE_MS - 1, usage } }))).toEqual({
    open: false,
    reason: "no-reading",
  });
  expect(READING_STALE_MS).toBe(15 * 60_000);
});

test("no-reading: a reading with no provider reporting a window", () => {
  expect(gateDecision(open({ reading: { at: NOW, usage: [] } }))).toEqual({
    open: false,
    reason: "no-reading",
  });
  expect(gateDecision(open({ reading: { at: NOW, usage: [plan("claude")] } }))).toEqual({
    open: false,
    reason: "no-reading",
  });
});

test("no-reading: every provider that reports is switched off in the Plan section", () => {
  expect(
    gateDecision(
      open({
        settings: settings({ planHidden: ["claude"] }),
        reading: { at: NOW, usage: [plan("claude", 10)] },
      }),
    ),
  ).toEqual({ open: false, reason: "no-reading" });
});

test("a provider with no window is passed over while another reports", () => {
  expect(
    gateDecision(open({ reading: { at: NOW, usage: [plan("codex"), plan("claude", 10)] } })),
  ).toEqual({ open: true });
});

test("limit: a window at the setting closes the gate, one under it does not", () => {
  expect(gateDecision(open({ reading: { at: NOW, usage: [plan("claude", 69.9)] } }))).toEqual({
    open: true,
  });
  expect(gateDecision(open({ reading: { at: NOW, usage: [plan("claude", 70)] } }))).toEqual({
    open: false,
    reason: "limit",
    detail: { provider: "Claude", window: "5 hours", usedPct: 70 },
  });
});

test("limit: every window of every counted provider, and the detail names the worst", () => {
  const usage = [plan("claude", 10, 75), plan("codex", 90, 5)];
  expect(gateDecision(open({ reading: { at: NOW, usage } }))).toEqual({
    open: false,
    reason: "limit",
    detail: { provider: "codex", window: "5 hours", usedPct: 90 },
  });
  // A window that is not a provider's closest still counts.
  expect(gateDecision(open({ reading: { at: NOW, usage: [plan("claude", 95, 71)] } }))).toEqual({
    open: false,
    reason: "limit",
    detail: { provider: "Claude", window: "5 hours", usedPct: 95 },
  });
});

test("limit: a provider switched off in the Plan section is not counted", () => {
  const usage = [plan("claude", 10), plan("codex", 100)];
  expect(
    gateDecision(
      open({ settings: settings({ planHidden: ["codex"] }), reading: { at: NOW, usage } }),
    ),
  ).toEqual({ open: true });
});

test("limit: follows the setting's percent", () => {
  const reading = { at: NOW, usage: [plan("claude", 50)] };
  expect(gateDecision(open({ settings: settings({ autoStartUnderPct: 50 }), reading }))).toEqual({
    open: false,
    reason: "limit",
    detail: { provider: "Claude", window: "5 hours", usedPct: 50 },
  });
  expect(gateDecision(open({ settings: settings({ autoStartUnderPct: 51 }), reading }))).toEqual({
    open: true,
  });
});

test("limit comes before the counts", () => {
  expect(
    gateDecision(
      open({ reading: { at: NOW, usage: [plan("claude", 80)] }, claimed: 9, startedToday: null }),
    ),
  ).toMatchObject({ open: false, reason: "limit" });
});

test("at-once: as many claimed as the setting, before the day's count", () => {
  expect(gateDecision(open({ claimed: 2 }))).toEqual({ open: true });
  expect(gateDecision(open({ claimed: 3, startedToday: null }))).toEqual({
    open: false,
    reason: "at-once",
  });
});

test("per-day: as many started today as the setting, or a count that could not be read", () => {
  expect(gateDecision(open({ startedToday: 9 }))).toEqual({ open: true });
  expect(gateDecision(open({ startedToday: 10 }))).toEqual({ open: false, reason: "per-day" });
  expect(gateDecision(open({ startedToday: null }))).toEqual({ open: false, reason: "per-day" });
  expect(
    gateDecision(open({ settings: settings({ autoStartPerDay: 1 }), startedToday: 1 })),
  ).toEqual({ open: false, reason: "per-day" });
});

// The service.

let nextSeq = 100;

function task(id: string, overrides: Partial<Post> = {}): Post {
  nextSeq += 1;
  return {
    id,
    seq: nextSeq,
    board: "lobby",
    kind: "task",
    text: id,
    author: "user",
    state: "open",
    createdAt: "2026-11-27T09:00:00.000Z",
    updatedAt: "2026-11-27T09:00:00.000Z",
    ...overrides,
  };
}

function held(id: string, createdAt: string): Post {
  return task(id, { backlog: true, createdAt });
}

const SETTINGS: AutoStartSettings = {
  autoStart: true,
  autoStartUnderPct: 70,
  autoStartAtOnce: 3,
  autoStartPerDay: 10,
  planHidden: [],
  zone: "UTC",
};

interface Kept {
  value: AutoStartCount | null | Error;
}

function setup(
  options: {
    posts?: Post[];
    kept?: AutoStartCount | null | Error;
    start?: number;
    /** What the board does when told to start a task; by default it starts it. */
    failStart?: boolean;
    claimOnStart?: boolean;
  } = {},
) {
  const clock = createFakeClock(options.start ?? NOW);
  const kept: Kept = { value: options.kept ?? null };
  let posts: Post[] = options.posts ?? [];
  const started: string[] = [];
  const states: AutoStartState[] = [];
  const logs: string[] = [];
  let loads = 0;
  let evaluations = 0;
  const board = {
    lobbyPosts: (): readonly Post[] | null => posts,
    async start(id: string): Promise<PostResult> {
      const post = posts.find((item) => item.id === id);
      if (post === undefined) return { ok: false, error: `no ${id}` };
      if (options.failStart) return { ok: false, error: "Unable to save the boards: disk full" };
      nextSeq += 1;
      const next: Post = { ...post, seq: nextSeq };
      delete next.backlog;
      if (options.claimOnStart) {
        next.state = "claimed";
        next.claimedBy = `agent-${id}`;
      }
      posts = posts.map((item) => (item.id === id ? next : item));
      started.push(id);
      // The office tells the gate of the board's change, as onBoard does.
      service.boardChanged();
      return { ok: true, post: next };
    },
  };
  const service = createAutoStart({
    board,
    file: {
      async load() {
        loads += 1;
        if (kept.value instanceof Error) throw kept.value;
        return kept.value === null ? null : structuredClone(kept.value);
      },
      async save(count) {
        kept.value = structuredClone(count);
      },
    },
    now: () => clock.now(),
    changed: (state) => states.push(state),
    log: (message) => logs.push(message),
    evaluated: () => {
      evaluations += 1;
    },
  });
  return {
    clock,
    kept,
    service,
    started,
    states,
    logs,
    board,
    setPosts: (next: Post[]) => void (posts = next),
    posts: () => posts,
    loads: () => loads,
    evaluations: () => evaluations,
  };
}

const fresh = (clock: { now(): number }, usage = [plan("claude", 10)]) => ({
  usage,
  at: clock.now(),
});

test("starts the oldest held task and raises the day's count", async () => {
  const s = setup({
    posts: [
      held("p3", "2026-11-27T10:00:00.000Z"),
      held("p2", "2026-11-26T10:00:00.000Z"),
      task("p4"),
    ],
    claimOnStart: true,
  });
  s.service.settingsChanged({ ...SETTINGS, autoStartAtOnce: 1 });
  s.service.planRead(fresh(s.clock));
  await settle();
  expect(s.started).toEqual(["p2"]);
  expect(s.kept.value).toEqual({ version: 1, day: "2026-11-28", count: 1 });
  expect(s.states.at(-1)).toEqual({
    on: true,
    reason: "at-once",
    startedToday: 1,
    perDay: 10,
  });
});

test("starts several in a row, each looked at again, until at-once stops it", async () => {
  const s = setup({
    posts: ["p1", "p2", "p3", "p4", "p5"].map((id, i) => held(id, `2026-11-2${i}T10:00:00.000Z`)),
    claimOnStart: true,
  });
  s.service.planRead(fresh(s.clock));
  s.service.settingsChanged(SETTINGS);
  await settle();
  expect(s.started).toEqual(["p1", "p2", "p3"]);
  expect(s.kept.value).toMatchObject({ count: 3 });
  expect(s.states.at(-1)).toMatchObject({ reason: "at-once", startedToday: 3 });
});

test("starts several in a row until per-day stops it", async () => {
  const s = setup({
    posts: ["p1", "p2", "p3"].map((id, i) => held(id, `2026-11-2${i}T10:00:00.000Z`)),
    kept: { version: 1, day: "2026-11-28", count: 8 },
  });
  s.service.planRead(fresh(s.clock));
  s.service.settingsChanged(SETTINGS);
  await settle();
  expect(s.started).toEqual(["p1", "p2"]);
  expect(s.kept.value).toEqual({ version: 1, day: "2026-11-28", count: 10 });
  expect(s.states.at(-1)).toMatchObject({ reason: "per-day", startedToday: 10, perDay: 10 });
});

test("the day's count survives a restart", async () => {
  const first = setup({ posts: [held("p1", "2026-11-20T10:00:00.000Z")] });
  first.service.planRead(fresh(first.clock));
  first.service.settingsChanged({ ...SETTINGS, autoStartPerDay: 2 });
  await settle();
  expect(first.started).toEqual(["p1"]);
  // A new server reads the same file.
  const second = setup({
    posts: [held("p2", "2026-11-21T10:00:00.000Z"), held("p3", "2026-11-22T10:00:00.000Z")],
    kept: first.kept.value as AutoStartCount,
  });
  second.service.planRead(fresh(second.clock));
  second.service.settingsChanged({ ...SETTINGS, autoStartPerDay: 2 });
  await settle();
  expect(second.started).toEqual(["p2"]);
  expect(second.states.at(-1)).toMatchObject({ reason: "per-day", startedToday: 2 });
});

test("a new day in the notes' zone resets the count, at midnight there and not in UTC", async () => {
  // 20:59 UTC on the 28th is 23:59 in Riyadh (UTC+3); the file's day is Riyadh's 28th.
  const start = Date.parse("2026-11-28T20:59:00.000Z");
  const s = setup({
    posts: [held("p1", "2026-11-20T10:00:00.000Z"), held("p2", "2026-11-21T10:00:00.000Z")],
    kept: { version: 1, day: "2026-11-28", count: 10 },
    start,
  });
  const riyadh = { ...SETTINGS, zone: "Asia/Riyadh" };
  s.service.settingsChanged(riyadh);
  s.service.planRead(fresh(s.clock));
  await settle();
  expect(s.started).toEqual([]);
  expect(s.states.at(-1)).toMatchObject({ reason: "per-day", startedToday: 10 });
  // 21:00 UTC: midnight in Riyadh, still the 28th in UTC.
  s.clock.advance(60_000);
  s.service.planRead(fresh(s.clock));
  await settle();
  expect(s.started).toEqual(["p1", "p2"]);
  expect(s.kept.value).toEqual({ version: 1, day: "2026-11-29", count: 2 });
});

test("a count file that cannot be read starts nothing, says per-day, and is not written", async () => {
  const s = setup({
    posts: [held("p1", "2026-11-20T10:00:00.000Z")],
    kept: new Error("unexpected shape"),
  });
  s.service.settingsChanged(SETTINGS);
  s.service.planRead(fresh(s.clock));
  await settle();
  expect(s.started).toEqual([]);
  expect(s.kept.value).toBeInstanceOf(Error);
  expect(s.states.at(-1)).toMatchObject({ on: true, reason: "per-day" });
  expect(s.logs.filter((line) => line.includes("auto-start.json"))).toHaveLength(1);
  // Once it can be read again, the gate follows it.
  s.kept.value = { version: 1, day: "2026-11-28", count: 4 };
  s.service.boardChanged();
  await settle();
  expect(s.started).toEqual(["p1"]);
  expect(s.kept.value).toMatchObject({ count: 5 });
});

test("no reading starts nothing, and a reading older than 15 minutes is none", async () => {
  const s = setup({ posts: [held("p1", "2026-11-20T10:00:00.000Z")] });
  s.service.settingsChanged(SETTINGS);
  await settle();
  expect(s.started).toEqual([]);
  expect(s.states.at(-1)).toMatchObject({ reason: "no-reading" });
  s.service.planRead({ usage: [plan("claude", 10)], at: s.clock.now() - READING_STALE_MS - 1 });
  await settle();
  expect(s.started).toEqual([]);
  // The plan watch stopped (Keep watching off): what it read before is forgotten.
  s.service.planRead(fresh(s.clock));
  s.service.planRead(null);
  await settle();
  expect(s.started).toEqual([]);
  expect(s.states.at(-1)).toMatchObject({ reason: "no-reading" });
});

test("a reading goes stale with time: a later board change starts nothing", async () => {
  const s = setup({ posts: [held("p1", "2026-11-20T10:00:00.000Z")] });
  s.service.settingsChanged({ ...SETTINGS, autoStart: false });
  s.service.planRead(fresh(s.clock));
  await settle();
  s.clock.advance(READING_STALE_MS + 1);
  s.service.settingsChanged(SETTINGS);
  await settle();
  expect(s.started).toEqual([]);
  expect(s.states.at(-1)).toMatchObject({ reason: "no-reading" });
});

test("a save of the settings looks again", async () => {
  const s = setup({ posts: [held("p1", "2026-11-20T10:00:00.000Z")] });
  s.service.planRead(fresh(s.clock));
  s.service.settingsChanged({ ...SETTINGS, autoStart: false });
  await settle();
  expect(s.started).toEqual([]);
  expect(s.states.at(-1)).toEqual({ on: false, reason: "off", startedToday: 0, perDay: 10 });
  s.service.settingsChanged(SETTINGS);
  await settle();
  expect(s.started).toEqual(["p1"]);
});

test("settings that cannot be read are off", async () => {
  const s = setup({ posts: [held("p1", "2026-11-20T10:00:00.000Z")] });
  s.service.planRead(fresh(s.clock));
  s.service.settingsChanged(null);
  await settle();
  expect(s.started).toEqual([]);
  expect(s.states.at(-1)).toMatchObject({ on: false, reason: "off" });
});

test("a turn's end and a board change look again", async () => {
  const s = setup({ posts: [task("p0", { state: "claimed", claimedBy: "a" })] });
  s.service.planRead(fresh(s.clock));
  s.service.settingsChanged({ ...SETTINGS, autoStartAtOnce: 1 });
  await settle();
  expect(s.states.at(-1)).toMatchObject({ reason: "empty" });
  s.setPosts([...s.posts(), held("p1", "2026-11-20T10:00:00.000Z")]);
  s.service.boardChanged();
  await settle();
  expect(s.states.at(-1)).toMatchObject({ reason: "at-once" });
  const p0 = s.posts().find((post) => post.id === "p0") as Post;
  s.setPosts([{ ...p0, state: "done" }, ...s.posts().filter((post) => post !== p0)]);
  s.service.turnEnded();
  await settle();
  expect(s.started).toEqual(["p1"]);
});

test("at-once counts only the lobby's claimed tasks, and the held passes over notes and done tasks", async () => {
  const s = setup({
    posts: [
      task("p1", { state: "claimed", claimedBy: "a" }),
      task("p2", { state: "done" }),
      task("p3", { kind: "note", state: undefined, backlog: true }),
      task("p4", { board: "w1", state: "claimed", claimedBy: "b" }),
      held("p5", "2026-11-20T10:00:00.000Z"),
    ],
  });
  s.service.planRead(fresh(s.clock));
  s.service.settingsChanged({ ...SETTINGS, autoStartAtOnce: 2 });
  await settle();
  expect(s.started).toEqual(["p5"]);
});

test("no loop: an evaluation that starts nothing schedules nothing", async () => {
  const s = setup({
    posts: [held("p1", "2026-11-20T10:00:00.000Z")],
    kept: { version: 1, day: "2026-11-28", count: 10 },
  });
  s.service.planRead(fresh(s.clock));
  s.service.settingsChanged(SETTINGS);
  await settle();
  const after = s.evaluations();
  expect(after).toBeGreaterThan(0);
  await settle();
  s.clock.advance(60 * 60_000);
  await settle();
  expect(s.evaluations()).toBe(after);
  expect(s.clock.pending()).toBe(0);
});

test("evaluations asked for while one runs are one more run, not one each", async () => {
  const s = setup({ posts: [held("p1", "2026-11-20T10:00:00.000Z")] });
  s.service.settingsChanged({ ...SETTINGS, autoStart: false });
  await settle();
  const before = s.evaluations();
  s.service.boardChanged();
  s.service.boardChanged();
  s.service.boardChanged();
  s.service.turnEnded();
  await settle();
  expect(s.evaluations() - before).toBe(2);
});

test("a start that fails is not counted, and is said once", async () => {
  const s = setup({ posts: [held("p1", "2026-11-20T10:00:00.000Z")], failStart: true });
  s.service.planRead(fresh(s.clock));
  s.service.settingsChanged(SETTINGS);
  await settle();
  s.service.boardChanged();
  await settle();
  expect(s.kept.value).toBeNull();
  expect(s.states.at(-1)).toMatchObject({ startedToday: 0 });
  expect(s.logs.filter((line) => line.includes("disk full"))).toHaveLength(1);
});

test("a task the owner started first is not counted", async () => {
  const s = setup({ posts: [held("p1", "2026-11-20T10:00:00.000Z")] });
  // The owner's Start lands between the gate's look and its start: the board returns the task as
  // it is, with the seq the gate saw.
  s.board.start = async (id) => {
    const post = s.posts().find((item) => item.id === id) as Post;
    return { ok: true, post: { ...post, backlog: undefined } };
  };
  s.service.planRead(fresh(s.clock));
  s.service.settingsChanged(SETTINGS);
  await settle();
  expect(s.kept.value).toBeNull();
});

test("the state is pushed only when it changed", async () => {
  const s = setup({ posts: [] });
  s.service.settingsChanged(SETTINGS);
  await settle();
  s.service.boardChanged();
  await settle();
  s.service.turnEnded();
  await settle();
  expect(s.states).toEqual([{ on: true, reason: "empty", startedToday: 0, perDay: 10 }]);
});

test("the count file is read once it has been read well", async () => {
  const s = setup({ posts: [] });
  s.service.settingsChanged(SETTINGS);
  await settle();
  s.service.boardChanged();
  await settle();
  expect(s.loads()).toBe(1);
});

// The file.

test("the count file: missing is null, a good one is read, anything else rejects", async () => {
  const { mkdtemp, writeFile, readFile, stat } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { autoStartFileStore } = await import("./auto-start.js");
  const folder = await mkdtemp(join(tmpdir(), "auto-start-"));
  const path = join(folder, "office", "auto-start.json");
  const store = autoStartFileStore(path);
  expect(await store.load()).toBeNull();
  await store.save({ version: 1, day: "2026-11-28", count: 3 });
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
    version: 1,
    day: "2026-11-28",
    count: 3,
  });
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(await store.load()).toEqual({ version: 1, day: "2026-11-28", count: 3 });
  for (const bad of [
    "{",
    '{"version":2,"day":"2026-11-28","count":1}',
    '{"version":1,"day":"x","count":-1}',
  ]) {
    await writeFile(path, bad);
    await expect(store.load()).rejects.toThrow();
  }
});
