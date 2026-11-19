import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { createFakeClock, settle } from "./fake-clock.js";
import { createStreetWatch, streetReaders, TAG_INTERVAL } from "./street-watch.js";
import type { StreetEvent } from "../shared/contracts.js";

test("reads lightweight and annotated local tags and distinguishes an empty repository from a failed read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "office-tags-"));
  const exec = promisify(execFile);
  const readers = streetReaders((command, args, options) => exec(command, args, options));
  const git = (...args: string[]) =>
    exec("git", args, {
      cwd: dir,
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
    });
  try {
    expect(await readers.tags(dir)).toBeNull();
    await git("init");
    expect(await readers.tags(dir)).toEqual(new Set());
    await git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "first",
    );
    await git("tag", "v1");
    await git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "tag",
      "-a",
      "releases/v2",
      "-m",
      "second",
    );
    expect(await readers.tags(dir)).toEqual(new Set(["v1", "releases/v2"]));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("only the local CLI version is accepted", async () => {
  const exec = vi.fn(async () => ({ stdout: "2.1.10 (Claude Code)\n", stderr: "" }));
  expect(await streetReaders(exec).version()).toBe("2.1.10");
  expect(exec).toHaveBeenCalledWith(
    "claude",
    ["--version"],
    expect.objectContaining({ timeout: 5000 }),
  );
  exec.mockResolvedValue({ stdout: "install failed", stderr: "" });
  expect(await streetReaders(exec).version()).toBeNull();
  exec.mockRejectedValue(new Error("ENOENT"));
  expect(await streetReaders(exec).version()).toBeNull();
});

test("streams new tags and genuine CLI upgrades, then cancels polling with the last street", async () => {
  const clock = createFakeClock(1000);
  let tags: Set<string> | null = new Set(["old"]),
    version = "2.1.9";
  const readers = { tags: vi.fn(async () => tags), version: vi.fn(async () => version) };
  const watch = createStreetWatch(readers, clock, () => {});
  watch.view({
    folders: { w: "/repo", unused: "/unused" },
    workspaces: [],
    agents: [
      {
        id: "a",
        workspaceId: "w",
        status: "idle",
        title: null,
        provider: "claude",
        model: null,
        parentAgentId: null,
        permissions: [],
        createdAt: "2026-11-19T08:00:00Z",
      },
    ],
  });
  const first = new AbortController(),
    second = new AbortController(),
    events: StreetEvent[] = [],
    other: StreetEvent[] = [];
  const done = watch.attach({
    signal: first.signal,
    push: async (e) => {
      events.push(e);
    },
  });
  await settle();
  expect(events).toContainEqual({ type: "claude", reading: { version, at: 0 } });
  expect(readers.tags.mock.calls).toEqual([["/repo"]]);
  tags = null;
  clock.advance(TAG_INTERVAL);
  await settle();
  tags = new Set(["old", "v2"]);
  clock.advance(TAG_INTERVAL);
  await settle();
  expect(events.filter((e) => e.type === "release")).toEqual([{ type: "release", tag: "v2" }]);
  const done2 = watch.attach({
    signal: second.signal,
    push: async (e) => {
      other.push(e);
    },
  });
  expect(other.filter((e) => e.type === "release")).toEqual([]);
  version = "2.1.10";
  for (let i = 0; i < 3; i++) {
    clock.advance(TAG_INTERVAL);
    await settle();
  }
  expect(other).toContainEqual({ type: "claude", reading: { version, at: clock.now() } });
  first.abort();
  await done;
  expect(clock.pending()).toBe(1);
  second.abort();
  await done2;
  expect(clock.pending()).toBe(0);
});
