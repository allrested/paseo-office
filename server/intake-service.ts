import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  LOBBY,
  POST_TEXT_MAX,
  SOURCE_KEYS,
  SOURCE_NAMES,
  USER_AUTHOR,
  type IntakeState,
  type Post,
  type PostResult,
  type PostSource,
  type PostSourceKind,
} from "../shared/contracts.js";
import { errorMessage } from "./errors.js";
import { TrackerProblem } from "./incidents-http.js";
import { createLifeFile } from "./life-store.js";
import type { OfficeCadence, OfficeSchedules } from "./local-schedules.js";
import { oneLine } from "./prompt-text.js";
import { createScheduleFollower, type OfficeSchedule } from "./schedule-follower.js";

export type { IntakeState } from "../shared/contracts.js";

/** The intake's schedule's name among the office's schedules, and the handler that answers it. */
export const INTAKE_SCHEDULE = "intake";
const INTAKE: OfficeSchedule = { name: INTAKE_SCHEDULE, label: "Intake", logName: "intake" };
const EVERY_MS = 600_000;

/** The most tickets not seen before that one run reads from a source, and a page's size. */
export const INTAKE_READ_MAX = 20;
/** The most pages one run reads: past seen tickets, 100 matches at most. */
export const INTAKE_PAGES_MAX = 5;
/** The most tickets one run looks at from a source: GitHub's 10 repositories of 20 each. */
const INTAKE_LOOK_MAX = 200;
/** With this many imported tasks open or held, a run posts nothing more. */
export const IMPORTED_OPEN_MAX = 50;
export const TITLE_MAX = 300;
export const BODY_MAX = 1_000;
export const COMMENT_MAX = 2_000;
/** The seen file keeps this many keys, the newest. */
export const SEEN_MAX = 5_000;
const KEY_MAX = 200;
const URL_MAX = 1_500;
/** A failed comment is tried when its task is done and once more at the next run. */
const WRITE_BACK_TRIES = 2;

const UNREADABLE = "intake.json cannot be read: nothing is imported until it can";
const UNSAVED = "intake.json could not be saved";
const CROWDED = "the first 100 matches are already imported: narrow the JQL";

/**
 * A ticket as a source read it. Its title and body are other people's words on their way to an
 * agent's prompt: a source cleans them with `ticketTitle` and `ticketBody`, and the intake cleans
 * them again whatever the source did.
 */
export interface IntakeIssue {
  key: string;
  /** Built by the source from the address it was given and the key, never from the answer. */
  url: string;
  title: string;
  body: string;
}

/** A read's tickets, and how many it left out because their key or shape was unreadable. */
export interface IntakeRead {
  /** Seen ones too: one found only on the board is then recorded. */
  issues: IntakeIssue[];
  skipped: number;
  /** Safe sentences about what a source could not read while it read the rest. */
  problems?: readonly string[];
  /** It read the most pages it may and every ticket was seen: nothing new can come. */
  crowded?: boolean;
}

/** Where tickets come from. The intake knows nothing of a tracker beyond this. */
export interface IntakeSource {
  kind: PostSourceKind;
  /** Whether it has what a read needs: a sign-in and a query. */
  configured(): boolean;
  /**
   * Reads past tickets `seen` says were posted (on the board or in the seen file), so they do not
   * use up a run. Rejects with a `TrackerProblem`, whose message is safe to show.
   */
  read(seen: (key: string) => boolean): Promise<IntakeRead>;
  /** Comments on the ticket; rejects with a `TrackerProblem`. A source without it writes nothing back. */
  comment?(key: string, text: string): Promise<void>;
}

/** The host settings the intake follows. */
export interface IntakeSettings {
  lands: "backlog" | "todo";
  writeBack: boolean;
}

export interface IntakeBoard {
  /** Every board's posts; null until the boards are read. */
  allPosts(): readonly Post[] | null;
  /** Posts as the user. */
  post(input: {
    board: string;
    kind: "task";
    text: string;
    source: PostSource;
    backlog?: boolean;
  }): Promise<PostResult>;
  markWroteBack(id: string): Promise<PostResult>;
  /** An agent's title, as the board names it. */
  label(author: string): string;
}

/** `<PASEO_HOME>/office/intake.json`: each ticket posted, `kind:key`, and when. */
export const IntakeSeenSchema = z.object({
  version: z.literal(1),
  seen: z.record(z.string(), z.string()),
});
export type IntakeSeen = z.output<typeof IntakeSeenSchema>;

export interface IntakeSeenFile {
  /** The kept keys; null when there is no file. Rejects when it cannot be read or is not of the shape. */
  load(): Promise<IntakeSeen | null>;
  save(seen: IntakeSeen): Promise<void>;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function intakeFileStore(file: string): IntakeSeenFile {
  const kept = createLifeFile(file, IntakeSeenSchema);
  return {
    async load() {
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
      return IntakeSeenSchema.parse(JSON.parse(text));
    },
    save: kept.save,
  };
}

/** Cut to `max`, never through the middle of a character that takes two. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/** Cut to `max` with "…" when cut; the whole is `max` at most. */
export function cutMarked(text: string, max: number): string {
  return text.length <= max ? text : `${cut(text, max - 1)}…`;
}

// The marks that turn text around on screen, so what reads as one thing is another.
const TURNS = /[\u202a-\u202e\u2066-\u2069]/g;

/** A ticket's title on one line: control characters and line breaks are spaces. */
export function ticketTitle(text: string): string {
  const flat = text.replace(/[\p{Cc}\u2028\u2029]/gu, " ").replace(TURNS, "");
  return cut(flat.replace(/\s+/g, " ").trim(), TITLE_MAX);
}

/**
 * A ticket's body as plain text: every line break a newline (so the prompt indents each line),
 * control characters but tab gone, cut to `BODY_MAX`.
 */
export function ticketBody(text: string): string {
  const plain = text
    .replace(/\r\n?|[\u0085\u2028\u2029]/g, "\n")
    .replace(/(?![\t\n])\p{Cc}/gu, "")
    .replace(TURNS, "")
    .trim();
  return cutMarked(plain, BODY_MAX);
}

/**
 * `KEY title`, the link, and the body after a blank line. The title is cut for the head to fit and
 * the body for the whole to; null when even the key and the link do not fit.
 */
export function ticketText(issue: IntakeIssue): string | null {
  const bare = issue.key.length + 1 + issue.url.length;
  if (bare > POST_TEXT_MAX) return null;
  const title = cut(issue.title, Math.max(0, POST_TEXT_MAX - bare - 1)).trim();
  const head = `${[issue.key, title].filter((part) => part !== "").join(" ")}\n${issue.url}`;
  const room = POST_TEXT_MAX - head.length - 2;
  if (issue.body === "" || room < 2) return head;
  return `${head}\n\n${cutMarked(issue.body, room)}`;
}

/** The ticket made safe again, or null when its key or link is not of its kind's shape. */
function cleaned(kind: PostSourceKind, issue: IntakeIssue): IntakeIssue | null {
  const { key, url } = issue;
  if (key.length > KEY_MAX || !SOURCE_KEYS[kind].test(key)) return null;
  if (url.length > URL_MAX || !/^https?:\/\/\S+$/.test(url)) return null;
  return { key, url, title: ticketTitle(issue.title), body: ticketBody(issue.body) };
}

/**
 * A problem as the state shows it, and as it is logged: without a tracker's own words, since a
 * refused search can quote the owner's JQL, which is never logged.
 */
interface Problem {
  shown: string;
  logged: string;
}

const said = (text: string): Problem => ({ shown: text, logged: text });

/** A failure as it may be shown: a tracker's own safe words, or only `otherwise`. */
function problemFrom(error: unknown, otherwise: string, before = ""): Problem {
  if (!(error instanceof TrackerProblem)) return said(`${before}${otherwise}`);
  return { shown: `${before}${error.message}`, logged: `${before}${error.withoutWords}` };
}

export interface IntakePorts {
  sources: readonly IntakeSource[];
  board: IntakeBoard;
  file: IntakeSeenFile;
  schedules: OfficeSchedules;
  now(): number;
  /** The intake's state, each time it changes. */
  changed(state: IntakeState): void;
  log(message: string): void;
}

export interface Intake {
  /** The settings now, or null when they cannot be read (nothing runs). Follows with the timer. */
  settingsChanged(settings: IntakeSettings | null): Promise<void>;
  /** Keeps the timer while a source is set up, and removes it otherwise. Never rejects. */
  sync(): Promise<void>;
  /** One run; one asked for while another runs is that run. Never rejects. */
  run(): Promise<IntakeState>;
  /** After any board's change: a task from a ticket that became done is written back. */
  boardChanged(): void;
  state(): IntakeState;
  /** Why the timer could not follow the settings; null once it does. */
  scheduleError(): string | null;
  stop(): void;
}

interface SourceRun {
  lastRun: string | null;
  imported: number;
  problems: readonly Problem[];
}

const NO_RUN: SourceRun = { lastRun: null, imported: 0, problems: [] };

/**
 * Posts each ticket a source reads, once, as the user's lobby task. Two guards keep a ticket from
 * coming twice, the board (any post of that source and key, done or not) and the seen file: a task
 * is posted and then recorded, so a crash between leaves it on the board, where the next run finds
 * it. A seen file that cannot be read posts nothing: a wiped file would bring every ticket again.
 */
export function createIntake(ports: IntakePorts): Intake {
  const follower = createScheduleFollower({
    schedules: ports.schedules,
    schedule: INTAKE,
    log: ports.log,
  });
  // Undefined until the settings are first given: nothing runs before.
  let settings: IntakeSettings | null | undefined;
  const runs = new Map<PostSourceKind, SourceRun>();
  // Why a write back of the kind gave up; it stays until a later one succeeds.
  const writeBackProblems = new Map<PostSourceKind, Problem>();
  const told = new Map<PostSourceKind, string | null>();
  let waiting = false;
  let sent = "";
  let running: Promise<IntakeState> | null = null;
  let stopped = false;
  // Whether each task from a ticket was done when last seen; null until the boards are first seen.
  let doneBefore: Map<string, boolean> | null = null;
  // Failed comments by task id. In memory: after a restart a task may be tried twice more.
  const tries = new Map<string, number>();
  const writing = new Set<string>();
  let writes: Promise<void> = Promise.resolve();

  const sourceOf = (kind: PostSourceKind) => ports.sources.find((source) => source.kind === kind);
  const isOn = (source: IntakeSource) => !stopped && !!settings && source.configured();
  const iso = () => new Date(ports.now()).toISOString();

  function problemsOf(kind: PostSourceKind): Problem[] {
    const written = writeBackProblems.get(kind);
    return [...(runs.get(kind)?.problems ?? []), ...(written === undefined ? [] : [written])];
  }

  function problemOf(kind: PostSourceKind): string | null {
    const parts = problemsOf(kind).map((problem) => problem.shown);
    return parts.length === 0 ? null : parts.join("; ");
  }

  function stateOf(kind: PostSourceKind): IntakeState["jira"] {
    const source = sourceOf(kind);
    const last = runs.get(kind) ?? NO_RUN;
    return {
      configured: source !== undefined && isOn(source),
      problem: problemOf(kind),
      lastRun: last.lastRun,
      imported: last.imported,
    };
  }

  function state(): IntakeState {
    return { jira: stateOf("jira"), github: stateOf("github"), waiting };
  }

  /** Sends the state when it changed, and logs each source's problem once per change. */
  function publish(): void {
    for (const source of ports.sources) {
      const problem = problemOf(source.kind);
      if (problem === (told.get(source.kind) ?? null)) continue;
      told.set(source.kind, problem);
      if (problem === null) continue;
      const logged = problemsOf(source.kind).map((part) => part.logged);
      ports.log(`[office] intake from ${SOURCE_NAMES[source.kind]}: ${logged.join("; ")}`);
    }
    const next = state();
    const text = JSON.stringify(next);
    if (text === sent) return;
    sent = text;
    ports.changed(next);
  }

  /** Imported tasks open or held, of any source: each is work an agent may yet be handed. */
  function openImported(): number {
    const posts = ports.board.allPosts() ?? [];
    return posts.filter(
      (post) => post.source !== undefined && post.kind === "task" && post.state !== "done",
    ).length;
  }

  function onBoard(kind: PostSourceKind, key: string): boolean {
    const posts = ports.board.allPosts() ?? [];
    return posts.some((post) => post.source?.kind === kind && post.source.key === key);
  }

  /** Records `id` as seen now, the newest `SEEN_MAX` kept. */
  function remember(seen: IntakeSeen, id: string): void {
    seen.seen[id] = iso();
    const entries = Object.entries(seen.seen);
    if (entries.length <= SEEN_MAX) return;
    // ISO times of one form sort as text: the newest first.
    entries.sort(([, left], [, right]) => Number(right > left) - Number(right < left));
    seen.seen = Object.fromEntries(entries.slice(0, SEEN_MAX));
  }

  async function saved(seen: IntakeSeen): Promise<boolean> {
    try {
      await ports.file.save(seen);
      return true;
    } catch (error) {
      ports.log(`[office] ${UNSAVED}: ${errorMessage(error)}`);
      return false;
    }
  }

  async function runSource(source: IntakeSource, seen: IntakeSeen): Promise<void> {
    const { kind } = source;
    const name = SOURCE_NAMES[kind];
    const problems: Problem[] = [];
    const add = (problem: Problem) => {
      if (!problems.some((kept) => kept.shown === problem.shown)) problems.push(problem);
    };
    let imported = 0;
    let skipped = 0;
    const finish = () => {
      if (skipped > 0) {
        problems.unshift(
          said(`${skipped} ticket${skipped === 1 ? "" : "s"} skipped: unreadable key`),
        );
      }
      runs.set(kind, { lastRun: iso(), imported, problems });
    };
    if (openImported() >= IMPORTED_OPEN_MAX) {
      waiting = true;
      finish();
      return;
    }
    const isSeen = (key: string) =>
      onBoard(kind, key) || Object.hasOwn(seen.seen, `${kind}:${key}`);
    let read: IntakeRead;
    try {
      read = await source.read(isSeen);
    } catch (error) {
      add(problemFrom(error, `${name} could not be read`));
      finish();
      return;
    }
    skipped = read.skipped;
    if (read.crowded) add(said(CROWDED));
    // A source's own sentences about what it could not read, beside what it did.
    for (const problem of read.problems ?? []) add(said(problem));
    for (const found of read.issues.slice(0, INTAKE_LOOK_MAX)) {
      const issue = cleaned(kind, found);
      const text = issue === null ? null : ticketText(issue);
      if (issue === null || text === null) {
        skipped += 1;
        continue;
      }
      const id = `${kind}:${issue.key}`;
      const known = Object.hasOwn(seen.seen, id);
      if (onBoard(kind, issue.key)) {
        // Posted and not recorded, by a crash between: recorded now, so it stays out once pruned.
        if (known) continue;
        remember(seen, id);
        if (await saved(seen)) continue;
        add(said(UNSAVED));
        break;
      }
      if (known) continue;
      // The run's own cap, whatever a source returns: the rest come at the next run.
      if (imported >= INTAKE_READ_MAX) break;
      if (openImported() >= IMPORTED_OPEN_MAX) {
        waiting = true;
        break;
      }
      const posted = await ports.board.post({
        board: LOBBY,
        kind: "task",
        text,
        source: { kind, key: issue.key, url: issue.url },
        ...(settings?.lands === "todo" ? {} : { backlog: true }),
      });
      if (!posted.ok) {
        // One ticket refused is no reason to leave the next.
        add(said(posted.error));
        continue;
      }
      imported += 1;
      remember(seen, id);
      if (!(await saved(seen))) {
        add(said(UNSAVED));
        break;
      }
    }
    finish();
  }

  async function runOnce(): Promise<void> {
    if (stopped || !settings || ports.board.allPosts() === null) return;
    await retryWriteBacks();
    waiting = false;
    const active = ports.sources.filter(isOn);
    for (const source of ports.sources) {
      if (!active.includes(source)) {
        const last = runs.get(source.kind) ?? NO_RUN;
        runs.set(source.kind, { ...last, imported: 0, problems: [] });
      }
    }
    if (active.length === 0) return;
    let seen: IntakeSeen;
    try {
      seen = (await ports.file.load()) ?? { version: 1, seen: {} };
    } catch {
      // Only that it is unreadable: never import on bad data.
      for (const source of active) {
        runs.set(source.kind, { lastRun: iso(), imported: 0, problems: [said(UNREADABLE)] });
      }
      return;
    }
    for (const source of active) await runSource(source, seen);
  }

  function run(): Promise<IntakeState> {
    if (running !== null) return running;
    const current = (async () => {
      try {
        await writes;
        await runOnce();
      } catch (error) {
        ports.log(`[office] intake failed: ${errorMessage(error)}`);
      } finally {
        running = null;
      }
      publish();
      return state();
    })();
    running = current;
    return current;
  }

  /** Whether a comment on `post`'s ticket is owed now. */
  function owed(post: Post | undefined): post is Post & { source: PostSource } {
    if (post?.source === undefined || post.state !== "done" || post.wroteBack) return false;
    if (!settings?.writeBack || !post.result?.trim()) return false;
    if ((tries.get(post.id) ?? 0) >= WRITE_BACK_TRIES) return false;
    const source = sourceOf(post.source.kind);
    return source?.comment !== undefined && isOn(source);
  }

  function writeBack(id: string): void {
    if (writing.has(id)) return;
    writing.add(id);
    writes = writes
      .then(() => comment(id))
      .catch((error: unknown) => ports.log(`[office] write back failed: ${errorMessage(error)}`))
      .finally(() => writing.delete(id));
  }

  async function comment(id: string): Promise<void> {
    const post = ports.board.allPosts()?.find((item) => item.id === id);
    if (!owed(post)) return;
    const { kind, key } = post.source;
    const holder = post.claimedBy;
    const who =
      holder === undefined || holder === USER_AUTHOR
        ? "the owner"
        : oneLine(ports.board.label(holder));
    const text = cutMarked(
      `Done in the office by ${who}: ${post.result?.trim() ?? ""}`,
      COMMENT_MAX,
    );
    try {
      await sourceOf(kind)?.comment?.(key, text);
    } catch (error) {
      const before = `Unable to comment on ${key}: `;
      // Refused, or the host not reached: the comment did not arrive, and is tried once more. A
      // timeout, or anything else, may have been taken: it is not sent twice.
      if (error instanceof TrackerProblem && error.final) {
        // Never to work (the repository is no longer read): once, and its problem stays.
        tries.set(id, WRITE_BACK_TRIES);
        writeBackProblems.set(kind, problemFrom(error, "", before));
      } else if (error instanceof TrackerProblem && !error.timedOut) {
        const count = (tries.get(id) ?? 0) + 1;
        tries.set(id, count);
        if (count >= WRITE_BACK_TRIES) writeBackProblems.set(kind, problemFrom(error, "", before));
      } else {
        tries.set(id, WRITE_BACK_TRIES);
        const why = problemFrom(error, "the comment failed", before);
        const after = ": the comment may not have arrived";
        writeBackProblems.set(kind, { shown: why.shown + after, logged: why.logged + after });
      }
      publish();
      return;
    }
    tries.delete(id);
    writeBackProblems.delete(kind);
    const marked = await ports.board.markWroteBack(id);
    if (!marked.ok) ports.log(`[office] ${marked.error}`);
    publish();
  }

  /** At a run: each comment that failed once is tried a second time. */
  async function retryWriteBacks(): Promise<void> {
    const posts = ports.board.allPosts() ?? [];
    for (const [id, count] of tries) {
      if (count === 1 && owed(posts.find((post) => post.id === id))) writeBack(id);
    }
    await writes;
  }

  function boardChanged(): void {
    const posts = ports.board.allPosts();
    if (posts === null || stopped) return;
    const before = doneBefore;
    // Until the settings are known, nothing is judged: what became done waits for them.
    if (before !== null && !settings) return;
    const sourced = posts.filter((post) => post.source !== undefined && post.kind === "task");
    doneBefore = new Map(sourced.map((post) => [post.id, post.state === "done"]));
    // The first look is where things stand: a task done before it did not become done now.
    if (before === null) return;
    for (const post of sourced) {
      if (post.state !== "done") {
        // Reopened: a new done is a new write back.
        tries.delete(post.id);
        continue;
      }
      if (before.get(post.id) === false && owed(post)) writeBack(post.id);
    }
  }

  async function sync(): Promise<void> {
    const on = ports.sources.some(isOn);
    const cadence: OfficeCadence | null = on ? { type: "every", everyMs: EVERY_MS } : null;
    await follower.sync(() => cadence);
    publish();
  }

  return {
    async settingsChanged(next) {
      settings = next;
      // What became done while the settings were not known is judged now.
      boardChanged();
      await sync();
    },
    sync,
    run,
    boardChanged,
    state,
    scheduleError: follower.error,
    stop() {
      stopped = true;
    },
  };
}
