import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { z } from "zod";
import { createFakeClock } from "./fake-clock.js";
import { createLifeFile, createSaveQueue } from "./life-store.js";

const Shape = z.object({ n: z.number() });
let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "office-life-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

test("a missing, broken or unexpected file loads as nothing; a saved value loads back", async () => {
  const file = join(directory, "office", "lift.json");
  const life = createLifeFile(file, Shape);
  expect(await life.load()).toBeNull();
  await life.save({ n: 1 });
  expect(await life.load()).toEqual({ n: 1 });
  await writeFile(file, "{not json");
  expect(await life.load()).toBeNull();
  await writeFile(file, JSON.stringify({ n: "one" }));
  expect(await life.load()).toBeNull();
});

test("the queue writes the newest value once its time is up, or at once when flushed", async () => {
  const file = join(directory, "tenure.json");
  const clock = createFakeClock(0);
  const logs: string[] = [];
  const queue = createSaveQueue(createLifeFile(file, Shape), clock, (line) => logs.push(line));
  queue.save({ n: 1 });
  queue.save({ n: 2 });
  await expect(readFile(file, "utf8")).rejects.toThrow();
  clock.advance(10_000);
  await queue.flush();
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ n: 2 });
  queue.save({ n: 3 });
  await queue.flush();
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ n: 3 });
  expect(clock.pending()).toBe(0);
  expect(logs).toEqual([]);
});
