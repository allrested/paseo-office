import { readFile } from "node:fs/promises";
import { z } from "zod";
import { waitingOn } from "../shared/board-rules.js";
import {
  LOBBY,
  type AutoStartCommitted,
  type AutoStartLimit,
  type AutoStartReason,
  type AutoStartState,
  type Post,
} from "../shared/contracts.js";
import type { PlanUsage } from "../shared/plan-usage.js";
import type { StartResult } from "./board-service.js";
import { errorMessage } from "./errors.js";
import { createLifeFile } from "./life-store.js";
import { zoneDate } from "./notes-schedule.js";

export type { AutoStartState } from "../shared/contracts.js";

/** A plan reading older than this is no reading: the limits may have moved since. */
export const READING_STALE_MS = 15 * 60_000;

/** The plan watch's newest reading and the instant it was read. */
export interface PlanReading {
  usage: readonly PlanUsage[];
  at: number;
}

/** The host settings the gate follows; `planHidden` as the Host card's Plan section keeps it. */
export interface GateSettings {
  autoStart: boolean;
  autoStartUnderPct: number;
  autoStartAtOnce: number;
  autoStartPerDay: number;
  planHidden: readonly string[];
}

/** The gate's settings and the notes' zone, whose calendar day the count is of. */
export interface AutoStartSettings extends GateSettings {
  zone: string;
}

export interface GateInput {
  now: number;
  settings: GateSettings;
  reading: PlanReading | null;
  /** Whether a pickup could take the work: it is on and wakes are not paused. */
  pickup: boolean;
  /** The lobby's backlog tasks that wait on nothing. */
  held: number;
  /** The lobby's work already committed: claimed, or open and not held (waiting for an agent or a task). */
  committed: number;
  /** Started by the office today; null when its count cannot be read. */
  startedToday: number | null;
}

export type GateDecision =
  | { open: true }
  | { open: false; reason: AutoStartReason; detail?: AutoStartLimit | AutoStartCommitted };

/** The worst window of the providers the plan pill counts; null when none of them reports one. */
function worstWindow(
  usage: readonly PlanUsage[],
  hidden: readonly string[],
): AutoStartLimit | null {
  let worst: AutoStartLimit | null = null;
  for (const provider of usage) {
    if (hidden.includes(provider.provider)) continue;
    for (const window of provider.windows) {
      if (worst === null || window.usedPct > worst.usedPct) {
        worst = { provider: provider.name, window: window.label, usedPct: window.usedPct };
      }
    }
  }
  return worst;
}

/**
 * Whether the office may start a backlog task now, and why not. It spends the owner's plan, so
 * what it cannot see counts against it: an old reading is none, an unread count starts nothing.
 */
export function gateDecision(input: GateInput): GateDecision {
  const { settings, reading } = input;
  if (!settings.autoStart) return { open: false, reason: "off" };
  // Started work nobody can take would only pile up, and count against the day.
  if (!input.pickup) return { open: false, reason: "no-pickup" };
  if (input.held === 0) return { open: false, reason: "empty" };
  if (reading === null || input.now - reading.at > READING_STALE_MS) {
    return { open: false, reason: "no-reading" };
  }
  // Every window, not each provider's closest: a week at 75% stops it while the 5 hours are low.
  const worst = worstWindow(reading.usage, settings.planHidden);
  if (worst === null) return { open: false, reason: "no-reading" };
  if (worst.usedPct >= settings.autoStartUnderPct) {
    return { open: false, reason: "limit", detail: worst };
  }
  if (input.committed >= settings.autoStartAtOnce) {
    return { open: false, reason: "at-once", detail: { count: input.committed } };
  }
  if (input.startedToday !== null && input.startedToday >= settings.autoStartPerDay) {
    return { open: false, reason: "per-day" };
  }
  if (input.startedToday === null) return { open: false, reason: "no-count" };
  return { open: true };
}

/** `<PASEO_HOME>/office/auto-start.json`: how many the office started on `day` (YYYY-MM-DD). */
export const AutoStartCountSchema = z.object({
  version: z.literal(1),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  count: z.number().int().nonnegative(),
});
export type AutoStartCount = z.output<typeof AutoStartCountSchema>;

export interface AutoStartCountFile {
  /** The kept count; null when there is no file. Rejects when the file cannot be read or is not of the shape. */
  load(): Promise<AutoStartCount | null>;
  save(count: AutoStartCount): Promise<void>;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function autoStartFileStore(file: string): AutoStartCountFile {
  const kept = createLifeFile(file, AutoStartCountSchema);
  return {
    async load() {
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
      return AutoStartCountSchema.parse(JSON.parse(text));
    },
    save: kept.save,
  };
}

export interface AutoStartPorts {
  board: {
    /** Null until the boards are read. */
    lobbyPosts(): readonly Post[] | null;
    /** Every board's posts, for what a held task waits on; null until the boards are read. */
    allPosts(): readonly Post[] | null;
    pickupOpen(): boolean;
    startHeld(id: string, expectedSeq: number): Promise<StartResult>;
  };
  file: AutoStartCountFile;
  now(): number;
  /** The gate's state, each time it changes. */
  changed(state: AutoStartState): void;
  log(message: string): void;
  /** Told as each look begins (tests count them). */
  evaluated?(): void;
}

export interface AutoStart {
  /** The settings now, or null when they cannot be read (the gate is off). Looks again. */
  settingsChanged(settings: AutoStartSettings | null): void;
  /** The plan watch's newest reading, or null once it stops. Looks again. */
  planRead(reading: PlanReading | null): void;
  boardChanged(): void;
  turnEnded(): void;
  /** Looks now; resolves when the look, and any asked for meanwhile, is over. Never rejects. */
  evaluate(): Promise<void>;
  stop(): void;
}

const OFF: GateSettings = {
  autoStart: false,
  autoStartUnderPct: 70,
  autoStartAtOnce: 3,
  autoStartPerDay: 10,
  planHidden: [],
};

function oldestFirst(a: Post, b: Post): number {
  if (a.createdAt === b.createdAt) return a.seq - b.seq;
  return a.createdAt < b.createdAt ? -1 : 1;
}

/**
 * Starts the lobby's oldest backlog task while the gate is open, one per look. A look is asked for
 * by a board change, a plan reading, a turn's end and a save of the settings, never by a timer: a
 * start changes the board, which brings the next look; a look that starts nothing asks for none.
 */
export function createAutoStart(ports: AutoStartPorts): AutoStart {
  // Undefined until the settings are first given: nothing is looked at before.
  let settings: AutoStartSettings | null | undefined;
  let reading: PlanReading | null = null;
  // The kept count, once the file was read well; a file that could not be read is tried again.
  let count: AutoStartCount | null = null;
  let loaded = false;
  let unreadableSaid = false;
  let failureSaid: string | null = null;
  let sent = "";
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;

  /** Reads the count file until it has been read well; false while it cannot be. */
  async function countLoaded(): Promise<boolean> {
    if (loaded) return true;
    try {
      count = await ports.file.load();
      loaded = true;
      unreadableSaid = false;
      return true;
    } catch (error) {
      if (!unreadableSaid) {
        ports.log(
          `[office] auto-start.json cannot be read (${errorMessage(error)}): nothing is started by itself until it can`,
        );
      }
      unreadableSaid = true;
      return false;
    }
  }

  function publish(decision: GateDecision, started: number, perDay: number): void {
    const state: AutoStartState = {
      on: settings?.autoStart ?? false,
      reason: decision.open ? null : decision.reason,
      ...(!decision.open && decision.detail !== undefined ? { detail: decision.detail } : {}),
      startedToday: started,
      perDay,
    };
    const text = JSON.stringify(state);
    if (text === sent) return;
    sent = text;
    ports.changed(state);
  }

  /** Writes the day's count; false (and logged) when it cannot be written. */
  async function saveCount(next: AutoStartCount): Promise<boolean> {
    try {
      await ports.file.save(next);
      count = next;
      return true;
    } catch (error) {
      ports.log(`[office] auto-start.json could not be saved: ${errorMessage(error)}`);
      return false;
    }
  }

  /** The lobby's held tasks that wait on nothing, and its work already committed. */
  function lobbyWork(): { ready: Post[]; committed: number } {
    const everything = ports.board.allPosts() ?? [];
    const posts = (ports.board.lobbyPosts() ?? []).filter(
      (post) => post.board === LOBBY && post.kind === "task",
    );
    // A held task that still waits would use a start, then be handed out later with no plan check.
    const ready = posts.filter(
      (post) =>
        post.backlog === true && post.state === "open" && waitingOn(post, everything).length === 0,
    );
    const committed = posts.filter(
      (post) => post.state === "claimed" || (post.state === "open" && post.backlog !== true),
    ).length;
    return { ready, committed };
  }

  async function look(): Promise<void> {
    if (stopped) return;
    ports.evaluated?.();
    const readable = settings === null ? false : await countLoaded();
    // Read after the load: a switch-off saved meanwhile holds for this look.
    const current = settings ?? null;
    const gate = current ?? OFF;
    const now = ports.now();
    const day = current === null ? null : zoneDate(now, current.zone);
    let started: number | null = null;
    if (readable && day !== null) started = count !== null && count.day === day ? count.count : 0;
    const { ready, committed } = lobbyWork();
    const decision = gateDecision({
      now,
      settings: gate,
      reading,
      pickup: ports.board.pickupOpen(),
      held: ready.length,
      committed,
      startedToday: current === null ? 0 : started,
    });
    publish(decision, started ?? 0, gate.autoStartPerDay);
    const oldest = ready.sort(oldestFirst)[0];
    if (!decision.open || day === null || started === null || oldest === undefined) return;
    await startOne(oldest, day, started, gate.autoStartPerDay);
  }

  /** Starts `oldest`, counted first and put back unless this start took its hold off. */
  async function startOne(oldest: Post, day: string, started: number, perDay: number) {
    // Counted before the start: a crash between the two errs toward starting less.
    const before: AutoStartCount = { version: 1, day, count: started };
    const after: AutoStartCount = { version: 1, day, count: started + 1 };
    if (!(await saveCount(after))) return;
    const result = await ports.board.startHeld(oldest.id, oldest.seq);
    if (result.ok && result.started) {
      failureSaid = null;
      ports.log(`[office] started ${oldest.id} from the backlog by itself (${after.count} today)`);
      publish({ open: true }, after.count, perDay);
      return;
    }
    // Not the office's start: a save that failed, or the owner's Start got there first.
    await saveCount(before);
    if (!result.ok) {
      // A board's change would bring the next try; a save that fails brings none, so no loop.
      if (failureSaid !== result.error) {
        ports.log(`[office] auto-start of ${oldest.id} failed: ${result.error}`);
      }
      failureSaid = result.error;
    }
    publish({ open: true }, started, perDay);
  }

  function evaluate(): Promise<void> {
    if (settings === undefined || stopped) return Promise.resolve();
    if (running !== null) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          try {
            await look();
          } catch (error) {
            ports.log(`[office] auto-start failed: ${errorMessage(error)}`);
          }
        } while (again);
      } finally {
        // In the same turn as the last check of `again`, so a look asked for now is not lost.
        running = null;
      }
    })();
    return running;
  }

  return {
    settingsChanged(next) {
      settings = next;
      void evaluate();
    },
    planRead(next) {
      reading = next;
      void evaluate();
    },
    boardChanged: () => void evaluate(),
    turnEnded: () => void evaluate(),
    evaluate,
    stop() {
      stopped = true;
    },
  };
}
