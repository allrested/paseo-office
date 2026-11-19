/**
 * @vitest-environment jsdom
 */
// The Sessions panel, mounted as the office's column mounts it: the surface's state arrives as a
// prop, and a test re-renders with the next state to see the panel change.
import { act, createElement, useCallback, useMemo, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSubscriptionState } from "@getpaseo/plugin/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeAgent, OfficeSnapshot } from "../shared/contracts.js";
import { NO_MATCH, SEARCH_LABEL } from "./list-text.js";
import { EMPTY_CHOICE, type NewAgentChoice } from "./new-agent-model.js";
import type { NewAgentDraft, OfficeLink } from "./office-link.js";
import { EMPTY_OFFICE } from "./office-state.js";
import { SessionsPanel } from "./sessions-panel.js";
import { NO_AGENTS } from "./sessions-text.js";
import { useOfficeStyles } from "./styles.js";
import type { OfficeState } from "./use-office.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { TextInput, View } = await import("react-native");
  const ScrollView = (props: { children: ReactNode }) =>
    createElement("div", { "data-scroll": "vertical" }, createElement(View, null, props.children));
  return { ScrollView, TextInput, Icon: () => null };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

function agent(id: string, overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: id.toUpperCase(),
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: null,
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-17T08:00:00.000Z",
    ...overrides,
  };
}

const AGENTS = [
  agent("a", { status: "running", workspaceId: "w1", promptedAt: "2026-11-17T09:00:00.000Z" }),
  agent("b", { workspaceId: "w2", idleSince: "2026-11-17T09:30:00.000Z" }),
];

let selected: string[];
let opened: string[];
let container: HTMLElement;
let root: Root;

const LAYOUT = { compact: true, platform: "web" } as const;

function office(state: Partial<OfficeSnapshot>, extra: Partial<OfficeState> = {}): OfficeState {
  return {
    state: { ...EMPTY_OFFICE, ...state },
    loaded: true,
    subscription: { status: "live" },
    chat: null,
    ...extra,
  };
}

/** The draft as the surface holds it: state above the panel, so the panel keeps none. */
function useDraft(): NewAgentDraft {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<NewAgentChoice>(EMPTY_CHOICE);
  const change = useCallback(
    (patch: Partial<NewAgentChoice>) => setChoice((current) => ({ ...current, ...patch })),
    [],
  );
  return useMemo(() => ({ open, setOpen, choice, change }), [open, choice, change]);
}

/** Whether the surface this panel is drawn in can show an agent's workspace. */
let withWorkspace = false;
const workspaces: string[] = [];

function Harness({ value }: { value: OfficeState }) {
  const styles = useOfficeStyles(THEME, LAYOUT.compact, false);
  const newAgent = useDraft();
  const link: OfficeLink = {
    select: (agentId) => void selected.push(agentId),
    openSession: (agentId) => void opened.push(agentId),
    ...(withWorkspace && { openWorkspace: (agentId: string) => void workspaces.push(agentId) }),
  };
  return createElement(SessionsPanel, {
    office: value,
    styles,
    theme: THEME,
    layout: LAYOUT,
    link,
    newAgent,
  });
}

async function mount(value: OfficeState): Promise<void> {
  await act(async () => root.render(createElement(Harness, { value })));
}

async function show(agents: OfficeAgent[]): Promise<void> {
  await mount(
    office({
      agents,
      workspaces: [
        { id: "w1", name: "shop-api", projectName: "Shop" },
        { id: "w2", name: "blog", projectName: "Blog" },
      ],
      activity: { a: "Editing files" },
    }),
  );
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
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  selected = [];
  opened = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("a row shows the room's name and the doing-now line; a press selects", async () => {
  await show(AGENTS);

  const rowA = labelled("A: Running");
  expect(rowA.textContent).toContain("shop-api");
  expect(rowA.textContent).toContain("Editing files");
  // The Resting heading already conveys the state.
  const rowB = labelled("B: Idle");
  expect(rowB.textContent).toContain("blog");
  expect(rowB.textContent).not.toContain("Idle");
  // Working comes before Resting.
  expect(rowA.compareDocumentPosition(rowB) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // No Open session on a Sessions row: the press and the card it opens are the way in.
  expect(maybe("Open session")).toBeNull();

  await press("A: Running");
  await press("B: Idle");
  expect(selected).toEqual(["a", "b"]);
  expect(opened).toEqual([]);
});

test("a row's own button opens the agent's workspace without opening its details", async () => {
  withWorkspace = true;
  workspaces.length = 0;
  selected.length = 0;
  try {
    await show(AGENTS);
    await press("Open A's workspace");
    expect(workspaces).toEqual(["a"]);
    expect(selected).toEqual([]);
    expect(opened).toEqual([]);
    // The row itself still opens the details.
    await press("A: Running");
    expect(selected).toEqual(["a"]);
    expect(workspaces).toEqual(["a"]);
  } finally {
    withWorkspace = false;
  }
});

test("a surface that cannot show a workspace draws no such button", async () => {
  await show(AGENTS);
  expect(maybe("Open A's workspace")).toBeNull();
});

test("No agents yet. and No agent matches.", async () => {
  // Before the first state the office is not known to be empty.
  await mount(office({}, { loaded: false }));
  expect(container.textContent).toContain("Loading...");
  expect(container.textContent).not.toContain(NO_AGENTS);
  await show([]);
  expect(container.textContent).not.toContain("Loading...");
  expect(container.textContent).toContain(NO_AGENTS);
  expect(container.textContent).not.toContain(NO_MATCH);

  await show(AGENTS);
  expect(container.textContent).not.toContain(NO_AGENTS);
  // Nobody needs you: the tab is empty, and says so.
  await press("Needs you, 0");
  expect(labelled("Needs you, 0").getAttribute("aria-selected")).toBe("true");
  expect(container.textContent).toContain(NO_MATCH);
  expect(maybe("A: Running")).toBeNull();

  await press("Clear filters");
  await type(SEARCH_LABEL, "blog");
  expect(maybe("A: Running")).toBeNull();
  expect(maybe("B: Idle")).not.toBeNull();
  // The counts ignore the search, as the List view's do.
  expect(maybe("Working, 1")).not.toBeNull();

  await type(SEARCH_LABEL, "nothing like it");
  expect(container.textContent).toContain(NO_MATCH);
  expect(labelled(SEARCH_LABEL).getAttribute("placeholder")).toBe("Search sessions");
  await press("Clear filters");
  expect(maybe("A: Running")).not.toBeNull();
  expect(labelled("All, 2").getAttribute("aria-selected")).toBe("true");
});

test("a state that cannot load says so as the office does", async () => {
  const problem = (subscription: PluginSubscriptionState) =>
    mount(office({}, { loaded: false, subscription }));
  await problem({ status: "error", error: new Error("Host offline.") });
  expect(container.textContent).toContain("Unable to load the office: host offline");

  await problem({ status: "closed" });
  expect(container.textContent).toContain(
    "Unable to show live agents: the host closed the office. Reopen it.",
  );
});

test("approvals lead the list and update when the live request clears", async () => {
  const reviewer = agent("review", {
    permissions: [{ id: "p", kind: "tool", title: "Run tests" }],
  });
  await show([...AGENTS, reviewer]);
  const headings = () =>
    Array.from(
      container.querySelectorAll('[role="heading"],h1,h2,h3,h4,h5,h6'),
      (node) => node.textContent,
    );
  expect(headings()).toEqual(["Needs your approval", "Working", "Resting"]);
  expect(container.textContent).toContain("Needs permission: Run tests");
  expect(maybe("Needs you, 1")).not.toBeNull();
  await show([...AGENTS, { ...reviewer, permissions: [] }]);
  expect(headings()).toEqual(["Working", "Resting"]);
  expect(container.textContent).not.toContain("Run tests");
});

test("session rows show reported task counts and context separately, and resting rows can collapse", async () => {
  await mount(
    office({
      agents: [AGENTS[0], { ...AGENTS[1], context: { usedTokens: 45, maxTokens: 100 } }],
      checklistProgress: { a: { completed: 1, total: 4 } },
    }),
  );
  const progress = labelled("A: Running").querySelector('[role="progressbar"]');
  expect(progress?.getAttribute("aria-label")).toBe("1/4 tasks");
  expect(progress?.getAttribute("aria-valuenow")).toBe("25");
  expect(labelled("B: Idle").textContent).toContain("Context 45%");
  expect(labelled("A: Running").textContent).toMatch(/\d+:\d{2}/);
  await press("Resting sessions");
  expect(labelled("Resting sessions").getAttribute("aria-expanded")).toBe("false");
  expect(maybe("B: Idle")).toBeNull();
  await press("Resting sessions");
  expect(maybe("B: Idle")).not.toBeNull();
});
