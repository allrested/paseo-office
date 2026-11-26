import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createFakeClock } from "./fake-clock.js";
import { createTimelineStore } from "./timeline-store.js";
import type { TimelineFile } from "./timeline.js";

let directory = "";
let file = "";
let legacy = "";
const WHO = { name: "Agent a", team: "shop-api", provider: "claude" };

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "office-timeline-"));
  file = join(directory, "office", "timeline.jsonl");
  legacy = join(directory, "office", "timeline.json");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function setup() {
  const clock = createFakeClock(0);
  const logs: string[] = [];
  return {
    clock,
    logs,
    store: createTimelineStore(file, legacy, clock, (line) => logs.push(line)),
  };
}

test("lines wait for their time, are added to the file's end and load back", async () => {
  const { store, clock, logs } = setup();
  expect(await store.load()).toBeNull();
  store.append([
    { w: "a", ...WHO },
    { t: 1, a: "a", s: "work" },
  ]);
  await expect(readFile(file, "utf8")).rejects.toThrow();
  clock.advance(30_000);
  await store.flush();
  const first = await readFile(file, "utf8");
  store.append([{ t: 2, a: "a", k: "edit" }]);
  await store.flush();
  // The first write's text is still the file's start: nothing was written again.
  expect(await readFile(file, "utf8")).toBe(`${first}{"t":2,"a":"a","k":"edit"}\n`);
  expect(await store.load()).toEqual({
    version: 1,
    who: { a: WHO },
    marks: [
      { t: 1, a: "a", s: "work" },
      { t: 2, a: "a", k: "edit" },
    ],
  });
  expect(logs).toEqual([]);
});

test("a rewrite takes the file's place, and lines added after it follow it", async () => {
  const { store } = setup();
  store.append([{ t: 1, a: "a", s: "work" }]);
  await store.flush();
  // Lines that waited are part of the log handed over.
  store.append([{ t: 2, a: "a", s: "rest" }]);
  const log: TimelineFile = { version: 1, who: { a: WHO }, marks: [{ t: 2, a: "a", s: "rest" }] };
  store.rewrite(log);
  log.marks.push({ t: 3, a: "a", s: "work" });
  store.append([{ t: 3, a: "a", s: "work" }]);
  await store.flush();
  expect((await store.load())?.marks).toEqual([
    { t: 2, a: "a", s: "rest" },
    { t: 3, a: "a", s: "work" },
  ]);
});

test("a line cut short and a line of another shape are skipped, and a newer name holds", async () => {
  const { store } = setup();
  store.append([
    { w: "a", ...WHO },
    { t: 1, a: "a", s: "work" },
    { w: "a", ...WHO, name: "Checkout" },
  ]);
  await store.flush();
  await writeFile(file, `${await readFile(file, "utf8")}{"nothing":1}\n{"t":2,"a":"a","s":"re`);
  expect(await store.load()).toEqual({
    version: 1,
    who: { a: { ...WHO, name: "Checkout" } },
    marks: [{ t: 1, a: "a", s: "work" }],
  });
});

test("an earlier version's timeline.json is read, and goes once the log is written", async () => {
  const { store } = setup();
  const kept: TimelineFile = { version: 1, who: { a: WHO }, marks: [{ t: 1, a: "a", s: "work" }] };
  await mkdir(join(directory, "office"), { recursive: true });
  await writeFile(legacy, JSON.stringify(kept));
  expect(await store.load()).toEqual(kept);
  store.rewrite(kept);
  await store.flush();
  await expect(readFile(legacy, "utf8")).rejects.toThrow();
  expect(await store.load()).toEqual(kept);
});
