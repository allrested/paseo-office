import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { errorMessage } from "./errors.js";
import {
  MarkSchema,
  TimelineFileSchema,
  WhoSchema,
  type TimelineFile,
  type TimelineLine,
} from "./timeline.js";
import type { Timers } from "./timers.js";

const WhoLineSchema = WhoSchema.extend({ w: MarkSchema.shape.a });

/**
 * The timeline's file, office/timeline.jsonl: a line for each mark and for who each agent is. A
 * change adds lines to its end, so a busy host does not write the whole log again each time.
 */
export interface TimelineStore {
  /** The file's log; an earlier version's timeline.json when there is no file yet; else null. */
  load(): Promise<TimelineFile | null>;
  /** Lines for the file's end, written at most once per `ms`. */
  append(lines: readonly TimelineLine[]): void;
  /** The whole log in place of the file, with the next write; lines that waited are in it. */
  rewrite(file: TimelineFile): void;
  /** Writes what waits now. */
  flush(): Promise<void>;
}

function linesOf(file: TimelineFile): string {
  const who = Object.entries(file.who).map(([w, known]) => JSON.stringify({ w, ...known }));
  return [...who, ...file.marks.map((mark) => JSON.stringify(mark))]
    .map((line) => `${line}\n`)
    .join("");
}

function parse(text: string): TimelineFile {
  const file: TimelineFile = { version: 1, who: {}, marks: [] };
  for (const line of text.split("\n")) {
    if (line === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      // A line cut short by a stop in the middle of a write.
      continue;
    }
    const who = WhoLineSchema.safeParse(value);
    if (who.success) {
      const { w, ...known } = who.data;
      file.who[w] = known;
      continue;
    }
    const mark = MarkSchema.safeParse(value);
    if (mark.success) file.marks.push(mark.data);
  }
  return file;
}

export function createTimelineStore(
  file: string,
  legacyFile: string,
  timers: Timers,
  log: (message: string) => void,
  ms = 30_000,
): TimelineStore {
  let whole: string | null = null;
  let lines = "";
  let cancel: (() => void) | null = null;
  let writing: Promise<void> = Promise.resolve();

  async function write(replace: string | null, add: string): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    if (replace !== null) {
      const temp = `${file}.tmp`;
      try {
        await writeFile(temp, replace, { encoding: "utf8", mode: 0o600 });
        await rename(temp, file);
      } catch (error) {
        await rm(temp, { force: true }).catch(() => undefined);
        throw error;
      }
      await rm(legacyFile, { force: true });
    }
    if (add !== "") await appendFile(file, add, { encoding: "utf8", mode: 0o600 });
  }

  function flush(): Promise<void> {
    cancel?.();
    cancel = null;
    if (whole === null && lines === "") return writing;
    const replace = whole;
    const add = lines;
    whole = null;
    lines = "";
    writing = writing
      .then(() => write(replace, add))
      .catch((error: unknown) =>
        log(`[office] the timeline could not be saved: ${errorMessage(error)}`),
      );
    return writing;
  }

  function soon(): void {
    cancel ??= timers.setTimeout(() => void flush(), ms);
  }

  return {
    async load() {
      try {
        return parse(await readFile(file, "utf8"));
      } catch {
        // No file yet: an earlier version kept the log as one JSON document.
      }
      try {
        const parsed = TimelineFileSchema.safeParse(JSON.parse(await readFile(legacyFile, "utf8")));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    append(added) {
      if (added.length === 0) return;
      // Made into text now: the log keeps changing what it handed over.
      lines += added.map((line) => `${JSON.stringify(line)}\n`).join("");
      soon();
    },
    rewrite(kept) {
      whole = linesOf(kept);
      lines = "";
      soon();
    },
    flush,
  };
}
