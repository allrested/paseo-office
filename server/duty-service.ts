import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DutySchema, type Duty, type DutyBoard } from "../shared/contracts.js";
import {
  DUTY_DUE_MINUTE,
  STARTING_DUTIES,
  dutyListProblem,
  type DutyDraft,
} from "../shared/duties.js";
import type { BoardService } from "./board-service.js";
import { errorMessage } from "./errors.js";
import { createLifeFile, type LifeFile } from "./life-store.js";
import type { OfficeCadence, OfficeSchedules } from "./local-schedules.js";
import { createScheduleFollower, type OfficeSchedule } from "./schedule-follower.js";

/** The daily run's name among the office's schedules, and the handler that answers it. */
export const DUTY_SCHEDULE = "duty-board";
const DUTIES: OfficeSchedule = { name: DUTY_SCHEDULE, label: "Duty board", logName: "duty board" };

/** `<PASEO_HOME>/office/duties.json`: the owner's duty list, in a versioned shape of its own. */
export const DutiesFileSchema = z.object({ version: z.literal(1), duties: z.array(DutySchema) });
export type DutiesFile = z.output<typeof DutiesFileSchema>;

/** The file; a missing, unreadable or newer one loads as null, and the list is the starting one. */
export function dutiesFileStore(file: string): LifeFile<DutiesFile> {
  return createLifeFile(file, DutiesFileSchema);
}

/** The duty board's day at an instant: from 08:00 in the zone it is that date, before it the day before. */
export interface DutyClock {
  day: string;
  /** The day's weekday, 0 for Sunday. */
  weekday: number;
  /** It is 08:00 or later: the day's duties are due. */
  open: boolean;
}

export function dutyClock(at: number, timeZone: string): DutyClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(at);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const open = read("hour") * 60 + read("minute") >= DUTY_DUE_MINUTE;
  const date = new Date(Date.UTC(read("year"), read("month") - 1, read("day") - (open ? 0 : 1)));
  return { day: date.toISOString().slice(0, 10), weekday: date.getUTCDay(), open };
}

/** The daily run: 08:00 every day in the notes' zone. A day with nothing due still clears the board. */
export function dutyCadence(timeZone: string): OfficeCadence {
  return { type: "cron", expression: "0 8 * * *", timezone: timeZone };
}

export type DutySaveResult = { ok: true } | { ok: false; error: string };

export interface DutyServicePorts {
  file: LifeFile<DutiesFile>;
  board: Pick<BoardService, "syncDuties">;
  schedules: OfficeSchedules;
  /** The notes' zone: the settings', or the host's when they name none or cannot be read. */
  zone(): Promise<string>;
  now(): number;
  /** The list now: the office hands out only duties with instructions. */
  listed(duties: readonly Duty[]): void;
  /** The list and the board's day, for the office's snapshot. */
  changed(board: DutyBoard): void;
  log(message: string): void;
}

export interface DutyService {
  /** Reads the list and brings the board up to it. Never rejects. */
  start(): Promise<void>;
  list(): readonly Duty[];
  save(drafts: readonly DutyDraft[]): Promise<DutySaveResult>;
  /**
   * The 08:00 run, given the instant it was due, and the catch-up at start and at each save.
   * Never rejects.
   */
  sync(dueAt?: number): Promise<void>;
  /** Follows the notes' zone: the schedule, and the day it makes. Never rejects. */
  settingsChanged(): Promise<void>;
  /** Why the 08:00 schedule could not follow the settings; null once it does. */
  error(): string | null;
}

/** A draft as kept: trimmed, days in order, the id and chore of the duty it edits, or a new id. */
function keptDuty(draft: DutyDraft, current: readonly Duty[]): Duty {
  const was = current.find((duty) => duty.id === draft.id);
  return {
    id: was?.id ?? `d-${randomUUID().slice(0, 8)}`,
    name: draft.name.trim(),
    instructions: draft.instructions.trim(),
    days: [...new Set(draft.days)].sort((a, b) => a - b),
    ...(was?.chore === undefined ? {} : { chore: was.chore }),
  };
}

export function createDutyService(ports: DutyServicePorts): DutyService {
  let duties: readonly Duty[] = STARTING_DUTIES;
  let day: string | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const follower = createScheduleFollower({
    schedules: ports.schedules,
    schedule: DUTIES,
    log: ports.log,
  });

  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = chain.then(work);
    chain = run.catch(() => undefined);
    return run;
  }

  function tell(): void {
    ports.changed({ duties: [...duties], day });
  }

  /** `dueAt`: a timer can fire a little before its 08:00, which is then the board's instant. */
  async function bringUp(dueAt?: number): Promise<void> {
    try {
      const clock = dutyClock(Math.max(ports.now(), dueAt ?? 0), await ports.zone());
      const due = clock.open ? duties.filter((duty) => duty.days.includes(clock.weekday)) : [];
      await ports.board.syncDuties({ duties, day: clock.day, due });
      day = clock.day;
    } catch (error) {
      ports.log(`[office] duty board sync failed: ${errorMessage(error)}`);
    }
    tell();
  }

  return {
    start: () =>
      exclusive(async () => {
        const kept = await ports.file.load().catch((error: unknown) => {
          ports.log(`[office] duty list unreadable: ${errorMessage(error)}`);
          return null;
        });
        if (kept !== null) duties = kept.duties;
        ports.listed(duties);
        await bringUp();
      }),
    list: () => duties,
    save: (drafts) =>
      exclusive(async (): Promise<DutySaveResult> => {
        const problem = dutyListProblem(drafts);
        if (problem !== null) return { ok: false, error: problem };
        const next = drafts.map((draft) => keptDuty(draft, duties));
        try {
          await ports.file.save({ version: 1, duties: next });
        } catch (error) {
          return { ok: false, error: `Unable to save the duty list: ${errorMessage(error)}` };
        }
        duties = next;
        ports.listed(duties);
        await bringUp();
        return { ok: true };
      }),
    sync: (dueAt) => exclusive(() => bringUp(dueAt)),
    async settingsChanged() {
      const zone = await ports.zone();
      await follower.sync(() => dutyCadence(zone));
      await exclusive(() => bringUp());
    },
    error: follower.error,
  };
}
