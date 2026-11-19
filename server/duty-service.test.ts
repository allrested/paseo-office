import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

function memoryFile(initial: DutiesFile | null = null) {
  let kept = initial;
  let failure: string | null = null;
  const file: LifeFile<DutiesFile> & { kept(): DutiesFile | null; fail(message: string): void } = {
    load: async () => kept,
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

function setup(options: { start?: number; file?: DutiesFile | null; zone?: string } = {}) {
  const clock = createFakeClock(options.start ?? WED_7AM);
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
  const file = memoryFile(options.file ?? null);
  const schedules = createLocalSchedules({ clock, log: () => undefined });
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
  schedules.handle(DUTY_SCHEDULE, () => service.sync());
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

test("the file keeps its own versioned shape and a broken one reads as none", async () => {
  const dir = await mkdtemp(join(tmpdir(), "office-duties-"));
  dirs.push(dir);
  const path = join(dir, "office", "duties.json");
  const store = dutiesFileStore(path);
  expect(await store.load()).toBeNull();
  await store.save({ version: 1, duties: [...STARTING_DUTIES] });
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
    version: 1,
    duties: STARTING_DUTIES,
  });
  expect(await store.load()).toEqual({ version: 1, duties: STARTING_DUTIES });
  await writeFile(path, JSON.stringify({ version: 2, duties: [] }));
  expect(await store.load()).toBeNull();
});
