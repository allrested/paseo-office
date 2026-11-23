import { expect, test } from "vitest";
import type { OfficeAgent } from "../shared/contracts.js";
import { coordinatorModels, forgottenText, subModelsText } from "../shared/forgotten.js";
import { readForgotten } from "./forgotten-work.js";
import type { Exec } from "./repo-age.js";

/** A fake git: what each folder prints for the first argument of a command. */
function fakeGit(repos: Record<string, Record<string, string>>): { exec: Exec; calls: string[] } {
  const calls: string[] = [];
  const exec: Exec = async (_command, args, options) => {
    calls.push(`${options.cwd}: ${args.join(" ")}`);
    expect(options.env.GIT_OPTIONAL_LOCKS).toBe("0");
    const repo = repos[options.cwd];
    if (repo === undefined) throw new Error("not a git repository");
    return { stdout: repo[args[0] ?? ""] ?? "", stderr: "" };
  };
  return { exec, calls };
}

test("a checkout with changed files, unpushed commits or a stash is listed with its counts", async () => {
  const { exec } = fakeGit({
    "/w/api": { status: " M a.ts\n?? b.ts\n", log: "abc one\n", stash: "stash@{0}: WIP\n" },
    "/w/clean": { status: "", log: "", stash: "" },
  });
  const found = await readForgotten(
    [
      { workspaceId: "w1", name: "shop-api", folder: "/w/api" },
      { workspaceId: "w2", name: "docs", folder: "/w/clean" },
      { workspaceId: "w3", name: "gone", folder: "/w/missing" },
    ],
    exec,
  );
  expect(found).toEqual([
    { workspaceId: "w1", name: "shop-api", changed: 2, unpushed: 1, stashes: 1 },
  ]);
  expect(forgottenText(found[0]!)).toBe("2 changed files, 1 unpushed commit, 1 stash");
});

test("a repository's worktree no workspace has is looked at too, and its stash is counted once", async () => {
  const worktrees = "worktree /w/api\nHEAD abc\n\nworktree /w/api-old\nHEAD def\n";
  const { exec } = fakeGit({
    "/w/api": {
      status: "",
      log: "",
      stash: "stash@{0}: WIP\n",
      worktree: worktrees,
      "rev-parse": "/w/api/.git\n",
    },
    "/w/api-old": {
      status: " M old.ts\n",
      log: "",
      stash: "stash@{0}: WIP\n",
      "rev-parse": "/w/api/.git\n",
    },
  });
  expect(
    await readForgotten([{ workspaceId: "w1", name: "shop-api", folder: "/w/api" }], exec),
  ).toEqual([
    { workspaceId: "w1", name: "shop-api", changed: 0, unpushed: 0, stashes: 1 },
    { workspaceId: null, name: "api-old", changed: 1, unpushed: 0, stashes: 0 },
  ]);
});

test("a coordinator is listed with its model and the models its sub-agents run on", () => {
  const agent = (id: string, patch: Partial<OfficeAgent>): OfficeAgent => ({
    id,
    title: `Agent ${id}`,
    provider: "claude",
    model: null,
    status: "running",
    workspaceId: null,
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-23T00:00:00.000Z",
    ...patch,
  });
  const found = coordinatorModels([
    agent("lead", { model: "opus" }),
    agent("s1", { parentAgentId: "lead", model: "sonnet" }),
    agent("s2", { parentAgentId: "lead", model: "sonnet" }),
    agent("s3", { parentAgentId: "lead", model: "haiku" }),
    agent("s4", { parentAgentId: "lead", model: "haiku", status: "closed" }),
    agent("solo", { model: "opus" }),
  ]);
  expect(found).toEqual([
    {
      id: "lead",
      name: "Agent lead",
      model: "opus",
      subs: [
        { model: "sonnet", count: 2 },
        { model: "haiku", count: 1 },
      ],
    },
  ]);
  expect(subModelsText(found[0]!.subs)).toBe("2 on sonnet, 1 on haiku");
});
