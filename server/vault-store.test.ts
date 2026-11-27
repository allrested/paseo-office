import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { createFakeClock } from "./fake-clock.js";
import { createVaultStore } from "./vault-store.js";
import type { Talk } from "./vault.js";

let home = "";
let directory = "";
let legacy = "";

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "office-vault-"));
  directory = join(home, "office", "vault");
  legacy = join(home, "office", "vault.json");
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function talk(text: string): Talk {
  return { name: "Checkout", team: "shop-api", seq: 1, messages: [{ at: 1, role: "user", text }] };
}

function setup() {
  const clock = createFakeClock(0);
  const logs: string[] = [];
  return {
    clock,
    logs,
    store: createVaultStore(directory, legacy, clock, (line) => logs.push(line)),
  };
}

test("a conversation is written to a file of its own, as it is when its time is up", async () => {
  const { store, clock, logs } = setup();
  expect(await store.load()).toBeNull();
  const kept = talk("first");
  store.save("a/1", kept);
  kept.messages.push({ at: 2, role: "assistant", text: "second" });
  await expect(readdir(directory)).rejects.toThrow();
  clock.advance(30_000);
  await store.flush();
  expect(await readdir(directory)).toEqual(["a%2F1.json"]);
  expect((await stat(join(directory, "a%2F1.json"))).mode & 0o777).toBe(0o600);
  expect(await store.load()).toEqual({ version: 1, talks: { "a/1": kept } });
  expect(logs).toEqual([]);
});

test("saving one conversation leaves the others' files alone, and a dropped one goes", async () => {
  const { store } = setup();
  store.save("a", talk("a"));
  store.save("b", talk("b"));
  await store.flush();
  // Whatever the store writes again would lose this mark.
  await writeFile(
    join(directory, "a.json"),
    `${await readFile(join(directory, "a.json"), "utf8")}\n`,
  );
  const untouched = await readFile(join(directory, "a.json"), "utf8");
  store.save("b", talk("b again"));
  await store.flush();
  expect(await readFile(join(directory, "a.json"), "utf8")).toBe(untouched);
  store.drop("a");
  await store.flush();
  expect(await readdir(directory)).toEqual(["b.json"]);
  expect(await store.load()).toEqual({ version: 1, talks: { b: talk("b again") } });
});

test("an earlier version's vault.json is moved into the folder, the folder's copy first", async () => {
  const { store } = setup();
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "a.json"),
    JSON.stringify({ version: 1, agentId: "a", talk: talk("newer") }),
  );
  await writeFile(join(directory, "broken.json"), "{not json");
  await writeFile(
    legacy,
    JSON.stringify({ version: 1, talks: { a: talk("older"), b: talk("b") } }),
  );
  const loaded = await store.load();
  expect(loaded).toEqual({ version: 1, talks: { a: talk("newer"), b: talk("b") } });
  await expect(readFile(legacy, "utf8")).rejects.toThrow();
  expect((await readdir(directory)).sort()).toEqual(["a.json", "b.json", "broken.json"]);
  expect(await setup().store.load()).toEqual(loaded);
});
