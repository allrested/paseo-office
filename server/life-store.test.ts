import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, expect } from "vitest";
import { createLifeStore } from "./life-store.js";
test("a missing ledger starts empty and its latest pending value survives a restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "office-life-"));
  try {
    const file = join(dir, "tenure.json"),
      log = (s: string) => {
        throw new Error(s);
      };
    const a = createLifeStore(file, 10_000, log);
    expect(a.load()).toBeNull();
    a.save({ v: 1 });
    a.save({ v: 2 });
    expect(existsSync(file)).toBe(false);
    a.flush();
    expect(createLifeStore(file, 10_000, log).load()).toEqual({ v: 2 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
