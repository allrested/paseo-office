import { expect, test } from "vitest";
import {
  newAgentProblem,
  providerOptions,
  providersStarting,
  startingAgent,
  workspaceGroups,
  workspaceOptions,
  type ProviderOption,
  type WorkspaceOption,
} from "./new-agent-model.js";

const COMPLETE = { workspaceId: "w1", provider: "claude", model: "opus", prompt: "Fix it" };

test("a complete form has no problem", () => {
  expect(newAgentProblem(COMPLETE)).toBeNull();
});

test("each missing part is named, in the order workspace, provider, model, prompt", () => {
  const empty = { workspaceId: null, provider: null, model: null, prompt: "" };
  expect(newAgentProblem(empty)).toBe("Choose a workspace.");
  expect(newAgentProblem({ ...empty, workspaceId: "w1" })).toBe("Choose a provider.");
  expect(newAgentProblem({ ...empty, workspaceId: "w1", provider: "claude" })).toBe(
    "Choose a model.",
  );
  expect(newAgentProblem({ ...COMPLETE, prompt: "" })).toBe("Write the first prompt.");
});

test("a prompt of only spaces is no prompt", () => {
  expect(newAgentProblem({ ...COMPLETE, prompt: " \n " })).toBe("Write the first prompt.");
});

const WORKSPACES: WorkspaceOption[] = [
  { id: "1", name: "main", projectId: "p2", projectName: "shop-web", directory: "/src/shop-web" },
  { id: "2", name: "Checkout", projectId: "p1", projectName: "Acme API", directory: "/src/api" },
  { id: "3", name: "billing", projectId: "p1", projectName: "Acme API", directory: "/src/api-b" },
];

test("workspaces are grouped by project, each group and list in name order", () => {
  const groups = workspaceGroups(WORKSPACES, "");
  expect(groups.map((g) => g.projectName)).toEqual(["Acme API", "shop-web"]);
  expect(groups[0]?.workspaces.map((w) => w.name)).toEqual(["billing", "Checkout"]);
});

test("a search matches a workspace's or a project's name, in any case", () => {
  expect(workspaceGroups(WORKSPACES, "CHECK")).toEqual([
    { projectId: "p1", projectName: "Acme API", workspaces: [WORKSPACES[1]] },
  ]);
  const byProject = workspaceGroups(WORKSPACES, " shop ");
  expect(byProject.map((g) => g.projectName)).toEqual(["shop-web"]);
  expect(workspaceGroups(WORKSPACES, "acme")[0]?.workspaces).toHaveLength(2);
  expect(workspaceGroups(WORKSPACES, "zzz")).toEqual([]);
});

const PROVIDERS: ProviderOption[] = [
  {
    id: "claude",
    label: "Claude",
    models: [
      { id: "sonnet", label: "Sonnet", isDefault: false },
      { id: "opus", label: "Opus", isDefault: true },
    ],
  },
  { id: "codex", label: "Codex", models: [{ id: "gpt", label: "GPT", isDefault: false }] },
];

test("the last choice is the start while it is still offered", () => {
  expect(startingAgent(PROVIDERS, { provider: "codex", model: "gpt" })).toEqual({
    provider: "codex",
    model: "gpt",
  });
});

test("a last choice that is no longer offered falls back to the first provider's default", () => {
  const fallback = { provider: "claude", model: "opus" };
  expect(startingAgent(PROVIDERS, null)).toEqual(fallback);
  expect(startingAgent(PROVIDERS, { provider: "gone", model: "x" })).toEqual(fallback);
  expect(startingAgent(PROVIDERS, { provider: "claude", model: "retired" })).toEqual(fallback);
});

test("without a default the first model starts; without a provider nothing does", () => {
  expect(startingAgent([PROVIDERS[1]!], null)).toEqual({ provider: "codex", model: "gpt" });
  expect(startingAgent([], { provider: "claude", model: "opus" })).toEqual({
    provider: null,
    model: null,
  });
  expect(startingAgent([{ id: "x", label: "X", models: [] }], null)).toEqual({
    provider: null,
    model: null,
  });
});

test("a provider with no models is never the start", () => {
  const empty: ProviderOption = { id: "x", label: "X", models: [] };
  expect(startingAgent([empty, ...PROVIDERS], null)).toEqual({ provider: "claude", model: "opus" });
  expect(startingAgent([empty], { provider: "x", model: "any" })).toEqual({
    provider: null,
    model: null,
  });
});

test("only a provider that is ready and enabled is an option, with its selectable models", () => {
  const options = providerOptions([
    {
      provider: "claude",
      status: "ready",
      enabled: true,
      label: "Claude Code",
      models: [
        { provider: "claude", id: "opus", label: "Opus", isDefault: true },
        { provider: "claude", id: "hidden", label: "Hidden", isSelectable: false },
      ],
    },
    { provider: "codex", status: "loading", enabled: true, models: [] },
    { provider: "gemini", status: "ready", enabled: false, models: [] },
    { provider: "amp", status: "error", enabled: true, models: [] },
    { provider: "pi", status: "ready", enabled: true },
  ]);
  expect(options).toEqual([
    {
      id: "claude",
      label: "Claude Code",
      models: [{ id: "opus", label: "Opus", isDefault: true }],
    },
    { id: "pi", label: "pi", models: [] },
  ]);
});

test("workspaces become options with the folder an agent starts in", () => {
  const base = {
    id: "w",
    projectId: "p",
    projectDisplayName: "Acme",
    projectRootPath: "/src/acme",
    name: "main",
    archivingAt: null,
  };
  expect(
    workspaceOptions([
      base,
      { ...base, id: "wt", workspaceDirectory: "/src/acme-wt" },
      { ...base, id: "gone", archivingAt: "2026-11-19T00:00:00Z" },
    ] as never),
  ).toEqual([
    { id: "w", name: "main", projectId: "p", projectName: "Acme", directory: "/src/acme" },
    { id: "wt", name: "main", projectId: "p", projectName: "Acme", directory: "/src/acme-wt" },
  ]);
});

const SLOW = [{ id: "codex", label: "Codex" }];

test("providersStarting lists the enabled providers that are still loading, by id and label", () => {
  const entry = (provider: string, status: string, enabled = true) =>
    ({ provider, status, enabled, label: provider.toUpperCase() }) as never;
  expect(
    providersStarting([
      entry("a", "loading"),
      entry("b", "ready"),
      entry("c", "error"),
      entry("d", "loading", false),
    ]),
  ).toEqual([{ id: "a", label: "A" }]);
});

test("a provider that is still starting is named as the problem once the workspace is chosen", () => {
  expect(newAgentProblem({ ...COMPLETE, provider: "codex", model: "gpt" }, SLOW)).toBe(
    "Codex is still starting.",
  );
  expect(newAgentProblem(COMPLETE, SLOW)).toBeNull();
});

test("a remembered provider that is still loading stays the start, with its model", () => {
  const ready = PROVIDERS.filter((entry) => entry.id !== "codex");
  expect(startingAgent(ready, { provider: "codex", model: "gpt" }, SLOW)).toEqual({
    provider: "codex",
    model: "gpt",
  });
  // A remembered provider that is neither offered nor loading is still moved off.
  expect(startingAgent(ready, { provider: "gone", model: "x" }, SLOW)).toEqual({
    provider: "claude",
    model: "opus",
  });
});
