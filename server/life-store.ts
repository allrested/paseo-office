import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { z } from "zod";
import { errorMessage } from "./errors.js";
import type { Timers } from "./timers.js";

/** A small JSON file the office keeps for the staff scenes: office/tenure.json, office/lift.json. */
export interface LifeFile<T> {
  /** The file's value; null when it is missing, unreadable or not of the expected shape. */
  load(): Promise<T | null>;
  /** Writes through a temporary file; one write at a time, in call order. */
  save(data: T): Promise<void>;
}

export function createLifeFile<T>(file: string, schema: z.ZodType<T>): LifeFile<T> {
  let chain: Promise<void> = Promise.resolve();
  let temp = 0;
  function enqueue<R>(task: () => Promise<R>): Promise<R> {
    const run = chain.then(task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  async function read(): Promise<T | null> {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      return null;
    }
    try {
      const parsed = schema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
  async function write(data: T): Promise<void> {
    temp += 1;
    const tempFile = `${file}.tmp-${temp}`;
    await mkdir(dirname(file), { recursive: true });
    try {
      await writeFile(tempFile, `${JSON.stringify(data)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(tempFile, file);
    } catch (error) {
      await rm(tempFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }
  return { load: () => enqueue(read), save: (data) => enqueue(() => write(data)) };
}

/** The newest value written at most once per `ms`; `flush()` writes what waits now. */
export interface SaveQueue<T> {
  save(data: T): void;
  flush(): Promise<void>;
}

export function createSaveQueue<T>(
  file: LifeFile<T>,
  timers: Timers,
  log: (message: string) => void,
  ms = 10_000,
): SaveQueue<T> {
  let waiting: T | null = null;
  let cancel: (() => void) | null = null;
  let writing: Promise<void> = Promise.resolve();
  function flush(): Promise<void> {
    cancel?.();
    cancel = null;
    if (waiting !== null) {
      const data = waiting;
      waiting = null;
      writing = writing
        .then(() => file.save(data))
        .catch((error: unknown) =>
          log(`[office] a staff scene's file could not be saved: ${errorMessage(error)}`),
        );
    }
    return writing;
  }
  return {
    save(data) {
      // The ledger hands over its own object and keeps changing it.
      waiting = structuredClone(data);
      cancel ??= timers.setTimeout(() => void flush(), ms);
    },
    flush,
  };
}
