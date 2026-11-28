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
  dutyDueMinute,
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
    /** The schedule engine's timers fire this long after their time: a host asleep, or lagging. */
    lateBy?: number;
    /** The kept file's load rejects with this. */
    unreadable?: string;
  } = {},
) {
  const clock = createFakeClock(options.start ?? WED_7AM);
  // How far off their time the engine's timers fire: a millisecond early, or late by `lateBy`.
  const shift = options.early ? -1 : (options.lateBy ?? 0);
  const timers =
    shift === 0
      ? clock
      : {
          now: () => clock.now(),
          setTimeout: (run: () => void, ms: number) =>
            clock.setTimeout(run, Math.max(0, ms + shift)),
        };
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
    workspaceOf: async () => null,
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

const MINUTE = 60 * 1000;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const dutyIds = (board: { postsOf(board: string): { duty?: { id: string } }[] }) =>
  board.postsOf("duty").map((post) => post.duty?.id);

test.each([
  // Wednesday 18 November 2026, 07:00 in Tokyo (UTC+9) and in New York (UTC-5).
  ["Asia/Tokyo", Date.parse("2026-11-17T22:00:00.000Z")],
  ["America/New_York", Date.parse("2026-11-18T12:00:00.000Z")],
])(
  "a duty with a time is due from that time in %s; one without, from 08:00",
  async (zone, start) => {
    const cups = { id: "cups", name: "Cups", instructions: "", days: EVERY_DAY };
    const bin = { id: "bin", name: "Bin", instructions: "", days: EVERY_DAY, time: "14:30" };
    const { begin, board, clock } = setup({
      start,
      zone,
      file: { version: 1, duties: [cups, bin] },
    });
    await begin();
    expect(dutyIds(board)).toEqual([]);
    clock.advance(HOUR);
    await settle();
    expect(dutyIds(board)).toEqual(["cups"]);
    // 14:29, then 14:30, in the zone.
    clock.advance(6 * HOUR + 29 * MINUTE);
    await settle();
    expect(dutyIds(board)).toEqual(["cups"]);
    clock.advance(MINUTE);
    await settle();
    expect(dutyIds(board)).toEqual(["cups", "bin"]);
    expect(board.postsOf("duty").map((post) => post.duty?.day)).toEqual([
      "2026-11-18",
      "2026-11-18",
    ]);
  },
);

test("the timer runs at 08:00 and at each later time a duty has, once per time, and follows each save", async () => {
  const duty = (id: string, time?: string) => ({
    id,
    name: id,
    instructions: "",
    days: [3],
    ...(time === undefined ? {} : { time }),
  });
  expect(
    dutyCadence(ZONE, [duty("a", "08:00"), duty("b", "13:30"), duty("c", "13:30"), duty("d")]),
  ).toEqual({ type: "crons", expressions: ["0 8 * * *", "30 13 * * *"], timezone: ZONE });
  expect(dutyCadence(ZONE, [duty("a", "08:00"), duty("d")])).toEqual(dutyCadence(ZONE));
  expect(dutyDueMinute(duty("b", "13:30"))).toBe(13 * 60 + 30);
  expect(dutyDueMinute(duty("d"))).toBe(8 * 60);

  const { begin, schedules, service } = setup();
  await begin();
  const cadences = async () => (await schedules.list()).map((entry) => entry.cadence);
  expect(await service.save([duty("b", "13:30"), duty("d")])).toEqual({ ok: true });
  expect(await cadences()).toEqual([
    { type: "crons", expressions: ["0 8 * * *", "30 13 * * *"], timezone: ZONE },
  ]);
  expect(service.list()[0]?.time).toBe("13:30");
  expect(await service.save([duty("d")])).toEqual({ ok: true });
  expect(await cadences()).toEqual([dutyCadence(ZONE)]);
});

test("a run at a later time posts only what came due: nothing else is posted again or cleared", async () => {
  // Tuesday 17 November 2026, 07:00 in Riyadh.
  const tuesday = WED_7AM - 24 * HOUR;
  const cups = { id: "cups", name: "Cups", instructions: "", days: [2, 3] };
  const tea = { id: "tea", name: "Tea", instructions: "", days: [2, 3] };
  const bin = { id: "bin", name: "Bin", instructions: "", days: [3], time: "13:30" };
  const { begin, board, clock } = setup({
    start: tuesday,
    file: { version: 1, duties: [cups, tea, bin] },
  });
  await begin();
  clock.advance(HOUR);
  await settle();
  await board.update({ id: "p2", action: "done", actor: "user" });
  // Wednesday 08:00: Tuesday's cups are owed, Tuesday's tea leaves and Wednesday's is posted.
  clock.advance(24 * HOUR);
  await settle();
  expect(board.postsOf("duty").map((post) => [post.duty?.id, post.duty?.day])).toEqual([
    ["cups", "2026-11-17"],
    ["tea", "2026-11-18"],
  ]);
  // Both finished at 10:00: the owed cups count for Wednesday.
  clock.advance(2 * HOUR);
  const [owed, today] = board.postsOf("duty");
  await board.update({ id: owed!.id, action: "done", actor: "user" });
  await board.update({ id: today!.id, action: "done", actor: "user" });
  const before = board.postsOf("duty");
  clock.advance(3 * HOUR + 29 * MINUTE);
  await settle();
  expect(board.postsOf("duty")).toEqual(before);
  clock.advance(MINUTE);
  await settle();
  const after = board.postsOf("duty");
  expect(after.filter((post) => post.duty?.id !== "bin")).toEqual(before);
  expect(after.filter((post) => post.duty?.id === "bin").map((post) => post.duty)).toEqual([
    { id: "bin", day: "2026-11-18" },
  ]);
});

test("a start past a duty's time posts it at once; one whose time is still ahead waits for it", async () => {
  const bin = { id: "bin", name: "Bin", instructions: "", days: [3], time: "14:30" };
  const tea = { id: "tea", name: "Tea", instructions: "", days: [3], time: "16:00" };
  // Wednesday 15:00 in Riyadh.
  const { begin, board, clock } = setup({
    start: WED_7AM + 8 * HOUR,
    file: { version: 1, duties: [bin, tea] },
  });
  await begin();
  expect(dutyIds(board)).toEqual(["bin"]);
  clock.advance(HOUR);
  await settle();
  expect(dutyIds(board)).toEqual(["bin", "tea"]);
});

test("a later time saved on a duty not yet posted delays it; an earlier one already past posts it at the save", async () => {
  const bin = { id: "bin", name: "Bin", instructions: "", days: [3], time: "10:00" };
  const tea = { id: "tea", name: "Tea", instructions: "", days: [3], time: "12:00" };
  const { begin, board, clock, service } = setup({ file: { version: 1, duties: [bin, tea] } });
  await begin();
  // 09:00: neither is due yet.
  clock.advance(2 * HOUR);
  await settle();
  expect(dutyIds(board)).toEqual([]);
  expect(
    await service.save([
      { ...bin, time: "12:00" },
      { ...tea, time: "08:30" },
    ]),
  ).toEqual({
    ok: true,
  });
  expect(dutyIds(board)).toEqual(["tea"]);
  // 10:00 passes without the bin; 12:00 posts it.
  clock.advance(2 * HOUR);
  await settle();
  expect(dutyIds(board)).toEqual(["tea"]);
  clock.advance(HOUR);
  await settle();
  expect(dutyIds(board)).toEqual(["tea", "bin"]);
});

test("a time saved on a duty posted today leaves today's post as it is", async () => {
  const { begin, board, clock, service } = setup({ start: WED_7AM + 2 * HOUR });
  await begin();
  const before = board.postsOf("duty");
  expect(before).toHaveLength(4);
  const [cups, ...others] = STARTING_DUTIES;
  expect(await service.save([{ ...cups!, time: "15:00" }, ...others])).toEqual({ ok: true });
  expect(board.postsOf("duty")).toEqual(before);
  // 15:00 comes and goes: the cups are not posted again.
  clock.advance(7 * HOUR);
  await settle();
  expect(board.postsOf("duty")).toEqual(before);
});

test("a save with a time outside 08:00 to 23:59 is refused, naming the duty", async () => {
  const { begin, service } = setup();
  await begin();
  expect(await service.save([{ name: "Bin", instructions: "", days: [3], time: "07:00" }])).toEqual(
    { ok: false, error: 'Unable to save: Duty "Bin": the time must be between 08:00 and 23:59' },
  );
  expect(service.list()).toEqual(STARTING_DUTIES);
});

test("a kept time written by hand that is not HH:MM from 08:00 reads as 08:00; the file is kept", async () => {
  const path = await tempPath();
  const logs: string[] = [];
  const store = dutiesFileStore(path, { now: () => 5000, log: (line) => logs.push(line) });
  const [cups, bin] = STARTING_DUTIES;
  await store.save({ version: 1, duties: [] });
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      duties: [
        { ...cups, time: "07:00" },
        { ...bin, time: "14:30" },
      ],
    }),
  );
  const kept = await store.load();
  expect(logs).toEqual([]);
  expect(kept?.duties[0]).toEqual(cups);
  expect(kept?.duties[0]?.time).toBeUndefined();
  expect(kept?.duties[1]).toEqual({ ...bin, time: "14:30" });
  expect(dutyDueMinute({ time: "07:00" })).toBe(8 * 60);
  expect(dutyDueMinute({ time: "nonsense" })).toBe(8 * 60);
});

/** Wednesday 18 November 2026, 09:00 in Riyadh, and the duties of a late evening. */
const WED_9AM = WED_7AM + 2 * HOUR;
const LATE = { id: "late", name: "Lock up", instructions: "", days: [3], time: "23:59" };
const THURSDAY = { id: "cups", name: "Cups", instructions: "", days: [4] };
const posted = (board: { postsOf(board: string): { duty?: { id: string; day: string } }[] }) =>
  board.postsOf("duty").map((post) => post.duty);

test.each([
  ["at 00:01", 2 * MINUTE],
  ["at 03:00 after a sleep", 3 * HOUR + MINUTE],
])(
  "a 23:59 run that fires after midnight, %s, still posts its duty on its day",
  async (_, lateBy) => {
    const { begin, board, clock } = setup({
      start: WED_9AM,
      lateBy,
      file: { version: 1, duties: [LATE, THURSDAY] },
    });
    await begin();
    expect(posted(board)).toEqual([]);
    // To the instant the run fires: Wednesday 23:59 in Riyadh is 20:59 UTC.
    clock.advance(Date.parse("2026-11-18T20:59:00.000Z") + lateBy - clock.now());
    await settle();
    expect(posted(board)).toEqual([{ id: "late", day: "2026-11-18" }]);
  },
);

test("a 23:59 run that fires after the next 08:00 is not made up: the board is brought up as of then", async () => {
  // It fires at 08:30 on Thursday; the 08:00 run, as late, has not fired yet.
  const lateBy = 8 * HOUR + 31 * MINUTE;
  const { begin, board, clock, told } = setup({
    start: WED_9AM,
    lateBy,
    file: { version: 1, duties: [LATE, THURSDAY] },
  });
  await begin();
  clock.advance(Date.parse("2026-11-18T20:59:00.000Z") + lateBy - 1 - clock.now());
  await settle();
  expect(posted(board)).toEqual([]);
  clock.advance(1);
  await settle();
  expect(posted(board)).toEqual([{ id: "cups", day: "2026-11-19" }]);
  expect(told.at(-1)?.day).toBe("2026-11-19");
});

test("the 08:00 run that fires at 08:05 posts the morning's duties and not a later one's", async () => {
  const cups = { id: "cups", name: "Cups", instructions: "", days: [3] };
  const { begin, board, clock } = setup({
    lateBy: 5 * MINUTE,
    file: { version: 1, duties: [cups, LATE] },
  });
  await begin();
  clock.advance(HOUR + 5 * MINUTE - 1);
  await settle();
  expect(posted(board)).toEqual([]);
  clock.advance(1);
  await settle();
  expect(posted(board)).toEqual([{ id: "cups", day: "2026-11-18" }]);
});

test("a start after midnight does not make up a late duty whose time passed while it was down", async () => {
  const late = { ...LATE, time: "23:30" };
  // Thursday 00:30 in Riyadh: the board's day is still Wednesday's.
  const { begin, board, told } = setup({
    start: Date.parse("2026-11-18T21:30:00.000Z"),
    file: { version: 1, duties: [late] },
  });
  await begin();
  expect(posted(board)).toEqual([]);
  expect(told.at(-1)?.day).toBe("2026-11-18");
});
