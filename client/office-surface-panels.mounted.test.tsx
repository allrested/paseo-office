/**
 * @vitest-environment jsdom
 */
// The office's page, mounted as the app mounts the screen: nothing of the settings is on it, and
// the view switch and the settings button sit over the floor's corner. Everything the page and its
// cards take from the host is stood in here; the office's subscription speaks only when a test
// delivers an event, so the body stays on "Loading..." until then.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AccessibilityInfo } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type {
  PluginClientContext,
  PluginScreenProps,
  PluginSidebarItemProps,
  SettingsState,
} from "@getpaseo/plugin/client";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { ChatMessage, OfficeAgent, OfficeEvent } from "../shared/contracts.js";
import { buildOfficeModel } from "../shared/model.js";
import { officeHostSettings, officeDeviceSettings } from "../shared/settings.js";
import { feedStore } from "./activity-feed.js";
import { markChatSeen, resetChatSeen } from "./chat-seen.js";
import { EMPTY_OFFICE } from "./office-state.js";

/** The view the device holds; every other device value is the office's default. */
let view: "3d" | "2d" | "list";
/** The office's subscription: "live" unless a test says it failed or closed. */
let subscriptionStatus: "live" | "error" | "closed";
/** The office's events, once its subscription is drawn. */
let deliver: ((event: OfficeEvent) => void) | null;

/**
 * The 3D floor, stood in: whether the browser has WebGL2 (none unless a test says so), whether the
 * device refuses a save, and the props the floor was last drawn with.
 */
const floor = vi.hoisted(() => ({
  webgl: false,
  refuse: false,
  props: null as null | { sound?: { set(next: boolean): void } },
}));
vi.mock("./world/world-view.js", () => ({
  WorldView: (props: { sound?: { set(next: boolean): void } }) => {
    floor.props = props;
    return null;
  },
}));

/** What a send does: a test says, per agent, whether it fails or waits. */
const sends = vi.hoisted(() => ({
  run: async (_agentId: string, _text: string): Promise<void> => undefined,
}));

// One object for every render, as the host's SDK object is. An agent's timeline holds one line.
const sdk = vi.hoisted(() => ({
  workspaces: {
    list: async () => ({
      entries: [
        {
          id: "w1",
          name: "main",
          projectId: "shop",
          projectDisplayName: "Shop",
          projectRootPath: "/src/shop",
          workspaceDirectory: "/src/shop",
          archivingAt: null,
        },
      ],
      pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
    }),
  },
  providers: {
    waitForReady: async () => ({
      entries: [
        {
          provider: "claude",
          status: "ready",
          enabled: true,
          label: "Claude",
          models: [{ provider: "claude", id: "opus", label: "Opus", isDefault: true }],
        },
      ],
    }),
  },
  agents: {
    ref: (agentId: string) => ({
      send: (text: string) => sends.run(agentId, text),
      respondToPermission: async () => undefined,
      cancel: async () => undefined,
      timeline: {
        subscribe: () => Object.assign(() => undefined, { ready: Promise.resolve() }),
        refetch: async () => ({
          entries: [
            {
              seqStart: 1,
              seqEnd: 1,
              item: { type: "assistant_message", text: "Reading the ledger" },
            },
          ],
          startCursor: { epoch: "e1", seq: 1 },
          hasOlder: false,
          staleCursor: false,
          error: null,
        }),
      },
    }),
  },
}));

const DEVICE: SettingsState<typeof officeDeviceSettings.schema> = {
  status: "ready",
  values: { threeD: true, rungIncidents: {}, sound: false },
  revision: "r1",
  saving: false,
  saveError: null,
  save: async () => !floor.refuse,
  reset: async () => true,
  reload: async () => undefined,
};

vi.mock("@getpaseo/plugin/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@getpaseo/plugin/client")>()),
  // The device's view is the test's; the host's settings are the schema's defaults.
  useSettings: (settings: { id: string }) => {
    if (settings.id === "office-device") {
      return { ...DEVICE, values: { ...DEVICE.values, view } };
    }
    if (settings.id === "office-column") {
      return { ...DEVICE, values: { width: 360, collapsed: columnCollapsed } };
    }
    return { ...DEVICE, values: officeHostSettings.schema.parse({}) };
  },
  // Live, and silent until a test delivers: the body shows what it shows before a snapshot. The
  // machine's subscription never speaks.
  useSubscription: (
    contract: { name: string },
    _input: unknown,
    onEvent: (event: OfficeEvent) => void,
  ) => {
    if (contract.name === "office.state") deliver = onEvent;
    if (contract.name !== "office.state") return { status: "live" };
    return { status: subscriptionStatus, error: { message: "The office is out of reach" } };
  },
  useRpc: () => async () => {
    throw new Error("The header asks for nothing");
  },
  usePaseo: () => sdk,
}));

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { ScrollView, TextInput, View } = await import("react-native");
  const Modal = (props: { title: string; open: boolean; children: ReactNode }) =>
    props.open ? createElement("section", { "aria-label": props.title }, props.children) : null;
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  const Markdown = (props: { children: string }) =>
    createElement("div", { "data-markdown": "" }, props.children);
  const ExternalLink = (props: { href: string; children: ReactNode }) =>
    createElement("a", { href: props.href }, props.children);
  const Icon = (props: { name: string }) => createElement(View, { testID: `icon-${props.name}` });
  return {
    ExternalLink,
    SidebarRow: ({ onPress }: { onPress(): void }) =>
      createElement("button", {
        type: "button",
        onClick: onPress,
        "aria-label": "Sidebar Office 3D",
      }),
    Icon,
    Markdown,
    Modal,
    ScrollView,
    TextInput,
    copyText: async () => undefined,
    useToast: () => ({ show: () => undefined, error: () => undefined }),
  };
});

// The real model, counted: a chat change must not build it again.
vi.mock("../shared/model.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../shared/model.js")>();
  return { ...real, buildOfficeModel: vi.fn(real.buildOfficeModel) };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
// jsdom lays nothing out: react-native-web reads a view's layout through a ResizeObserver, and this
// one reports what a test says, when it says it.
let resized: (entries: Array<{ target: Element }>) => void = () => {
  throw new Error("No view has asked for its layout");
};
vi.stubGlobal(
  "ResizeObserver",
  class {
    constructor(callback: (entries: Array<{ target: Element }>) => void) {
      resized = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
// A test browser draws no 3D: the surface asks for WebGL2 as it loads, and the answer is no.
vi.mock("./web-env.web.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./web-env.web.js")>()),
  hasWebGL2: () => floor.webgl,
}));

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

/** False on a host with no way to the settings: the surface gets no `onOpenSettings`. */
let settingsWay: boolean;
/** How many times the surface asked for the office's settings screen. */
let settingsOpened: number;
/** False on an app with no navigation: the surface gets none. */
let withNavigation: boolean;
/** The agents the app was asked to open in their workspace. */
let opened: string[];
/** What the device holds of the column. */
let columnCollapsed: boolean;
/** True for the phone's layout, as the app mounts it narrow; false for the wide one. */
let compact: boolean;
let container: HTMLElement;
let root: Root;

let OfficeSurface: typeof import("./office-surface.js").OfficeSurface;

// Import after the browser shims are installed, before timing the first interaction.
beforeAll(async () => {
  ({ OfficeSurface } = await import("./office-surface.js"));
});

async function mount(params: Record<string, string> = {}): Promise<void> {
  const props = {
    theme: THEME,
    layout: { compact, platform: "web" },
    host: { id: "host", label: "Host" },
    params,
    ...(settingsWay ? { onOpenSettings: () => void (settingsOpened += 1) } : {}),
    ...(withNavigation
      ? {
          navigation: {
            openAgent: ({ agentId }: { agentId: string }) => void opened.push(agentId),
            openWorkspace: () => undefined,
          },
        }
      : {}),
  } as unknown as PluginScreenProps;
  await act(async () => root.render(createElement(OfficeSurface, props)));
}

function labelled(label: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}

async function press(label: string): Promise<void> {
  const button = labelled(label);
  if (!button) throw new Error(`Nothing is labelled "${label}"`);
  await act(async () => button.click());
}

/** The surface's outer view reports `width`, as a resized pane would. */
async function sizeSurface(width: number): Promise<void> {
  const target = container.firstElementChild;
  if (!(target instanceof HTMLElement)) throw new Error("The surface is not drawn");
  Object.defineProperty(target, "offsetWidth", { configurable: true, value: width });
  resized([{ target }]);
  // react-native-web measures on the next tick.
  await act(async () => void (await new Promise((done) => setTimeout(done, 0))));
}

/** What each button says to a screen reader, in the order they are drawn. */
function buttonLabels(): (string | null)[] {
  return [...container.querySelectorAll('[role="button"]')].map((button) =>
    button.getAttribute("aria-label"),
  );
}

function chatMessage(at: number, from: string | undefined, kind = "text"): ChatMessage {
  return { id: `m${at}`, at, kind, from, name: from, text: "Hi", reacts: {} };
}

beforeEach(() => {
  floor.webgl = false;
  floor.refuse = false;
  floor.props = null;
  view = "list";
  subscriptionStatus = "live";
  deliver = null;
  settingsWay = true;
  settingsOpened = 0;
  withNavigation = true;
  opened = [];
  columnCollapsed = false;
  feedStore.reset();
  compact = true;
  // The test browser's AccessibilityInfo gives no subscription to remove; the 2D floor asks.
  vi.spyOn(AccessibilityInfo, "addEventListener").mockReturnValue({
    remove: () => undefined,
  } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("the page has no settings: no switch and no field", async () => {
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));

  expect(container.querySelector('[role="switch"]')).toBeNull();
  // The list view's agent search is the page's own field, not a setting.
  expect(container.querySelector("input:not(#office-list-search)")).toBeNull();
});

const BROKEN_NOTES = {
  folderSet: true,
  writing: false,
  writtenAt: null,
  failedAgentId: null,
  problem: null,
  scheduleError: "unknown zone Mars/Olympus",
};

function settingsCard(): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>('[role="button"]')].find(
    (button) =>
      button.getAttribute("aria-label") !== "Office settings" &&
      button.textContent?.includes("Settings"),
  );
}

/** The wide office's Attention tab, where the strip's cards are. */
async function openAttention(): Promise<void> {
  await act(async () =>
    container.querySelector<HTMLElement>('[role="tab"][aria-label^="Attention"]')?.click(),
  );
}

test("a schedule the settings broke shows a Settings card that opens the settings", async () => {
  compact = false;
  await mount();
  await act(async () =>
    deliver?.({ type: "snapshot", state: { ...EMPTY_OFFICE, notes: BROKEN_NOTES } }),
  );
  await openAttention();

  const card = settingsCard();
  if (!card) throw new Error("The strip has no Settings card");
  await act(async () => card.click());

  expect(settingsOpened).toBe(1);
});

test("with no way to the settings, a broken schedule draws no Settings card", async () => {
  settingsWay = false;
  compact = false;
  await mount();
  await act(async () =>
    deliver?.({ type: "snapshot", state: { ...EMPTY_OFFICE, notes: BROKEN_NOTES } }),
  );
  await openAttention();

  expect(settingsCard()).toBeUndefined();
});

test("the corner has an Office settings button that opens the settings", async () => {
  await mount();

  await press("Office settings");

  expect(settingsOpened).toBe(1);
});

test("a Sound save the device refuses after a press on the floor's button is shown in the view corner", async () => {
  floor.webgl = true;
  floor.refuse = true;
  view = "3d";
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));
  expect(container.textContent).not.toContain("Unable to save the Sound setting");

  // The scene's onSound is the floor's sound.set: the press asks for Sound on.
  await act(async () => floor.props?.sound?.set(true));

  const corner = container.querySelector('[data-testid="office-view-corner"]');
  expect(corner?.textContent).toContain(
    "Unable to save the Sound setting on this device. It holds until this screen is closed.",
  );
});

test("with no way to the settings, the corner has no Office settings button", async () => {
  settingsWay = false;
  await mount();

  expect(labelled("Office settings")).toBeNull();
});

test("the header has the view switch and the settings button, and no panel buttons", async () => {
  await mount();

  // A test browser has no WebGL, so the view switch offers 2D and the List.
  expect(buttonLabels()).toEqual(["2D view", "List view", "Office settings"]);
});

test("a chat change does not rebuild the floor's model", async () => {
  resetChatSeen(1000);
  await mount();
  await act(async () =>
    deliver?.({
      type: "snapshot",
      state: { ...EMPTY_OFFICE, chat: { messages: [], typing: [] } },
    }),
  );
  const built = vi.mocked(buildOfficeModel).mock.calls.length;
  expect(built).toBeGreaterThan(0);

  await act(async () => deliver?.({ type: "chat", change: { op: "typing", names: ["Ali"] } }));
  await act(async () =>
    deliver?.({ type: "chat", change: { op: "add", message: chatMessage(6000, "a1") } }),
  );
  expect(vi.mocked(buildOfficeModel).mock.calls.length).toBe(built);
});

test("a wide office has the column, on Sessions, and no strip above the floor", async () => {
  compact = false;
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));

  // The Sessions panel's own filter pills are tabs too: only the column's are asked for.
  const tabs = [...container.querySelectorAll('[aria-label="Office column"] [role="tab"]')].map(
    (each) => each.getAttribute("aria-label"),
  );
  expect(tabs).toEqual(["Attention", "Sessions", "Activity", "Chat"]);
  expect(labelled("Sessions")?.getAttribute("aria-selected")).toBe("true");
});

test("Attention counts the strip's cards and shows them", async () => {
  compact = false;
  await mount();
  const notes = {
    folderSet: true,
    writing: false,
    writtenAt: null,
    failedAgentId: null,
    problem: null,
    scheduleError: "unknown zone Mars/Olympus",
  };
  await act(async () => deliver?.({ type: "snapshot", state: { ...EMPTY_OFFICE, notes } }));

  const attention = container.querySelector<HTMLElement>('[role="tab"][aria-label^="Attention"]');
  expect(attention?.getAttribute("aria-label")).toBe("Attention, 1 new");
  await act(async () => attention?.click());
  expect(container.textContent).toContain("Settings");
});

test("Attention with nothing waiting says so", async () => {
  compact = false;
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));
  await openAttention();

  expect(container.textContent).toContain("Nothing needs you.");
});

test("Chat's tab shows the messages since the chat was last open, and none at zero", async () => {
  compact = false;
  resetChatSeen(1000);
  await mount();
  const chat = () => container.querySelector<HTMLElement>('[role="tab"][aria-label^="Chat"]');
  expect(chat()?.getAttribute("aria-label")).toBe("Chat");

  // Seen, then two agents' messages after the mark; yours and a system line do not count.
  const messages = [
    chatMessage(500, "a1"),
    chatMessage(2000, "a1"),
    chatMessage(3000, "me"),
    chatMessage(4000, undefined, "sys"),
    chatMessage(5000, "a2"),
  ];
  await act(async () =>
    deliver?.({ type: "snapshot", state: { ...EMPTY_OFFICE, chat: { messages, typing: [] } } }),
  );
  expect(chat()?.getAttribute("aria-label")).toBe("Chat, 2 new");

  // The chat was open up to the newest: the count goes.
  await act(async () => markChatSeen(5000));
  expect(chat()?.getAttribute("aria-label")).toBe("Chat");
});

test("the controls take a row while the body shows Loading, and the corner once a floor is drawn", async () => {
  view = "2d";
  await mount();
  expect(container.textContent).toContain("Loading");
  expect(container.querySelector('[data-testid="office-view-row"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="office-view-corner"]')).toBeNull();

  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));

  expect(container.querySelector('[data-testid="office-view-corner"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="office-view-row"]')).toBeNull();
});

test("the controls take a row while the subscription is in error or closed", async () => {
  view = "2d";
  for (const status of ["error", "closed"] as const) {
    subscriptionStatus = status;
    await mount();
    await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));

    expect(container.querySelector('[data-testid="office-view-row"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="office-view-corner"]')).toBeNull();
  }
});

const ADA: OfficeAgent = {
  id: "ada",
  title: "Ada",
  provider: "claude",
  model: null,
  status: "idle",
  workspaceId: "w1",
  parentAgentId: null,
  permissions: [],
  createdAt: "2026-11-17T08:00:00.000Z",
};

const OFFICE_WITH_ONE_AGENT = {
  ...EMPTY_OFFICE,
  agents: [ADA],
  workspaces: [{ id: "w1", name: "shop-api", projectName: "Shop" }],
};

test("a phone has the bar under the floor, and no column beside it", async () => {
  compact = true;
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));

  expect(
    container.querySelectorAll('[role="tablist"][aria-label="Office column"] [role="tab"]'),
  ).toHaveLength(4);
  expect(container.querySelector('[aria-label="Collapse the column"]')).toBeNull();
  expect(container.querySelector('[aria-label="Close"]')).toBeNull();
});

test("a phone's Sessions opens as a sheet, and a row press closes it for the agent's card", async () => {
  compact = true;
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: OFFICE_WITH_ONE_AGENT }));
  await act(async () =>
    container
      .querySelector<HTMLElement>(
        '[role="tablist"][aria-label="Office column"] [role="tab"][aria-label="Sessions"]',
      )
      ?.click(),
  );
  expect(container.querySelector('[aria-label="Close"]')).not.toBeNull();

  // The list view of the floor has rows for the agent too: look only inside the sheet.
  const sheet = container.querySelector('[data-testid="office-column-sheet"]');
  const row = [...(sheet?.querySelectorAll<HTMLElement>('[role="button"]') ?? [])].find((button) =>
    button.getAttribute("aria-label")?.startsWith("Ada"),
  );
  if (!row) throw new Error("The sheet has no row for the agent");
  await act(async () => row.click());
  expect(container.querySelector('[aria-label="Close"]')).toBeNull();
  expect(container.querySelector('section[aria-label="Ada"]')).not.toBeNull();
});

/** The phone's bar: the column's tabs with no Collapse button and none of them chosen. */
function hasBar(): boolean {
  const tabs = container.querySelectorAll('[role="tablist"][aria-label="Office column"]');
  return (
    tabs.length === 1 &&
    labelled("Collapse the column") === null &&
    labelled("Sessions")?.getAttribute("aria-selected") === "false"
  );
}

test("a surface narrower than the column and the floor is compact on a wide device", async () => {
  compact = false;
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));

  await sizeSurface(450);
  expect(hasBar()).toBe(true);

  await sizeSurface(1280);
  expect(hasBar()).toBe(false);
  expect(labelled("Collapse the column")).not.toBeNull();
});

test("the floor is not drawn again when the layout flips", async () => {
  compact = false;
  view = "list";
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: OFFICE_WITH_ONE_AGENT }));
  await sizeSurface(1280);
  const search = container.querySelector("#office-list-search");
  if (!search) throw new Error("The list has no search");

  await sizeSurface(450);
  expect(hasBar()).toBe(true);
  expect(container.querySelector("#office-list-search")).toBe(search);

  await sizeSurface(1280);
  expect(hasBar()).toBe(false);
  expect(container.querySelector("#office-list-search")).toBe(search);
});

/** The wide column's tab of that name. */
async function pressTab(label: string): Promise<void> {
  await act(async () =>
    container
      .querySelector<HTMLElement>(
        `[aria-label="Office column"] [role="tab"][aria-label^="${label}"]`,
      )
      ?.click(),
  );
}

test("a half-typed chat message is still there after a look at another tab", async () => {
  compact = false;
  await mount();
  await act(async () =>
    deliver?.({
      type: "snapshot",
      state: { ...EMPTY_OFFICE, chat: { messages: [], typing: [] } },
    }),
  );
  await pressTab("Chat");
  const box = () => labelled("Message") as HTMLTextAreaElement | null;
  const field = box();
  if (!field) throw new Error("The Chat tab has no Message box");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      field,
      "hello",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await pressTab("Sessions");
  expect(box()).toBeNull();
  await pressTab("Chat");

  expect(box()?.value).toBe("hello");
});

async function typeFirstPrompt(text: string): Promise<void> {
  const field = labelled("First prompt") as HTMLTextAreaElement | null;
  if (!field) throw new Error("The form has no First prompt box");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const firstPrompt = () => (labelled("First prompt") as HTMLTextAreaElement | null)?.value;

test("a half-typed new agent is still there after a look at another tab", async () => {
  compact = false;
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));
  await press("New agent");
  await act(async () => undefined);
  await typeFirstPrompt("Fix the cart");
  await press("main: /src/shop");

  await pressTab("Activity");
  expect(firstPrompt()).toBeUndefined();
  await pressTab("Sessions");

  // The form is open as it was left, with the text and the workspace.
  expect(firstPrompt()).toBe("Fix the cart");
  expect(labelled("main: /src/shop")?.getAttribute("aria-checked")).toBe("true");
});

test("a half-typed new agent is still there after the phone's sheet is dismissed", async () => {
  compact = true;
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));
  await pressBarSessions();
  await press("New agent");
  await act(async () => undefined);
  await typeFirstPrompt("Fix the cart");

  await press("Close the column");
  expect(sheet()).toBeNull();
  await pressBarSessions();

  expect(firstPrompt()).toBe("Fix the cart");
});

test("Attention says why while the subscription is in error or closed", async () => {
  compact = false;
  for (const [status, text] of [
    ["error", "Unable to load the office: the office is out of reach"],
    ["closed", "Unable to show live agents: the host closed the office. Reopen it."],
  ] as const) {
    subscriptionStatus = status;
    await mount();
    await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));
    await openAttention();

    expect(container.textContent).not.toContain("Nothing needs you.");
    // The floor says it too: the Attention tab's banner is the second.
    const alerts = [...container.querySelectorAll('[role="alert"]')].filter(
      (alert) => alert.textContent === text,
    );
    expect(alerts).toHaveLength(2);
  }
});

// "Open session" stays in the office: the session is a tab of the column, or the sheet's view.

async function seeAda(extra: Partial<OfficeAgent> = {}): Promise<void> {
  await act(async () =>
    deliver?.({
      type: "snapshot",
      state: { ...OFFICE_WITH_ONE_AGENT, agents: [{ ...ADA, ...extra }] },
    }),
  );
}

/** The first control of that name; the list view of the floor draws the agent's rows too. */
async function pressFirst(label: string): Promise<void> {
  const button = container.querySelector<HTMLElement>(`[aria-label^="${label}"]`);
  if (!button) throw new Error(`Nothing is labelled "${label}"`);
  await act(async () => button.click());
}

/** The agent's card: a press on a row opens it. */
const adaCard = () => container.querySelector('section[aria-label="Ada"]');
const sessionTab = () => container.querySelector<HTMLElement>('[role="tab"][aria-label="Ada"]');
const sheet = () => container.querySelector('[data-testid="office-column-sheet"]');

test("the card's Open session opens a tab in the wide column, chosen, and does not leave", async () => {
  compact = false;
  await mount();
  await seeAda();
  await pressFirst("Ada");
  expect(adaCard()).not.toBeNull();

  await press("Open session");

  expect(sessionTab()?.getAttribute("aria-selected")).toBe("true");
  expect(container.textContent).toContain("Reading the ledger");
  expect(opened).toEqual([]);
  expect(adaCard()).toBeNull();
});

test("a collapsed column opens when a session opens", async () => {
  compact = false;
  columnCollapsed = true;
  await mount();
  await seeAda();
  expect(labelled("Collapse the column")).toBeNull();
  await pressFirst("Ada");
  await press("Open session");

  expect(labelled("Collapse the column")).not.toBeNull();
  expect(sessionTab()?.getAttribute("aria-selected")).toBe("true");
});

test("the office workspace is available even on hosts without navigation", async () => {
  compact = false;
  withNavigation = false;
  await mount();
  await seeAda();
  await pressFirst("Ada");
  await press("Open session");

  expect(sessionTab()).not.toBeNull();
  expect(container.textContent).toContain("Reading the ledger");
  expect(labelled("Open in workspace")).not.toBeNull();
});

test("opening the workspace keeps the Office route and chat in place", async () => {
  compact = false;
  await mount();
  await seeAda();
  await pressFirst("Ada");
  await press("Open session");
  await press("Open in workspace");

  expect(opened).toEqual([]);
  expect(sessionTab()).not.toBeNull();
  expect(
    container.querySelector('[role="dialog"], dialog, iframe[title*="workspace" i]'),
  ).not.toBeNull();
});

test("the List's Open session for a plan opens the tab", async () => {
  compact = false;
  view = "list";
  await mount();
  await seeAda({ permissions: [{ id: "p1", kind: "plan", title: "Ship it?" }] });
  await pressFirst("Open session");

  expect(sessionTab()?.getAttribute("aria-selected")).toBe("true");
  expect(opened).toEqual([]);
});

test("an Activity card's Open session opens the tab", async () => {
  compact = false;
  await mount();
  await seeAda();
  await seeAda({ status: "running", permissions: [{ id: "p2", kind: "tool", title: "Run ls" }] });
  await pressTab("Activity");
  await pressFirst("Open session");

  expect(sessionTab()?.getAttribute("aria-selected")).toBe("true");
});

test("an agent that leaves keeps its tab, which says so; Close removes it", async () => {
  compact = false;
  await mount();
  await seeAda();
  await pressFirst("Ada");
  await press("Open session");
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));

  expect(container.querySelector('[role="tab"][aria-label^="Agent "]')).not.toBeNull();
  expect(container.textContent).toContain("The office does not list this agent");

  const close = container.querySelector<HTMLElement>('[aria-label^="Close Agent "]');
  if (!close) throw new Error("The tab has no Close");
  await act(async () => close.click());
  expect(container.querySelector('[role="tab"][aria-label^="Agent "]')).toBeNull();
});

test("a phone's Open session shows the session in the sheet", async () => {
  compact = true;
  await mount();
  await seeAda();
  await pressFirst("Ada");
  await press("Open session");

  expect(sheet()?.textContent).toContain("Reading the ledger");
  expect(labelled("Back to Sessions")).not.toBeNull();
  expect(opened).toEqual([]);
});

test("opening the same session twice leaves one tab in the wide column", async () => {
  compact = false;
  await mount();
  await seeAda();
  await pressFirst("Ada");
  await press("Open session");
  await pressTab("Sessions");
  await pressFirst("Ada");
  await press("Open session");

  expect(container.querySelectorAll('[role="tab"][aria-label="Ada"]')).toHaveLength(1);
  expect(sessionTab()?.getAttribute("aria-selected")).toBe("true");
});

test("a stopped notes writer opens in the column, and the app is not asked", async () => {
  compact = false;
  await mount();
  const notes = {
    ...BROKEN_NOTES,
    scheduleError: null,
    failedAgentId: "ada",
    problem: "Rate limited",
  };
  await act(async () =>
    deliver?.({ type: "snapshot", state: { ...OFFICE_WITH_ONE_AGENT, notes } }),
  );
  await openAttention();
  await pressFirst("Stand-up");
  await press("Open the writer");

  expect(sessionTab()?.getAttribute("aria-selected")).toBe("true");
  expect(opened).toEqual([]);
});

/** The phone's bar: Sessions, with its count of open sessions when it has one. */
async function pressBarSessions(): Promise<void> {
  await act(async () =>
    container
      .querySelector<HTMLElement>(
        '[role="tablist"][aria-label="Office column"] [role="tab"][aria-label^="Sessions"]',
      )
      ?.click(),
  );
}

test("a dismissed sheet keeps the session: reopened from Sessions it is the same one", async () => {
  compact = true;
  await mount();
  await seeAda();
  await pressFirst("Ada");
  await press("Open session");
  expect(sheet()?.textContent).toContain("Reading the ledger");

  // The scrim closes the sheet and leaves the session open.
  await press("Close the column");
  expect(sheet()).toBeNull();
  expect(labelled("Sessions, 1 open")).not.toBeNull();

  await pressBarSessions();
  expect(sheet()).not.toBeNull();
  const row = [...(sheet()?.querySelectorAll<HTMLElement>('[role="button"]') ?? [])].find(
    (button) => button.getAttribute("aria-label")?.startsWith("Ada"),
  );
  if (!row) throw new Error("The sheet has no row for the agent");
  await act(async () => row.click());
  await press("Open session");

  expect(sheet()?.textContent).toContain("Reading the ledger");
  expect(labelled("Sessions, 1 open")).not.toBeNull();
  expect(container.textContent).not.toContain("Sessions, 2 open");
});

test("Back in the sheet shows Sessions and keeps the session open", async () => {
  compact = true;
  await mount();
  await seeAda();
  await pressFirst("Ada");
  await press("Open session");
  await press("Back to Sessions");

  expect(sheet()?.textContent).not.toContain("Reading the ledger");
  expect(labelled("Sessions, 1 open")).not.toBeNull();
});

test("Close in the sheet's header removes the session", async () => {
  compact = true;
  await mount();
  await seeAda();
  await pressFirst("Ada");
  await press("Open session");
  await press("Close Ada");

  expect(labelled("Sessions, 1 open")).toBeNull();
  expect(sheet()?.textContent).not.toContain("Reading the ledger");
});

// A half-typed reply is the surface's, by agent: a tab switch or a dismissed sheet keeps it, and a
// closed session or a sent reply clears it.

async function typeReply(text: string): Promise<void> {
  const field = labelled("Message") as HTMLTextAreaElement | null;
  if (!field) throw new Error("The session has no Message box");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const reply = () => (labelled("Message") as HTMLTextAreaElement | null)?.value;

test("a half-typed reply survives a look at another tab in the wide column, and Close clears it", async () => {
  compact = false;
  await mount();
  await seeAda();
  await pressFirst("Ada");
  await press("Open session");
  await typeReply("half a thought");

  await pressTab("Sessions");
  expect(labelled("Message")).toBeNull();
  await pressTab("Ada");
  expect(reply()).toBe("half a thought");

  await press("Close");
  await pressFirst("Ada");
  await press("Open session");
  expect(reply()).toBe("");
});

test("a sent reply is not typed again after a look at another tab", async () => {
  compact = false;
  await mount();
  await seeAda();
  await pressFirst("Ada");
  await press("Open session");
  await typeReply("Add tests");
  await press("Send");

  await pressTab("Sessions");
  await pressTab("Ada");
  expect(reply()).toBe("");
});

test("a half-typed reply survives a dismissed sheet on a phone, and Close clears it", async () => {
  compact = true;
  await mount();
  await seeAda();
  await pressFirst("Ada");
  await press("Open session");
  await typeReply("half a thought");

  await press("Close the column");
  expect(sheet()).toBeNull();
  await pressBarSessions();
  const row = [...(sheet()?.querySelectorAll<HTMLElement>('[role="button"]') ?? [])].find(
    (button) => button.getAttribute("aria-label")?.startsWith("Ada"),
  );
  if (!row) throw new Error("The sheet has no row for the agent");
  await act(async () => row.click());
  await press("Open session");
  expect(reply()).toBe("half a thought");

  await press("Close Ada");
  // Closing the session leaves the sheet on Sessions.
  expect(sheet()).not.toBeNull();
  const again = [...(sheet()?.querySelectorAll<HTMLElement>('[role="button"]') ?? [])].find(
    (button) => button.getAttribute("aria-label")?.startsWith("Ada"),
  );
  if (!again) throw new Error("The sheet has no row for the agent");
  await act(async () => again.click());
  await press("Open session");
  expect(reply()).toBe("");
});

const BO: OfficeAgent = { ...ADA, id: "bo", title: "Bo" };

/** The agent's card from the floor's list, and its Open session. */
async function openSessionOf(title: string): Promise<void> {
  const row = [...container.querySelectorAll<HTMLElement>('[role="button"]')].find((button) =>
    button.getAttribute("aria-label")?.startsWith(`${title}:`),
  );
  if (!row) throw new Error(`No row for ${title}`);
  await act(async () => row.click());
  await press("Open session");
}

async function typeMessage(text: string): Promise<void> {
  const field = labelled("Message") as HTMLTextAreaElement | null;
  if (!field) throw new Error("The session has no Message box");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("a refused send in one session leaves no error under another, and the other can send", async () => {
  compact = false;
  const delivered: string[] = [];
  sends.run = async (agentId, text) => {
    if (agentId === "ada") throw new Error("the daemon refused");
    delivered.push(`${agentId}:${text}`);
  };
  await mount();
  await act(async () =>
    deliver?.({ type: "snapshot", state: { ...OFFICE_WITH_ONE_AGENT, agents: [ADA, BO] } }),
  );
  await openSessionOf("Ada");
  await openSessionOf("Bo");
  await pressTab("Ada");
  await typeMessage("hello");
  await press("Send");
  expect(container.textContent).toContain("the daemon refused");

  await pressTab("Bo");
  expect(container.textContent).not.toContain("the daemon refused");
  await typeMessage("hi");
  await press("Send");
  expect(delivered).toEqual(["bo:hi"]);
});

test("a send still pending in one session does not stop another session's Send", async () => {
  compact = false;
  const delivered: string[] = [];
  sends.run = (agentId, text) => {
    if (agentId === "ada") return new Promise(() => undefined);
    delivered.push(`${agentId}:${text}`);
    return Promise.resolve();
  };
  await mount();
  await act(async () =>
    deliver?.({ type: "snapshot", state: { ...OFFICE_WITH_ONE_AGENT, agents: [ADA, BO] } }),
  );
  await openSessionOf("Ada");
  await openSessionOf("Bo");
  await pressTab("Ada");
  await typeMessage("hello");
  await press("Send");

  await pressTab("Bo");
  await typeMessage("hi");
  await press("Send");
  expect(delivered).toEqual(["bo:hi"]);
});

test("the floor receives the weather and service failures appear in Attention", async () => {
  compact = false;
  floor.webgl = true;
  view = "3d";
  await mount();
  const scene = { kind: "reading" as const, code: 63, temp: 14, cloud: 0.9 };
  await act(async () =>
    deliver?.({
      type: "snapshot",
      state: { ...EMPTY_OFFICE, weather: { scene, problem: null, readAt: 10 } },
    }),
  );
  expect(floor.props).toHaveProperty("weather", scene);
  await act(async () =>
    deliver?.({
      type: "snapshot",
      state: {
        ...EMPTY_OFFICE,
        weather: { scene: { kind: "season" }, problem: "Weather service failed", readAt: null },
      },
    }),
  );
  await pressTab("Attention");
  expect(container.textContent).toContain("Weather service failed");
});

test("restoring the fullscreen route inside Paseo leaves Sessions to the host sidebar", async () => {
  compact = false;
  view = "3d";
  floor.webgl = true;
  await mount({ layout: "fullscreen" });
  await sizeSurface(1440);
  expect(labelled("Hide details sidebar")).not.toBeNull();
  expect(container.querySelector('[data-testid="office-sessions-sidebar"]')).toBeNull();
  expect(labelled("Hide sessions sidebar")).toBeNull();
  expect(labelled("Show sessions sidebar")).toBeNull();
});

test("wide fullscreen gives Sessions its own rail and opens the chosen conversation beside the floor", async () => {
  compact = false;
  floor.webgl = true;
  view = "2d";
  let target: Element | null = null;
  Object.defineProperties(document, {
    fullscreenEnabled: { configurable: true, value: true },
    fullscreenElement: { configurable: true, get: () => target },
  });
  try {
    await mount();
    await seeAda();
    await sizeSurface(1440);
    const surface = container.firstElementChild as HTMLElement;
    surface.requestFullscreen = async () => {
      target = surface;
      document.dispatchEvent(new Event("fullscreenchange"));
    };
    await press("Full screen");
    expect(labelled("Activity")?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector('[role="tab"][aria-label="Sessions"]')).toBeNull();
    await pressFirst("Ada:");
    expect(sessionTab()?.getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("Reading the ledger");
    const sidebarSearch = labelled("Search agents");
    expect(sidebarSearch).not.toBeNull();
    await typeReply("Keep this draft");
    await press("Office 3D");
    expect(target).toBe(surface);
    expect(labelled("3D view")?.getAttribute("aria-selected")).toBe("true");
    expect(labelled("Activity")?.getAttribute("aria-selected")).toBe("true");
    await pressTab("Ada");
    expect(reply()).toBe("Keep this draft");
    // jsdom has no dialog top layer. Record the browser operation on the actual mounted dialog.
    const proto = Object.getPrototypeOf(document.createElement("dialog"));
    Object.defineProperties(proto, {
      showModal: {
        configurable: true,
        value() {
          this.setAttribute("open", "");
        },
      },
      close: {
        configurable: true,
        value() {
          this.removeAttribute("open");
        },
      },
    });
    try {
      await press("Open in workspace");
      const workspace = surface.querySelector<HTMLDialogElement>("dialog[open]")!;
      const workbench = workspace.querySelector('iframe[title="Paseo workspace"]');
      expect(workbench).not.toBeNull();
      await press("Office controls");
      const steps = workspace.querySelector<HTMLElement>('[aria-label="Session steps"]')!;
      await act(async () => steps.click());
      await press("Paseo workspace");
      await press("Office controls");
      expect(workspace.querySelector("iframe")).toBe(workbench);
      expect(steps.isConnected && steps.getAttribute("aria-pressed") === "true").toBe(true);
      expect(workspace.querySelector('[aria-label="Close"]')).toBeNull();
      await press("Minimize workspace");
      expect(workspace.open).toBe(false);
      expect(workbench?.isConnected).toBe(true);
      await press("Restore Shop · shop-api");
      expect(workspace.open).toBe(true);
      expect(workspace.querySelector("iframe")).toBe(workbench);
      expect(steps.getAttribute("aria-pressed")).toBe("true");
      await press("Workspace board");
      expect(surface.querySelectorAll("dialog[open]")).toHaveLength(2);
      await press("Close shop-api board");
      expect(surface.querySelector("dialog[open]")).toBe(workspace);
      expect(workspace.querySelector("textarea")?.value).toBe("Keep this draft");
      await press("Close Shop · shop-api");
      await press("Office settings");
      const settingsDialog = surface.querySelector("dialog[open]");
      expect(settingsDialog?.querySelector('[aria-label="Notes folder"]')).toBeInstanceOf(
        HTMLElement,
      );
      expect(settingsOpened).toBe(0);
      await press("Close Office settings");
      expect(surface.querySelector("dialog")).toBeNull();
      expect(reply()).toBe("Keep this draft");
      expect(labelled("Search agents")).toBe(sidebarSearch);
      const notes = {
        ...BROKEN_NOTES,
        scheduleError: null,
        failedAgentId: "ada",
        problem: "Rate limited",
      };
      await act(async () =>
        deliver?.({ type: "snapshot", state: { ...OFFICE_WITH_ONE_AGENT, notes } }),
      );
      await openAttention();
      await pressFirst("Stand-up:");
      expect(surface.querySelector('dialog[open][aria-label="Stand-up"]')).not.toBeNull();
      await press("Stand-up notes");
      expect(surface.querySelectorAll("dialog[open]")).toHaveLength(1);
      expect(surface.querySelector('dialog[open][aria-label="Stand-up notes"]')).not.toBeNull();
      await press("Close Stand-up notes");
      expect(surface.querySelector("dialog")).toBeNull();
      await pressTab("Ada");
      expect(reply()).toBe("Keep this draft");
    } finally {
      Reflect.deleteProperty(proto, "showModal");
      Reflect.deleteProperty(proto, "close");
    }

    await press("Hide sessions sidebar");
    expect(labelled("Show sessions sidebar")?.getAttribute("aria-expanded")).toBe("false");
    expect(reply()).toBe("Keep this draft");
    await press("Hide details sidebar");
    expect(labelled("Message")).toBeNull();
    expect(labelled("Show details sidebar")).not.toBeNull();
    expect(labelled("Chat")).toBeNull();
    expect(labelled("Team chat")?.getAttribute("role")).toBe("button");
    await press("Team chat");
    expect(labelled("To: Whole group")).not.toBeNull();
    await press("Close team chat");
    expect(labelled("To: Whole group")).toBeNull();
    await act(async () => deliver?.({ type: "chat", change: { op: "all", messages: [] } }));
    await act(async () =>
      deliver?.({ type: "chat", change: { op: "add", message: chatMessage(Date.now(), "Ada") } }),
    );
    await press("Open team chat: Ada · Hi");
    expect(labelled("To: Whole group")).not.toBeNull();
    await press("Close team chat");
    expect(labelled("Open team chat: Ada · Hi")).toBeNull();
    await press("Show details sidebar");
    expect(reply()).toBe("Keep this draft");
    expect(sessionTab()?.getAttribute("aria-selected")).toBe("true");
    await press("Show sessions sidebar");
    expect(labelled("Search agents")).toBe(sidebarSearch);
    await sizeSurface(820);
    expect(labelled("Hide sessions sidebar")).toBeNull();
    expect(container.querySelector('[role="tab"][aria-label^="Sessions"]')).not.toBeNull();
    await sizeSurface(1440);
    expect(labelled("Hide sessions sidebar")).not.toBeNull();

    target = null;
    await act(async () => void document.dispatchEvent(new Event("fullscreenchange")));
    expect(labelled("Full screen")).not.toBeNull();
    expect(container.querySelector('[data-testid="office-sessions-sidebar"]')).toBeNull();
    expect(sessionTab()?.getAttribute("aria-selected")).toBe("true");
  } finally {
    Reflect.deleteProperty(document, "fullscreenEnabled");
    Reflect.deleteProperty(document, "fullscreenElement");
  }
});

async function registerOffice() {
  const { default: contribute } = await import("../index.client.js");
  const remove = () => undefined;
  const addScreen = vi.fn<PluginClientContext["addScreen"]>(() => remove);
  const addSidebarHeaderItem = vi.fn<PluginClientContext["addSidebarHeaderItem"]>(() => remove);
  const cleanup = contribute({
    addScreen,
    addSidebarHeaderItem,
    addWorkspacePanel: () => remove,
    addSettingsScreen: () => remove,
    addCommandCenterItem: () => remove,
  } as unknown as PluginClientContext);
  const [{ Component: Office }] = addScreen.mock.calls[0];
  const [{ Component: Row }] = addSidebarHeaderItem.mock.calls[0];
  return { Office, Row, cleanup };
}

test("the registered Office 3D row opens the screen once and expands the visible office in place", async () => {
  const { Office, Row, cleanup } = await registerOffice();
  const anotherHost = await registerOffice();
  const openScreen = vi.fn<PluginSidebarItemProps["openScreen"]>();
  const host = { id: "h", label: "Host" };
  const layout = { compact: false, platform: "web" } as const;
  const item = { theme: THEME, host, layout, openScreen, openPopover: vi.fn() };
  const params = { layout: "fullscreen" };
  const props = { host, layout, theme: THEME, params };
  const location = { screenId: "office", params };
  const render = async (mounted: boolean, active: boolean, SidebarItem = Row) => {
    await act(async () =>
      root.render(
        <>
          <SidebarItem {...item} currentScreen={active ? location : null} />
          <div id="office-screen">{mounted && <Office {...props} />}</div>
        </>,
      ),
    );
  };
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
  try {
    await render(false, false);
    await press("Sidebar Office 3D");
    expect(openScreen.mock.calls).toEqual([[location]]);
    await render(true, true);
    const surface = container.querySelector<HTMLElement>("#office-screen > div");
    if (!surface) throw new Error("The registered screen did not render");
    const requestFullscreen = vi.fn(async () => undefined);
    surface.requestFullscreen = requestFullscreen;
    const hiddenBounds = surface.getBoundingClientRect();
    const measure = vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({
      ...hiddenBounds,
      width: 1100,
      height: 800,
      right: 1100,
      bottom: 800,
    });
    await press("Sidebar Office 3D");
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(openScreen).toHaveBeenCalledTimes(1);

    // A different host contribution has no registered office, even while this one is visible.
    await render(true, false, anotherHost.Row);
    await press("Sidebar Office 3D");
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(openScreen).toHaveBeenCalledTimes(2);

    // Paseo may retain an inactive panel and remove its layout box.
    await render(true, false);
    surface.parentElement!.hidden = true;
    measure.mockReturnValue(hiddenBounds);
    await press("Sidebar Office 3D");
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(openScreen).toHaveBeenCalledTimes(3);
  } finally {
    Reflect.deleteProperty(document, "fullscreenEnabled");
    cleanup();
    anotherHost.cleanup();
  }
});

test("the native Office 3D row opens its regular screen", async () => {
  const { Row, cleanup } = await registerOffice();
  const props: PluginSidebarItemProps = {
    host: { id: "h", label: "Host" },
    layout: { compact: true, platform: "ios" },
    theme: THEME,
    currentScreen: null,
    openScreen: vi.fn(),
    openPopover: vi.fn(),
  };
  await act(async () => root.render(<Row {...props} />));
  await press("Sidebar Office 3D");
  expect(props.openScreen).toHaveBeenCalledWith({ screenId: "office" });
  cleanup();
});
