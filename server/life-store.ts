import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { nodeTimers } from "./timers.js";
import { errorMessage } from "./errors.js";

/** Coalesce ledger updates and replace the file atomically. Flush pending work on shutdown. */
export function createLifeStore(file: string, delay: number, log: (message: string) => void) {
  let pending: unknown;
  let cancel: (() => void) | undefined;
  function flush() {
    cancel?.();
    cancel = undefined;
    if (pending === undefined) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      const tmp = file + ".tmp-" + process.pid;
      writeFileSync(tmp, JSON.stringify(pending), { mode: 0o600 });
      renameSync(tmp, file);
      pending = undefined;
    } catch (error) {
      log("Office state write failed: " + errorMessage(error));
    }
  }
  return {
    load(): unknown {
      if (pending !== undefined) return pending;
      try {
        return JSON.parse(readFileSync(file, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
          log("Office state read failed: " + errorMessage(error));
        return null;
      }
    },
    save(value: unknown) {
      pending = value;
      if (!delay) flush();
      else cancel ??= nodeTimers.setTimeout(flush, delay);
    },
    flush,
  };
}
