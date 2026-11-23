import { expect, test } from "vitest";
import type { OfficeAgent, OfficeWorkspace } from "../shared/contracts.js";
import { ALERT_TTL_MS, createWatchers, type WatchedEntry } from "./watchers.js";

function agent(id: string, patch: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: `Agent ${id}`,
    provider: "claude",
    model: null,
    status: "running",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-23T00:00:00.000Z",
    ...patch,
  };
}
const workspace = (checks: string, runs: object[] = []) =>
  [
    {
      id: "w1",
      name: "shop-api",
      pullRequest: { checks, runs },
    },
  ] as unknown as OfficeWorkspace[];

let seq = 0;
function call(id: string, status: string, detail: object, error: unknown = null): WatchedEntry {
  seq += 1;
  return { seq, item: { type: "tool_call", callId: id, name: "Bash", status, detail, error } };
}
const shell = (id: string, status: string, error: unknown = null) =>
  call(id, status, { type: "shell", command: "npm test" }, error);
const edit = (id: string, filePath: string) => call(id, "completed", { type: "edit", filePath });

function setup(options: { named?: boolean; notes?: string } = {}) {
  let now = 0;
  const reminded: string[] = [];
  const watchers = createWatchers({
    now: () => now,
    named: () => options.named ?? true,
    pinnedNotes: () => options.notes ?? "",
    remind: (agentId, notes) => reminded.push(`${agentId}: ${notes}`),
  });
  watchers.view({ agents: [agent("a"), agent("b")], workspaces: workspace("success") });
  // The first read of each agent is what was there before the office looked.
  watchers.tail("a", []);
  watchers.tail("b", []);
  return {
    watchers,
    reminded,
    later(ms: number) {
      now += ms;
    },
    kinds: () => watchers.alerts().map((alert) => alert.kind),
  };
}

test("the same call failing three times running is a loop, until something else happens", () => {
  const { watchers, kinds } = setup();
  watchers.tail("a", [shell("c1", "failed", "exit 1"), shell("c2", "failed", "exit 1")]);
  expect(kinds()).toEqual([]);
  watchers.tail("a", [shell("c3", "running")]);
  expect(kinds()).toEqual([]);
  watchers.tail("a", [shell("c3", "failed", { message: "exit 1" })]);
  expect(watchers.alerts()).toMatchObject([
    {
      id: "loop:a",
      kind: "loop",
      agentId: "a",
      title: "Agent a is stuck in a loop",
      detail: "npm test failed 3 times running: exit 1",
    },
  ]);
  // Dismissed, the same loop is not raised again.
  watchers.dismiss("loop:a");
  watchers.tail("a", [shell("c4", "failed", "exit 1")]);
  expect(kinds()).toEqual([]);
  // Past it, and into it again: that is a new loop.
  watchers.tail("a", [shell("c5", "completed")]);
  watchers.tail("a", [
    shell("c6", "failed", "exit 1"),
    shell("c7", "failed", "exit 1"),
    shell("c8", "failed", "exit 1"),
  ]);
  expect(kinds()).toEqual(["loop"]);
  // The turn ended: the loop is over.
  watchers.view({ agents: [agent("a", { status: "idle" })], workspaces: workspace("success") });
  expect(kinds()).toEqual([]);
});

test("three different failing calls are no loop, and streamer mode names only the tool", () => {
  const { watchers, kinds } = setup({ named: false });
  watchers.tail("a", [
    call("c1", "failed", { type: "shell", command: "npm test" }, "x"),
    call("c2", "failed", { type: "shell", command: "npm run lint" }, "x"),
    call("c3", "failed", { type: "shell", command: "npm test" }, "x"),
  ]);
  expect(kinds()).toEqual([]);
  watchers.tail("a", [shell("c4", "failed", "x"), shell("c5", "failed", "x")]);
  expect(watchers.alerts()[0]?.detail).toBe("Bash failed 3 times running: x");
});

test("a call auto mode refused is told with its reason, for half an hour", () => {
  const { watchers, later, kinds } = setup();
  watchers.tail("a", [
    shell(
      "c1",
      "failed",
      "Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Destructive or Unwanted Actions]. If you have other tasks, continue.",
    ),
  ]);
  expect(watchers.alerts()).toMatchObject([
    {
      kind: "refused",
      agentId: "a",
      title: "Auto mode refused a call of Agent a",
      detail: "npm test: [Destructive or Unwanted Actions]",
    },
  ]);
  later(ALERT_TTL_MS + 1);
  expect(kinds()).toEqual([]);
});

test("two agents changing one file within ten minutes is a clash, once", () => {
  const { watchers, later, kinds } = setup();
  watchers.tail("a", [edit("c1", "/repo/src/app.ts")]);
  // The same agent again, and another file: no clash.
  watchers.tail("a", [edit("c2", "/repo/src/app.ts")]);
  watchers.tail("b", [edit("c3", "/repo/src/other.ts")]);
  expect(kinds()).toEqual([]);
  later(5 * 60_000);
  watchers.tail("b", [edit("c4", "/repo/src/app.ts")]);
  watchers.tail("a", [edit("c5", "/repo/src/app.ts")]);
  expect(watchers.alerts()).toMatchObject([
    {
      kind: "clash",
      agentId: "b",
      otherAgentId: "a",
      title: "Agent b and Agent a are in app.ts",
    },
  ]);
});

test("an edit long after another agent's is no clash", () => {
  const { watchers, later, kinds } = setup();
  watchers.tail("a", [edit("c1", "/repo/src/app.ts")]);
  later(11 * 60_000);
  watchers.tail("b", [edit("c2", "/repo/src/app.ts")]);
  expect(kinds()).toEqual([]);
});

test("a command that found its port taken is told with the port", () => {
  const { watchers } = setup();
  watchers.tail("a", [
    shell("c1", "failed", "Error: listen EADDRINUSE: address already in use :::5173"),
  ]);
  expect(watchers.alerts()).toMatchObject([
    { kind: "port", agentId: "a", port: 5173, title: "Agent a wants port 5173, which is taken" },
  ]);
});

test("failing checks are an alert naming who could fix them, gone when they pass", () => {
  const { watchers, kinds } = setup();
  const runs = [
    { name: "test", status: "failure" },
    { name: "lint", status: "success" },
  ];
  watchers.view({ agents: [agent("a")], workspaces: workspace("failure", runs) });
  expect(watchers.alerts()).toMatchObject([
    {
      id: "checks:w1",
      kind: "checks",
      workspaceId: "w1",
      title: "shop-api: the checks fail",
      detail: "test",
    },
  ]);
  expect(watchers.alerts()[0]?.agentId).toBeUndefined();
  // Its agent rests now: it could take the fix.
  watchers.view({
    agents: [agent("a", { status: "idle" })],
    workspaces: workspace("failure", runs),
  });
  expect(watchers.alerts()[0]?.agentId).toBe("a");
  watchers.view({ agents: [agent("a")], workspaces: workspace("success") });
  expect(kinds()).toEqual([]);
});

test("the pinned notes are said after a compaction during a turn, once, and never when empty", () => {
  const compaction = (): WatchedEntry => {
    seq += 1;
    return { seq, item: { type: "compaction", status: "completed" } };
  };
  const { watchers, reminded } = setup({ notes: " Never push to main. " });
  const done = compaction();
  watchers.tail("a", [done]);
  // The same entry read again is not a second compaction.
  watchers.tail("a", [done]);
  expect(reminded).toEqual(["a: Never push to main."]);

  const silent = setup();
  silent.watchers.tail("a", [compaction()]);
  expect(silent.reminded).toEqual([]);
});

test("what the first read finds is not news, and an agent that left takes its alerts along", () => {
  const { watchers, kinds } = setup();
  watchers.view({ agents: [agent("a"), agent("c")], workspaces: workspace("success") });
  watchers.tail("c", [
    shell("c1", "failed", "denied by the Claude Code auto mode classifier. Reason: old"),
  ]);
  expect(kinds()).toEqual([]);
  watchers.tail("a", [shell("c2", "failed", "listen EADDRINUSE :3000")]);
  expect(kinds()).toEqual(["port"]);
  watchers.view({ agents: [agent("c")], workspaces: workspace("success") });
  expect(kinds()).toEqual([]);
});
