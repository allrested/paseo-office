import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import type { Duty, DutyBoard } from "../shared/contracts.js";
import { STARTING_DUTIES } from "../shared/duties.js";
import { EMPTY_BOARDS, type BoardsFile } from "./board-store.js";
import { createBoardService } from "./board-service.js";
import {
  DUTY_SCHEDULE,
  createDutyService,
  dutiesFileStore,
  dutyCadence,
  dutyClock,
  type DutiesFile,
} from "./duty-service.js";
import { createFakeClock, settle } from "./fake-clock.js";
import type { LifeFile } from "./life-store.js";
import { createLocalSchedules } from "./local-schedules.js";

const ZONE = "Asia/Riyadh";
/** Wednesday 18 November 2026, 07:00 in Riyadh. */
const WED_7AM = Date.parse("2026-11-18T04:00:00.000Z");
const HOUR = 60 * 60 * 1000;

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

/** `unreadable`: the load rejects with it, as a kept file that can be neither read nor moved aside. */
function memoryFile(initial: DutiesFile | null = null, unreadable?: string) {
  let kept = initial;
  let failure: string | null = null;
  const file: LifeFile<DutiesFile> & { kept(): DutiesFile | null; fail(message: string): void } = {
    load: async () => {
      if (unreadable !== undefined) throw new Error(unreadable);
      return kept;
    },
    save: async (data) => {
      if (failure !== null) {
        const message = failure;
        failure = null;
        throw new Error(message);
      }
      kept = data;
    },
    kept: () => kept,
    fail: (message) => {
      failure = message;
    },
  };
  return file;
}

function setup(
  options: {
    start?: number;
    file?: DutiesFile | null;
    zone?: string;
    /** The schedule engine's timers fire a millisecond before their time, as a real one can. */
    early?: boolean;
    /** The kept file's load rejects with this. */
    unreadable?: string;
  } = {},
) {
  const clock = createFakeClock(options.start ?? WED_7AM);
  const timers = options.early
    ? {
        now: () => clock.now(),
        setTimeout: (run: () => void, ms: number) => clock.setTimeout(run, Math.max(0, ms - 1)),
      }
    : clock;
  let boards: BoardsFile = EMPTY_BOARDS;
  const board = createBoardService({
    store: {
      load: async () => boards,
      save: async (data) => {
        boards = data;
      },
    },
    clock,
    log: () => undefined,
    label: (author) => author,
    onBoard: () => undefined,
    onBoardRemoved: () => undefined,
  });
  const file = memoryFile(options.file ?? null, options.unreadable);
  const schedules = createLocalSchedules({ clock: timers, log: () => undefined });
  const told: DutyBoard[] = [];
  const listed: (readonly Duty[])[] = [];
  const logs: string[] = [];
  let zone = options.zone ?? ZONE;
  const service = createDutyService({
    file,
    board,
    schedules,
    zone: async () => zone,
    now: () => clock.now(),
    listed: (duties) => listed.push(duties),
    changed: (state) => told.push(state),
    log: (message) => logs.push(message),
  });
  schedules.handle(DUTY_SCHEDULE, (dueAt) => service.sync(dueAt));
  return {
    clock,
    board,
    file,
    schedules,
    service,
    told,
    listed,
    logs,
    setZone: (next: string) => {
      zone = next;
    },
    async begin() {
      await board.start();
      await service.start();
      // (the plugin follows its settings as it starts, which sets the 08:00 schedule)
      await service.settingsChanged();
    },
  };
}

test("the board's day starts at 08:00 in the zone; before it, it is still yesterday's", () => {
  expect(dutyClock(Date.parse("2026-11-18T04:59:00.000Z"), ZONE)).toEqual({
    day: "2026-11-17",
    weekday: 2,
    open: false,
  });
  expect(dutyClock(Date.parse("2026-11-18T05:00:00.000Z"), ZONE)).toEqual({
    day: "2026-11-18",
    weekday: 3,
    open: true,
  });
  expect(dutyCadence("Europe/Berlin")).toEqual({
    type: "cron",
    expression: "0 8 * * *",
    timezone: "Europe/Berlin",
  });
});

test("a host without a list starts on the four pantry chores, posted at 08:00 on a weekday", async () => {
  const { begin, board, service, clock, told, listed } = setup();
  await begin();
  expect(service.list()).toEqual(STARTING_DUTIES);
  expect(listed.at(-1)).toEqual(STARTING_DUTIES);
  expect(board.postsOf("duty")).toEqual([]);
  expect(told.at(-1)).toEqual({ duties: STARTING_DUTIES, day: "2026-11-17" });
  clock.advance(HOUR);
  await settle();
  expect(board.postsOf("duty").map((post) => post.duty)).toEqual(
    STARTING_DUTIES.map((duty) => ({ id: duty.id, day: "2026-11-18" })),
  );
  expect(told.at(-1)?.day).toBe("2026-11-18");
});

test("an 08:00 run that fires a millisecond early still posts the day's duties", async () => {
  const { begin, board, clock, told } = setup({ early: true });
  await begin();
  expect(board.postsOf("duty")).toEqual([]);
  // The run fires at 07:59:59.999, and the clock stays there while it runs.
  clock.advance(HOUR - 1);
  await settle();
  expect(board.postsOf("duty").map((post) => post.duty)).toEqual(
    STARTING_DUTIES.map((duty) => ({ id: duty.id, day: "2026-11-18" })),
  );
  expect(told.at(-1)?.day).toBe("2026-11-18");
});

test("a start after 08:00 on a due day catches up; a Saturday posts nothing and clears done duties", async () => {
  const { begin, board, clock } = setup({ start: WED_7AM + 2 * HOUR });
  await begin();
  expect(board.postsOf("duty")).toHaveLength(4);
  await board.update({ id: "p1", action: "done", actor: "user" });
  // Saturday 21 November, 08:00 in Riyadh.
  clock.advance(Date.parse("2026-11-21T05:00:00.000Z") - clock.now());
  await settle();
  const left = board.postsOf("duty");
  expect(left.map((post) => post.id)).toEqual(["p2", "p3", "p4"]);
  expect(left.every((post) => post.duty?.day === "2026-11-18")).toBe(true);
});

test("an owed duty finished today is not posted again the same day, and leaves the board the next", async () => {
  const build = { id: "build", name: "Build", instructions: "Run the build", days: [1, 2, 3] };
  // Monday 16 November 2026, 07:00 in Riyadh.
  const monday = Date.parse("2026-11-16T04:00:00.000Z");
  const { begin, board, clock, service } = setup({
    start: monday,
    file: { version: 1, duties: [build] },
  });
  await begin();
  clock.advance(HOUR);
  await settle();
  expect(board.postsOf("duty").map((post) => post.duty)).toEqual([
    { id: "build", day: "2026-11-16" },
  ]);
  await board.update({ id: "p1", action: "claim", actor: "a" });
  // Tuesday 08:00: the claimed Monday post is owed, so no second post.
  clock.advance(24 * HOUR);
  await settle();
  expect(board.postsOf("duty").map((post) => post.id)).toEqual(["p1"]);
  // Finished at 10:00 on Tuesday; then a settings save, a save of the list and a restart's catch-up.
  clock.advance(2 * HOUR);
  await board.update({ id: "p1", action: "done", actor: "a" });
  await service.settingsChanged();
  expect(await service.save([build])).toEqual({ ok: true });
  await service.sync();
  expect(board.postsOf("duty").map((post) => [post.id, post.state, post.duty?.day])).toEqual([
    ["p1", "done", "2026-11-16"],
  ]);
  // Wednesday 08:00: done on an earlier day, it leaves, and Wednesday's is posted.
  clock.advance(22 * HOUR);
  await settle();
  expect(board.postsOf("duty").map((post) => [post.state, post.duty?.day])).toEqual([
    ["open", "2026-11-18"],
  ]);
});

test("moving the notes zone west does not post again a duty done today", async () => {
  const daily = { id: "daily", name: "Daily", instructions: "", days: [0, 1, 2, 3, 4, 5, 6] };
  const file = { version: 1 as const, duties: [daily] };
  // Thursday 19 November 2026, 07:00 in Tokyo; Honolulu is 19 hours behind.
  const thursday = Date.parse("2026-11-18T22:00:00.000Z");
  const shown = (posts: { state?: string; duty?: { day: string } }[]) =>
    posts.map((post) => [post.state, post.duty?.day]);

  // Done at 08:30 in Tokyo, Wednesday 13:30 in Honolulu: there it is still Wednesday's day.
  const west = setup({ start: thursday, zone: "Asia/Tokyo", file });
  await west.begin();
  west.clock.advance(HOUR + 30 * 60 * 1000);
  await settle();
  await west.board.update({ id: "p1", action: "done", actor: "user" });
  west.setZone("Pacific/Honolulu");
  await west.service.settingsChanged();
  expect(shown(west.board.postsOf("duty"))).toEqual([["done", "2026-11-19"]]);

  // Done at 08:10 in Tokyo; the zone moves at 07:00 on Friday there, noon on Thursday in Honolulu.
  const later = setup({ start: thursday, zone: "Asia/Tokyo", file });
  await later.begin();
  later.clock.advance(HOUR + 10 * 60 * 1000);
  await settle();
  await later.board.update({ id: "p1", action: "done", actor: "user" });
  later.clock.advance(Date.parse("2026-11-19T22:00:00.000Z") - later.clock.now());
  await settle();
  later.setZone("Pacific/Honolulu");
  await later.service.settingsChanged();
  expect(shown(later.board.postsOf("duty"))).toEqual([["done", "2026-11-19"]]);
  // Friday 08:00 in Honolulu: Thursday's done duty leaves, and Friday's is posted.
  later.clock.advance(Date.parse("2026-11-20T18:00:00.000Z") - later.clock.now());
  await settle();
  expect(shown(later.board.postsOf("duty"))).toEqual([["open", "2026-11-20"]]);
});

test("unticking today on a duty takes its open post of today off at the save; a claimed one stays", async () => {
  const { begin, board, service } = setup({ start: WED_7AM + 2 * HOUR });
  await begin();
  await board.update({ id: "p2", action: "claim", actor: "a" });
  const notWednesday = [1, 2, 4, 5];
  const [cups, bin, plants, tables] = STARTING_DUTIES.map((duty) => ({ ...duty }));
  expect(
    await service.save([
      { ...cups!, days: notWednesday },
      { ...bin!, days: notWednesday },
      plants!,
      tables!,
    ]),
  ).toEqual({ ok: true });
  expect(board.postsOf("duty").map((post) => [post.id, post.duty?.id, post.state])).toEqual([
    ["p3", "plants", "open"],
    ["p4", "tables", "open"],
    ["p2", "bin", "claimed"],
  ]);
});

test("a save that names one id twice keeps it once: the second is a new duty", async () => {
  const { begin, service } = setup();
  await begin();
  const cups = { id: "cups", instructions: "", days: [3] };
  expect(
    await service.save([
      { ...cups, name: "Cups" },
      { ...cups, name: "Cups again" },
    ]),
  ).toEqual({ ok: true });
  const [first, second] = service.list();
  expect(first).toMatchObject({ id: "cups", name: "Cups", chore: "cups" });
  expect(second).toMatchObject({ name: "Cups again" });
  expect(second?.id).not.toBe("cups");
  expect(second).not.toHaveProperty("chore");
});

test("a save is checked, keeps ids and chores, names new duties, and posts one due today at once", async () => {
  const { begin, board, service, file, listed, told } = setup({ start: WED_7AM + 2 * HOUR });
  await begin();
  const refused = await service.save([{ name: "", instructions: "", days: [] }]);
  expect(refused).toEqual({ ok: false, error: "Unable to save: duty 1 has no name" });
  expect(service.list()).toEqual(STARTING_DUTIES);
  const result = await service.save([
    { id: "cups", name: " Mugs ", instructions: "", days: [5, 3] },
    { id: "made-up", name: "Build", instructions: " Run the build ", days: [3] },
  ]);
  expect(result).toEqual({ ok: true });
  const [mugs, build] = service.list();
  expect(mugs).toEqual({ id: "cups", name: "Mugs", instructions: "", days: [3, 5], chore: "cups" });
  expect(build).toMatchObject({ name: "Build", instructions: "Run the build", days: [3] });
  expect(build?.id).not.toBe("made-up");
  expect(build).not.toHaveProperty("chore");
  expect(file.kept()).toEqual({ version: 1, duties: service.list() });
  expect(listed.at(-1)).toEqual(service.list());
  expect(told.at(-1)).toEqual({ duties: service.list(), day: "2026-11-18" });
  expect(board.postsOf("duty").map((post) => [post.text, post.duty?.id])).toEqual([
    ["Mugs", "cups"],
    ["Build\n\nRun the build", build?.id],
  ]);
});

test("a save that cannot be written keeps the list and says why", async () => {
  const { begin, service, file } = setup();
  await begin();
  file.fail("disk full");
  expect(await service.save([{ name: "A", instructions: "", days: [] }])).toEqual({
    ok: false,
    error: "Unable to save the duty list: disk full",
  });
  expect(service.list()).toEqual(STARTING_DUTIES);
});

test("the 08:00 schedule follows the notes zone", async () => {
  const { begin, schedules, service } = setup();
  await begin();
  await service.settingsChanged();
  expect((await schedules.list()).map((entry) => entry.cadence)).toEqual([dutyCadence(ZONE)]);
  expect(service.error()).toBeNull();
});

async function tempPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "office-duties-"));
  dirs.push(dir);
  return join(dir, "office", "duties.json");
}

test("the file keeps its own versioned shape; a broken or newer one is moved aside, not lost", async () => {
  const path = await tempPath();
  const logs: string[] = [];
  let now = 1000;
  const store = dutiesFileStore(path, { now: () => now, log: (line) => logs.push(line) });
  expect(await store.load()).toBeNull();
  await store.save({ version: 1, duties: [...STARTING_DUTIES] });
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
    version: 1,
    duties: STARTING_DUTIES,
  });
  expect(await store.load()).toEqual({ version: 1, duties: STARTING_DUTIES });
  expect(logs).toEqual([]);
  await writeFile(path, JSON.stringify({ version: 2, duties: [] }));
  expect(await store.load()).toBeNull();
  expect(JSON.parse(await readFile(`${path}.corrupt-1000`, "utf8"))).toEqual({
    version: 2,
    duties: [],
  });
  await expect(stat(path)).rejects.toThrow("ENOENT");
  now = 2000;
  await writeFile(path, "{ not json");
  expect(await store.load()).toBeNull();
  expect(await readFile(`${path}.corrupt-2000`, "utf8")).toBe("{ not json");
  expect(logs).toEqual([
    `[office] ${path} is unreadable (unexpected shape, or a newer version); moved to ${path}.corrupt-1000, starting from the pantry chores`,
    expect.stringMatching(
      /^\[office\] .* is unreadable \(.*JSON.*\); moved to .*\.corrupt-2000, starting/,
    ),
  ]);
});

test("a duty file that cannot be read is not taken for a missing one: it is moved aside", async () => {
  const path = await tempPath();
  const logs: string[] = [];
  const store = dutiesFileStore(path, { now: () => 3000, log: (line) => logs.push(line) });
  await store.save({ version: 1, duties: [...STARTING_DUTIES] });
  await chmod(path, 0o000);
  expect(await store.load()).toBeNull();
  expect(logs).toEqual([expect.stringContaining("EACCES")]);
  await chmod(`${path}.corrupt-3000`, 0o600);
  expect(JSON.parse(await readFile(`${path}.corrupt-3000`, "utf8"))).toEqual({
    version: 1,
    duties: STARTING_DUTIES,
  });
});

test("one that cannot even be moved aside rejects, and the list is then never saved over it", async () => {
  const path = await tempPath();
  const store = dutiesFileStore(path, { now: () => 4000, log: () => undefined });
  await store.save({ version: 1, duties: [...STARTING_DUTIES] });
  await chmod(path, 0o000);
  await chmod(join(path, ".."), 0o500);
  try {
    await expect(store.load()).rejects.toThrow("could not be moved aside");
  } finally {
    await chmod(join(path, ".."), 0o700);
    await chmod(path, 0o600);
  }
  const { begin, service, file, logs } = setup({ unreadable: "it could not be moved aside" });
  await begin();
  expect(service.list()).toEqual(STARTING_DUTIES);
  expect(logs).toContain("[office] duty list unreadable: it could not be moved aside");
  expect(await service.save([{ name: "A", instructions: "", days: [] }])).toEqual({
    ok: false,
    error:
      "Unable to save the duty list: the kept one could not be read, and a save would replace it (it could not be moved aside)",
  });
  expect(file.kept()).toBeNull();
});
