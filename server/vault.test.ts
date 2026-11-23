import { expect, test } from "vitest";
import type { OfficeAgent, OfficeWorkspace } from "../shared/contracts.js";
import { promptReport, snippetOf, searchWords } from "../shared/vault.js";
import { createVault, type VaultEntry, type VaultFile } from "./vault.js";

function agent(id: string, patch: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: `Agent ${id}`,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-23T00:00:00.000Z",
    ...patch,
  };
}
const WORKSPACES = [{ id: "w1", name: "shop-api" }] as unknown as OfficeWorkspace[];
const said = (seq: number, type: string, text: string): VaultEntry => ({
  at: seq * 1000,
  seq,
  item: { type, text },
});

function setup(kept: VaultFile | null = null) {
  const timelines = new Map<string, VaultEntry[]>();
  const reads: string[] = [];
  const logs: string[] = [];
  let on = true;
  let saved: VaultFile | null = null;
  const vault = createVault(
    {
      tail: async (agentId) => {
        reads.push(agentId);
        const entries = timelines.get(agentId);
        if (entries === undefined) throw new Error("no such agent");
        return entries;
      },
      on: () => on,
      save: (file) => {
        saved = structuredClone(file);
      },
      log: (message) => logs.push(message),
    },
    kept,
  );
  return {
    vault,
    timelines,
    reads,
    logs,
    saved: () => saved,
    turn(value: boolean) {
      on = value;
    },
    async see(...agents: OfficeAgent[]) {
      vault.view({ agents, workspaces: WORKSPACES });
      await vault.settled();
    },
  };
}

test("an agent is read when first seen and after each turn, and only what is new is kept", async () => {
  const { vault, timelines, reads, see } = setup();
  timelines.set("a", [
    said(1, "user_message", "Fix the login bug in auth.ts"),
    said(2, "tool_call", "ignored"),
    said(3, "assistant_message", "Fixed: the token was read before it was set."),
    said(4, "assistant_message", "   "),
  ]);
  await see(agent("a"));
  // Still resting: nothing new can have been said.
  await see(agent("a"));
  expect(reads).toEqual(["a"]);
  expect(vault.talk("a")).toEqual({
    agentId: "a",
    name: "Agent a",
    team: "shop-api",
    messages: [
      { at: 1000, role: "user", text: "Fix the login bug in auth.ts" },
      { at: 3000, role: "assistant", text: "Fixed: the token was read before it was set." },
    ],
  });

  // A turn: running is not read, its end is.
  timelines
    .get("a")
    ?.push(said(5, "user_message", "Now add a test"), said(6, "assistant_message", "Added."));
  await see(agent("a", { status: "running" }));
  expect(reads).toEqual(["a"]);
  await see(agent("a"));
  expect(reads).toEqual(["a", "a"]);
  expect(vault.talk("a")?.messages.map((message) => message.text)).toEqual([
    "Fix the login bug in auth.ts",
    "Fixed: the token was read before it was set.",
    "Now add a test",
    "Added.",
  ]);
  expect(vault.talk("nobody")).toBeNull();
});

test("a search finds the messages that hold every word, newest first, with the words around", async () => {
  const { vault, timelines, see } = setup();
  timelines.set("a", [
    said(1, "user_message", "Fix the login bug in auth.ts"),
    said(2, "assistant_message", "The Login page has no bug I can find."),
  ]);
  timelines.set("b", [said(3, "user_message", "Write the changelog")]);
  await see(agent("a"), agent("b"));
  expect(vault.search("login BUG").map((hit) => [hit.agentId, hit.role, hit.snippet])).toEqual([
    ["a", "assistant", "The Login page has no bug I can find."],
    ["a", "user", "Fix the login bug in auth.ts"],
  ]);
  expect(vault.search("changelog login")).toEqual([]);
  expect(vault.search("   ")).toEqual([]);
  expect(snippetOf(`${"x".repeat(100)} needle ${"y".repeat(200)}`, searchWords("needle"))).toMatch(
    /^….* needle .*…$/,
  );
});

test("off, nothing is read; a failed read is logged and the rest goes on", async () => {
  const { vault, timelines, reads, logs, turn, see, saved } = setup();
  timelines.set("a", [said(1, "user_message", "Hello there")]);
  turn(false);
  await see(agent("a"));
  expect(reads).toEqual([]);
  expect(saved()).toBeNull();
  turn(true);
  await see(agent("gone"), agent("a"));
  expect(logs).toEqual(["[office] history of gone: no such agent"]);
  expect(vault.search("hello")).toHaveLength(1);
});

test("the kept file is read back and only later entries are added", async () => {
  const first = setup();
  first.timelines.set("a", [said(1, "user_message", "Refactor the hub")]);
  await first.see(agent("a"));
  const second = setup(first.saved());
  second.timelines.set("a", [
    said(1, "user_message", "Refactor the hub"),
    said(2, "assistant_message", "Done."),
  ]);
  await second.see(agent("a"));
  expect(second.vault.talk("a")?.messages.map((message) => message.text)).toEqual([
    "Refactor the hub",
    "Done.",
  ]);
});

test("the prompt report counts what each rule speaks to, with examples, and the clean ones", () => {
  const report = promptReport([
    "make it better",
    "do that thing from before",
    "update the docs and fix the tests and bump the version and deploy",
    "make it better",
    "Add a retry with backoff to the fetch in server/incidents-http.ts and cover it with a test that fails first",
  ]);
  expect(report).toEqual({
    total: 5,
    clean: 1,
    rules: [
      { rule: "vague", count: 2, examples: ["make it better", "make it better"] },
      { rule: "dangling", count: 1, examples: ["do that thing from before"] },
      {
        rule: "multi",
        count: 1,
        examples: ["update the docs and fix the tests and bump the version and deploy"],
      },
    ],
  });
  expect(promptReport([])).toEqual({ total: 0, clean: 0, rules: [] });
});

test("a report reads only the prompts since its start", async () => {
  const { vault, timelines, see } = setup();
  timelines.set("a", [
    said(1, "user_message", "make it better"),
    said(2, "assistant_message", "make it better"),
    said(10, "user_message", "make it better"),
  ]);
  await see(agent("a"));
  expect(vault.report(0).total).toBe(2);
  expect(vault.report(5000).total).toBe(1);
});
