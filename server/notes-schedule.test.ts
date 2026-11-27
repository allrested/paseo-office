import { expect, test } from "vitest";
import { fakeSchedules } from "./fake-schedules.js";
import {
  createNotesSchedule,
  lateNotesRun,
  missedNotesRun,
  NOTES_SCHEDULE,
  notesCadence,
  syncNotesSchedule,
} from "./notes-schedule.js";

const SUNDAY_TO_THURSDAY = [0, 1, 2, 3, 4];
/** Wednesday 11 November 2026, noon in Riyadh. */
const NOON = Date.parse("2026-11-11T09:00:00.000Z");
const RIYADH_EIGHT = {
  type: "cron",
  expression: "0 8 * * 0,1,2,3,4",
  timezone: "Asia/Riyadh",
} as const;

test("no folder, no schedule", () => {
  expect(
    notesCadence(
      { notesFolder: "", notesTimeZone: "", notesDays: SUNDAY_TO_THURSDAY },
      "Asia/Riyadh",
    ),
  ).toBeNull();
});

test("8:00 on the chosen days in the chosen zone, else the host's", () => {
  expect(
    notesCadence(
      { notesFolder: "/n", notesTimeZone: "", notesDays: SUNDAY_TO_THURSDAY },
      "Asia/Riyadh",
    ),
  ).toEqual(RIYADH_EIGHT);
  expect(
    notesCadence({ notesFolder: "/n", notesTimeZone: "", notesDays: [1, 3, 5] }, "Asia/Riyadh"),
  ).toMatchObject({ expression: "0 8 * * 1,3,5" });
  expect(
    notesCadence(
      { notesFolder: "/n", notesTimeZone: "Europe/Berlin", notesDays: SUNDAY_TO_THURSDAY },
      "Asia/Riyadh",
    ),
  ).toMatchObject({ timezone: "Europe/Berlin" });
});

test("no day chosen, no schedule", () => {
  expect(
    notesCadence({ notesFolder: "/n", notesTimeZone: "", notesDays: [] }, "Asia/Riyadh"),
  ).toBeNull();
});

test("a changed day list is a different cadence, so the schedule is saved again", async () => {
  const fake = fakeSchedules();
  const notes = createNotesSchedule({
    schedules: fake,
    hostTimeZone: "Asia/Riyadh",
    log: () => {},
  });
  await notes.sync({ notesFolder: "/n", notesTimeZone: "", notesDays: SUNDAY_TO_THURSDAY });
  await notes.sync({ notesFolder: "/n", notesTimeZone: "", notesDays: [1, 2, 3, 4, 5] });
  expect(
    fake.upserted.map((input) => input.cadence.type === "cron" && input.cadence.expression),
  ).toEqual(["0 8 * * 0,1,2,3,4", "0 8 * * 1,2,3,4,5"]);
});

test("a folder of spaces is no folder, and a zone of spaces is the host's", () => {
  expect(
    notesCadence(
      { notesFolder: "  ", notesTimeZone: "", notesDays: SUNDAY_TO_THURSDAY },
      "Asia/Riyadh",
    ),
  ).toBeNull();
  expect(
    notesCadence(
      { notesFolder: " /n ", notesTimeZone: " ", notesDays: SUNDAY_TO_THURSDAY },
      "Asia/Riyadh",
    ),
  ).toEqual(RIYADH_EIGHT);
  expect(
    notesCadence(
      { notesFolder: "/n", notesTimeZone: " Europe/Berlin ", notesDays: SUNDAY_TO_THURSDAY },
      "Asia/Riyadh",
    ),
  ).toMatchObject({ timezone: "Europe/Berlin" });
});

test("a folder that is not an absolute path is refused", () => {
  expect(() =>
    notesCadence(
      { notesFolder: "docs", notesTimeZone: "", notesDays: SUNDAY_TO_THURSDAY },
      "Asia/Riyadh",
    ),
  ).toThrow("The notes folder must be an absolute path: docs");
});

test("a set folder saves the schedule under its name, with its handler and label", async () => {
  const fake = fakeSchedules();
  await syncNotesSchedule(fake, RIYADH_EIGHT);
  expect(fake.upserted).toEqual([
    {
      name: NOTES_SCHEDULE,
      handler: NOTES_SCHEDULE,
      prompt: "Stand-up notes",
      cadence: RIYADH_EIGHT,
    },
  ]);
  expect(NOTES_SCHEDULE).toBe("standup-notes");
});

test("a schedule that is already so is not saved again, so its next run does not move", async () => {
  const fake = fakeSchedules([
    {
      id: "s1",
      name: NOTES_SCHEDULE,
      handler: NOTES_SCHEDULE,
      cadence: { ...RIYADH_EIGHT },
      nextRunAt: "2026-11-18T05:00:00.000Z",
    },
  ]);
  await syncNotesSchedule(fake, RIYADH_EIGHT);
  expect(fake.upserted).toEqual([]);

  const berlin = { ...RIYADH_EIGHT, timezone: "Europe/Berlin" };
  await syncNotesSchedule(fake, berlin);
  expect(fake.upserted.map((input) => input.cadence)).toEqual([berlin]);
});

test("a cleared folder removes the schedule", async () => {
  const fake = fakeSchedules();
  await syncNotesSchedule(fake, null);
  expect(fake.removed).toEqual(["standup-notes"]);
});

test("an invalid time zone is an error from the save", async () => {
  const fake = fakeSchedules();
  fake.upsertRejects(new Error("Invalid time zone: Mars/Base"));
  await expect(
    syncNotesSchedule(
      fake,
      notesCadence(
        { notesFolder: "/n", notesTimeZone: "Mars/Base", notesDays: SUNDAY_TO_THURSDAY },
        "UTC",
      ),
    ),
  ).rejects.toThrow("Invalid time zone");
});

test("a failed save is logged and kept until a later save succeeds", async () => {
  const fake = fakeSchedules();
  const logs: string[] = [];
  const notes = createNotesSchedule({
    schedules: fake,
    hostTimeZone: "Asia/Riyadh",
    log: (message) => logs.push(message),
  });
  fake.upsertRejects(new Error("Invalid cron time zone: Mars/Base"));
  await notes.sync({
    notesFolder: "/n",
    notesTimeZone: "Mars/Base",
    notesMode: "",
    notesDays: SUNDAY_TO_THURSDAY,
  });
  expect(notes.error()).toBe("Invalid cron time zone: Mars/Base");
  expect(logs).toEqual(["[office] notes schedule failed: Invalid cron time zone: Mars/Base"]);

  // A relative folder fails before the daemon is asked, and the schedule stays as it was.
  fake.upsertRejects(null);
  await notes.sync({ notesFolder: "docs", notesTimeZone: "", notesDays: SUNDAY_TO_THURSDAY });
  expect(notes.error()).toBe("The notes folder must be an absolute path: docs");
  expect(fake.upserted).toEqual([]);
  expect(fake.removed).toEqual([]);

  await notes.sync({
    notesFolder: "/n",
    notesTimeZone: "Europe/Berlin",
    notesMode: "",
    notesDays: SUNDAY_TO_THURSDAY,
  });
  expect(notes.error()).toBeNull();
  expect(fake.upserted.map((input) => input.cadence)).toEqual([
    { ...RIYADH_EIGHT, timezone: "Europe/Berlin" },
  ]);
});

test("changes are synced one at a time, so a slow save cannot land after a later one", async () => {
  const fake = fakeSchedules();
  const notes = createNotesSchedule({
    schedules: fake,
    hostTimeZone: "Asia/Riyadh",
    log: () => {},
  });
  const release = fake.holdNextUpsert();
  const first = notes.sync({ notesFolder: "/n", notesTimeZone: "", notesDays: SUNDAY_TO_THURSDAY });
  const second = notes.sync({
    notesFolder: "/n",
    notesTimeZone: "Europe/Berlin",
    notesMode: "",
    notesDays: SUNDAY_TO_THURSDAY,
  });
  release();
  await Promise.all([first, second]);
  expect(
    fake.upserted.map((input) => input.cadence.type === "cron" && input.cadence.timezone),
  ).toEqual(["Asia/Riyadh", "Europe/Berlin"]);
  expect((await fake.list()).map((schedule) => schedule.cadence)).toEqual([
    { ...RIYADH_EIGHT, timezone: "Europe/Berlin" },
  ]);
});

const at = (iso: string) => Date.parse(iso);

test("a notes run that starts on the day it was due is not late", () => {
  expect(
    lateNotesRun(at("2026-11-19T05:00:00Z"), at("2026-11-19T09:30:00Z"), "Asia/Riyadh"),
  ).toBeNull();
});

test("a notes run that could only start the next day is late, with both days", () => {
  expect(
    lateNotesRun(at("2026-11-19T05:00:00Z"), at("2026-11-20T06:00:00Z"), "Asia/Riyadh"),
  ).toEqual({ dueDay: "2026-11-19", startDay: "2026-11-20" });
});

test("the days are the zone's: midnight east of UTC is passed while the UTC day is the same", () => {
  // 23:59 and 00:01 in Riyadh (UTC+3), both on 18 November in UTC.
  expect(
    lateNotesRun(at("2026-11-18T20:59:00Z"), at("2026-11-18T21:01:00Z"), "Asia/Riyadh"),
  ).toEqual({ dueDay: "2026-11-18", startDay: "2026-11-19" });
});

test("the days are the zone's: midnight west of UTC is passed while the UTC day is the same", () => {
  // 23:59 and 00:01 in New York (UTC-5), both on 19 November in UTC.
  expect(
    lateNotesRun(at("2026-11-19T04:59:00Z"), at("2026-11-19T05:01:00Z"), "America/New_York"),
  ).toEqual({ dueDay: "2026-11-18", startDay: "2026-11-19" });
  // 18:00 and 20:00 in New York, across UTC midnight: the same day there.
  expect(
    lateNotesRun(at("2026-11-18T23:00:00Z"), at("2026-11-19T01:00:00Z"), "America/New_York"),
  ).toBeNull();
});

const RIYADH_VALUES = { notesFolder: "/n", notesTimeZone: "", notesDays: SUNDAY_TO_THURSDAY };

test("the 8:00 run is missed on a stand-up day from 8:00 in the notes' zone", () => {
  // Tuesday 17 November 2026: 07:59 and 08:00 in Riyadh.
  expect(missedNotesRun(RIYADH_VALUES, "Asia/Riyadh", Date.parse("2026-11-17T04:59:00.000Z"))).toBe(
    false,
  );
  expect(missedNotesRun(RIYADH_VALUES, "Asia/Riyadh", Date.parse("2026-11-17T05:00:00.000Z"))).toBe(
    true,
  );
  expect(missedNotesRun(RIYADH_VALUES, "Asia/Riyadh", Date.parse("2026-11-17T20:59:00.000Z"))).toBe(
    true,
  );
});

test("the zone's day counts, not the host's", () => {
  // 22:00 Saturday UTC is 01:00 Sunday in Riyadh, before 8:00; 09:00 Sunday UTC is noon there.
  expect(missedNotesRun(RIYADH_VALUES, "UTC", Date.parse("2026-11-14T22:00:00.000Z"))).toBe(false);
  expect(missedNotesRun(RIYADH_VALUES, "UTC", Date.parse("2026-11-15T09:00:00.000Z"))).toBe(true);
  const auckland = { ...RIYADH_VALUES, notesTimeZone: "Pacific/Auckland" };
  // 20:00 Tuesday UTC is 09:00 Wednesday in Auckland, a stand-up day.
  expect(missedNotesRun(auckland, "UTC", Date.parse("2026-11-17T20:00:00.000Z"))).toBe(true);
});

test("a day that is not a stand-up day, and a schedule that is not set, miss nothing", () => {
  // Friday 20 November 2026, noon in Riyadh.
  const friday = Date.parse("2026-11-20T09:00:00.000Z");
  expect(missedNotesRun(RIYADH_VALUES, "Asia/Riyadh", friday)).toBe(false);
  expect(missedNotesRun({ ...RIYADH_VALUES, notesFolder: "" }, "Asia/Riyadh", NOON)).toBe(false);
  expect(missedNotesRun({ ...RIYADH_VALUES, notesDays: [] }, "Asia/Riyadh", NOON)).toBe(false);
});

test("a sync says whether it saved the schedule", async () => {
  const fake = fakeSchedules();
  const notes = createNotesSchedule({
    schedules: fake,
    hostTimeZone: "Asia/Riyadh",
    log: () => {},
  });
  expect(await notes.sync(RIYADH_VALUES)).toBe(true);
  // Already so: not saved again.
  expect(await notes.sync(RIYADH_VALUES)).toBe(false);
  expect(await notes.sync({ ...RIYADH_VALUES, notesFolder: "" })).toBe(false);
  fake.upsertRejects(new Error("Invalid time zone: Mars/Base"));
  expect(await notes.sync({ ...RIYADH_VALUES, notesTimeZone: "Mars/Base" })).toBe(false);
});
