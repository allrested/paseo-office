/**
 * @vitest-environment jsdom
 */
// New agent, mounted as the Sessions tab mounts it, with the host's workspaces, providers and
// agent creation stood in. The device setting is a stand-in too, and records its saves.
import { act, createElement, useCallback, useMemo, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EMPTY_CHOICE, type NewAgentChoice } from "./new-agent-model.js";
import type { NewAgentDraft, OfficeLink } from "./office-link.js";
import { EMPTY_OFFICE } from "./office-state.js";
import { SessionsPanel } from "./sessions-panel.js";
import { useOfficeStyles } from "./styles.js";
import type { OfficeState } from "./use-office.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { TextInput, View } = await import("react-native");
  const ScrollView = (props: { children: ReactNode }) =>
    createElement("div", { "data-scroll": "vertical" }, createElement(View, null, props.children));
  return { ScrollView, TextInput };
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

interface Stored {
  status: string;
  values?: Record<string, unknown>;
  revision?: string;
}

const host = vi.hoisted(() => ({
  workspaceCalls: [] as Record<string, unknown>[],
  providerCalls: 0,
  /** The options each waitForReady got; when set, the wait times out as a slow provider's would. */
  waits: [] as unknown[],
  waitTimesOut: false,
  snapshots: 0,
  created: [] as Record<string, unknown>[],
  saves: [] as { values: unknown; revision: string }[],
  pages: [] as unknown[],
  providers: null as unknown,
  create: null as unknown,
  device: null as unknown,
  /** What the device's save answers; the SDK's save never throws, it answers false when refused. */
  saved: true,
}));

// One object for every render, as the host's SDK object is: a new one would read again each time.
const sdk = vi.hoisted(() => ({
  workspaces: {
    ref: null as unknown as (workspaceId: string) => unknown,
    list: (options: Record<string, unknown>) => {
      host.workspaceCalls.push(options);
      return Promise.resolve(host.pages.shift());
    },
  },
  providers: {
    waitForReady: (options: unknown) => {
      host.providerCalls += 1;
      host.waits.push(options);
      return host.waitTimesOut
        ? Promise.reject(new Error("Timed out waiting for providers: gemini"))
        : Promise.resolve(host.providers);
    },
    snapshot: () => {
      host.snapshots += 1;
      return Promise.resolve(host.providers);
    },
  },
  agents: {
    // Without a workspace id the host makes a new workspace for the folder: never called.
    create: (options: Record<string, unknown>) => {
      host.created.push({ withoutWorkspace: true, ...options });
      return Promise.reject(new Error("agents.create takes no workspace"));
    },
  },
}));
sdk.workspaces.ref = (workspaceId: string) => ({
  agents: {
    create: (options: Record<string, unknown>) => {
      host.created.push({ workspaceId, ...options });
      return (host.create as (options: Record<string, unknown>) => Promise<{ id: string }>)(
        options,
      );
    },
  },
});

vi.mock("@getpaseo/plugin/client", () => ({
  usePaseo: () => sdk,
  useSettings: () => ({
    ...(host.device as Stored),
    saving: false,
    saveError: null,
    save: async (values: unknown, revision: string) => {
      host.saves.push({ values, revision });
      return host.saved;
    },
    reset: async () => true,
    reload: async () => undefined,
  }),
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const LAYOUT = { compact: true, platform: "web" } as const;

function workspace(id: string, name: string, project: string, directory: string) {
  return {
    id,
    name,
    projectId: project.toLowerCase(),
    projectDisplayName: project,
    projectRootPath: directory,
    workspaceDirectory: directory,
    archivingAt: null,
  };
}

const WORKSPACE_PAGE = {
  entries: [
    workspace("w1", "main", "Shop", "/src/shop"),
    workspace("w2", "checkout", "Shop", "/src/shop-checkout"),
    workspace("w3", "main", "Blog", "/src/blog"),
  ],
  pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
};

const PROVIDERS = {
  entries: [
    {
      provider: "claude",
      status: "ready",
      enabled: true,
      label: "Claude",
      models: [
        { provider: "claude", id: "sonnet", label: "Sonnet" },
        { provider: "claude", id: "opus", label: "Opus", isDefault: true },
      ],
    },
    {
      provider: "codex",
      status: "ready",
      enabled: true,
      label: "Codex",
      models: [{ provider: "codex", id: "gpt", label: "GPT", isDefault: true }],
    },
    { provider: "gemini", status: "unavailable", enabled: true, label: "Gemini", models: [] },
  ],
};

/** What the draft holds when the office mounts: a test's remembered choice. */
let startChoice: NewAgentChoice;
let opened: string[];
let container: HTMLElement;
let root: Root;

const office: OfficeState = {
  state: EMPTY_OFFICE,
  loaded: true,
  subscription: { status: "live" },
  chat: null,
};

/** The draft as the surface holds it: state above the panel, so the panel keeps none. */
function useDraft(): NewAgentDraft {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<NewAgentChoice>(startChoice);
  const change = useCallback(
    (patch: Partial<NewAgentChoice>) => setChoice((current) => ({ ...current, ...patch })),
    [],
  );
  return useMemo(() => ({ open, setOpen, choice, change }), [open, choice, change]);
}

function Harness() {
  const styles = useOfficeStyles(THEME, LAYOUT.compact, false);
  const newAgent = useDraft();
  const link: OfficeLink = { select: () => undefined, openSession: (id) => void opened.push(id) };
  return createElement(SessionsPanel, {
    office,
    styles,
    theme: THEME,
    layout: LAYOUT,
    link,
    newAgent,
  });
}

function maybe(label: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}
function labelled(label: string): HTMLElement {
  const found = maybe(label);
  if (!found) throw new Error(`Nothing is labelled "${label}"`);
  return found;
}
async function press(label: string): Promise<void> {
  const button = labelled(label);
  await act(async () => button.click());
}
async function type(label: string, text: string): Promise<void> {
  const field = labelled(label);
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function settle(): Promise<void> {
  await act(async () => undefined);
}
async function openForm(): Promise<void> {
  await press("New agent");
  await settle();
}
const selected = (label: string) => labelled(label).getAttribute("aria-selected");
const checked = (label: string) => labelled(label).getAttribute("aria-checked");

async function fillForm(prompt = "Fix the cart"): Promise<void> {
  await press("main: /src/shop");
  await type("First prompt", prompt);
}

beforeEach(() => {
  startChoice = EMPTY_CHOICE;
  opened = [];
  host.workspaceCalls = [];
  host.providerCalls = 0;
  host.waits = [];
  host.waitTimesOut = false;
  host.snapshots = 0;
  host.created = [];
  host.saves = [];
  host.saved = true;
  host.pages = [WORKSPACE_PAGE];
  host.providers = PROVIDERS;
  host.create = async () => ({ id: "agent-new" });
  host.device = { status: "ready", values: { threeD: true, rungIncidents: {} }, revision: "r1" };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(Harness)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("the form is read when it opens, not when the office does", async () => {
  expect(host.workspaceCalls).toEqual([]);
  expect(host.providerCalls).toBe(0);
  await openForm();
  expect(host.workspaceCalls).toHaveLength(1);
  expect(host.providerCalls).toBe(1);
});

test("New agent opens the form in the tab's place, and Back returns to the list", async () => {
  expect(maybe("Search agents")).not.toBeNull();
  await openForm();
  expect(maybe("Search agents")).toBeNull();
  expect(maybe("New agent")).toBeNull();
  await press("Back");
  expect(maybe("Search agents")).not.toBeNull();
  expect(maybe("New agent")).not.toBeNull();
});

test("workspaces are listed by project, and the search narrows them", async () => {
  await openForm();
  const text = container.textContent ?? "";
  expect(text.indexOf("Blog")).toBeGreaterThan(-1);
  expect(text.indexOf("Blog")).toBeLessThan(text.indexOf("Shop"));
  expect(maybe("main: /src/shop")).not.toBeNull();
  expect(maybe("main: /src/blog")).not.toBeNull();

  await type("Search workspaces", "CHECK");
  expect(maybe("checkout: /src/shop-checkout")).not.toBeNull();
  expect(maybe("main: /src/shop")).toBeNull();
  await type("Search workspaces", "nothing like it");
  expect(container.textContent).toContain("No workspace matches.");
});

test("every page of workspaces is read", async () => {
  host.pages = [
    { ...WORKSPACE_PAGE, pageInfo: { nextCursor: "c2", prevCursor: null, hasMore: true } },
    {
      entries: [workspace("w4", "docs", "Wiki", "/src/wiki")],
      pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
    },
  ];
  await openForm();
  expect(host.workspaceCalls.map((call) => (call.page as { cursor?: string }).cursor)).toEqual([
    undefined,
    "c2",
  ]);
  expect(maybe("docs: /src/wiki")).not.toBeNull();
});

test("only providers that are available are offered, the first with its default model", async () => {
  await openForm();
  expect(maybe("Claude")).not.toBeNull();
  expect(maybe("Codex")).not.toBeNull();
  expect(maybe("Gemini")).toBeNull();
  expect(selected("Claude")).toBe("true");
  expect(selected("Opus")).toBe("true");
  expect(selected("Sonnet")).toBe("false");
  await press("Codex");
  expect(selected("Codex")).toBe("true");
  expect(maybe("Opus")).toBeNull();
  expect(selected("GPT")).toBe("true");
});

test("the last choice kept on the device is where the form starts", async () => {
  host.device = {
    status: "ready",
    values: { threeD: true, rungIncidents: {}, lastAgent: { provider: "claude", model: "sonnet" } },
    revision: "r1",
  };
  await openForm();
  expect(selected("Claude")).toBe("true");
  expect(selected("Sonnet")).toBe("true");
  expect(selected("Opus")).toBe("false");
});

test("Create is disabled, with the reason shown, until the form is complete", async () => {
  await openForm();
  expect(
    labelled("Create").hasAttribute("disabled") || labelled("Create").getAttribute("aria-disabled"),
  ).toBeTruthy();
  expect(container.textContent).toContain("Choose a workspace.");
  await press("main: /src/shop");
  expect(container.textContent).toContain("Write the first prompt.");
  await type("First prompt", "Fix the cart");
  expect(container.textContent).not.toContain("Write the first prompt.");
  expect(labelled("Create").getAttribute("aria-disabled")).not.toBe("true");
  expect(labelled("Create").hasAttribute("disabled")).toBe(false);
});

test("Create starts the agent in the chosen workspace, closes the form, keeps the choice, opens the session", async () => {
  await openForm();
  await press("Codex");
  await fillForm();
  await press("Create");
  await settle();

  expect(host.created).toEqual([
    { workspaceId: "w1", config: { provider: "codex/gpt" }, prompt: "Fix the cart" },
  ]);
  expect(opened).toEqual(["agent-new"]);
  expect(host.saves).toEqual([
    {
      values: {
        threeD: true,
        rungIncidents: {},
        lastAgent: { provider: "codex", model: "gpt" },
      },
      revision: "r1",
    },
  ]);
  expect(maybe("First prompt")).toBeNull();
  expect(maybe("New agent")).not.toBeNull();
});

test("the wait for providers is short, and a slow provider falls back to the snapshot's ready ones", async () => {
  host.waitTimesOut = true;
  host.providers = {
    entries: [
      ...PROVIDERS.entries,
      { provider: "slow", status: "loading", enabled: true, label: "Slow", models: [] },
    ],
  };
  await openForm();
  expect(host.waits).toEqual([{ timeoutMs: 5000 }]);
  expect(host.snapshots).toBe(1);
  expect(container.textContent).not.toContain("Unable to read");
  expect(maybe("Codex")).not.toBeNull();
  expect(maybe("Slow")).toBeNull();
  await press("Codex");
  await fillForm();
  await press("Create");
  await settle();
  expect(opened).toEqual(["agent-new"]);
});

test("a choice the device refuses to keep is no failure: the agent exists, opens, and is created once", async () => {
  host.saved = false;
  await openForm();
  await press("Codex");
  await fillForm();
  await press("Create");
  await settle();

  expect(container.textContent).not.toContain("Unable to create");
  expect(opened).toEqual(["agent-new"]);
  expect(host.saves).toHaveLength(1);
  expect(maybe("Create")).toBeNull();
  expect(host.created).toHaveLength(1);
});

test("a failed create shows the reason and keeps everything typed", async () => {
  host.create = async () => {
    throw new Error("Workspace folder is missing");
  };
  await openForm();
  await press("Codex");
  await fillForm("Keep me");
  await press("Create");
  await settle();

  expect(container.textContent).toContain("Unable to create: Workspace folder is missing");
  expect(opened).toEqual([]);
  expect(host.saves).toEqual([]);
  expect((labelled("First prompt") as HTMLInputElement).value).toBe("Keep me");
  expect(selected("Codex")).toBe("true");
  expect(checked("main: /src/shop")).toBe("true");
  // It can be tried again.
  expect(labelled("Create").hasAttribute("disabled")).toBe(false);
});

test("while the agent is being created the button says so and takes no second press", async () => {
  const pending = deferred<{ id: string }>();
  host.create = () => pending.promise;
  await openForm();
  await fillForm();
  await press("Create");

  expect(maybe("Create")).toBeNull();
  const busy = labelled("Creating...");
  await act(async () => busy.click());
  await act(async () => busy.click());
  expect(host.created).toHaveLength(1);

  await act(async () => pending.resolve({ id: "agent-late" }));
  expect(opened).toEqual(["agent-late"]);
});

test("Back keeps what was typed for the next time the form opens", async () => {
  await openForm();
  await press("Codex");
  await fillForm("Half a thought");
  await press("Back");
  host.pages = [WORKSPACE_PAGE];
  await openForm();

  expect((labelled("First prompt") as HTMLInputElement).value).toBe("Half a thought");
  expect(selected("Codex")).toBe("true");
  expect(checked("main: /src/shop")).toBe("true");
});

test("after a create the prompt is cleared and the workspace and model stay chosen", async () => {
  await openForm();
  await fillForm("Done");
  await press("Create");
  await settle();
  host.pages = [WORKSPACE_PAGE];
  await openForm();
  expect((labelled("First prompt") as HTMLInputElement).value).toBe("");
  expect(checked("main: /src/shop")).toBe("true");
});

test("a failed read shows its reason and can be tried again", async () => {
  host.pages = [];
  host.providers = null;
  await openForm();
  expect(container.textContent).toContain("Unable to read workspaces and providers");
  host.pages = [WORKSPACE_PAGE];
  host.providers = PROVIDERS;
  await press("Try again");
  await settle();
  expect(maybe("main: /src/shop")).not.toBeNull();
});

test("without a ready provider the form says there is none to start on", async () => {
  host.providers = { entries: [PROVIDERS.entries[2]] };
  await openForm();
  expect(container.textContent).toContain("No provider is available.");
});

test("a provider with no models says so, is not selectable and never becomes the choice", async () => {
  host.providers = {
    entries: [
      ...PROVIDERS.entries.slice(0, 2),
      { provider: "aider", status: "ready", enabled: true, label: "Aider", models: [] },
    ],
  };
  await openForm();
  const pill = labelled("Aider (No models)");
  expect(pill.getAttribute("aria-disabled")).toBe("true");
  await press("Aider (No models)");
  expect(selected("Claude")).toBe("true");
  expect(selected("Aider (No models)")).toBe("false");
  expect(selected("Opus")).toBe("true");
});

test("a host with no workspaces says so, and a search with no match says that instead", async () => {
  host.pages = [{ entries: [], pageInfo: { nextCursor: null, prevCursor: null, hasMore: false } }];
  await openForm();
  expect(container.textContent).toContain("No workspaces on this host yet.");
  expect(container.textContent).not.toContain("No workspace matches.");
});

test("a search that matches nothing says no workspace matches", async () => {
  await openForm();
  await type("Search workspaces", "zzz");
  expect(container.textContent).toContain("No workspace matches.");
  expect(container.textContent).not.toContain("No workspaces on this host yet.");
});

test("a remembered workspace that is no longer listed is not shown as chosen", async () => {
  startChoice = { ...EMPTY_CHOICE, workspaceId: "gone", prompt: "Kept text" };
  act(() => root.render(null));
  act(() => root.render(createElement(Harness)));
  await openForm();
  expect(checked("main: /src/shop")).toBe("false");
  expect(container.textContent).toContain("Choose a workspace.");
  expect((labelled("First prompt") as HTMLInputElement).value).toBe("Kept text");
});
