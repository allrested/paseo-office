/**
 * @vitest-environment jsdom
 */
// The Office settings screen, mounted as the app mounts a settings screen. The host's hooks are
// stood in: the settings record what was saved, and the office's subscription speaks only when a
// test delivers an event.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeEvent } from "../shared/contracts.js";
import {
  officeDeviceSettings,
  officeHostSettings,
  officeLanguageSettings,
} from "../shared/settings.js";
import { EMPTY_OFFICE } from "./office-state.js";
import { stockSave } from "./stock-save.test.js";

let hostSaves: unknown[];
let deviceSaves: unknown[];
let deliver: ((event: OfficeEvent) => void) | null;

/** What the device's setting holds; a test sets it before it mounts. */
const deviceValues = vi.hoisted(() => ({
  current: { threeD: true, view: "list", rungIncidents: {}, sound: false } as Record<
    string,
    unknown
  >,
}));

vi.mock("@getpaseo/plugin/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@getpaseo/plugin/client")>()),
  useSettings: (settings: { id: string }) => {
    if (settings.id === "office-language")
      return {
        status: "ready",
        revision: "lang-1",
        values: officeLanguageSettings.schema.parse({}),
        saving: false,
        saveError: null,
        save: stockSave(officeLanguageSettings),
      };
    const device = settings.id === "office-device";
    return {
      status: "ready",
      revision: "r1",
      values: device ? deviceValues.current : officeHostSettings.schema.parse({}),
      saving: false,
      saveError: null,
      save: async (values: unknown) => {
        (device ? deviceSaves : hostSaves).push(values);
        return stockSave(device ? officeDeviceSettings : officeHostSettings)(values);
      },
      reset: async () => true,
      reload: async () => undefined,
    };
  },
  useSubscription: (
    contract: { name: string },
    _input: unknown,
    onEvent: (event: OfficeEvent) => void,
  ) => {
    if (contract.name === "office.state") deliver = onEvent;
    return { status: "live" };
  },
  useRpc: () => async () => undefined,
  usePaseo: () => ({ agents: { ref: () => ({}) } }),
}));

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { ScrollView, TextInput, View } = await import("react-native");
  const Modal = (props: { title: string; open: boolean; children: ReactNode }) =>
    props.open ? createElement("section", { "aria-label": props.title }, props.children) : null;
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  const Icon = (props: { name: string }) => createElement(View, { testID: `icon-${props.name}` });
  return {
    ExternalLink: () => null,
    Icon,
    Markdown: () => null,
    Modal,
    ScrollView,
    TextInput,
    copyText: async () => undefined,
    useToast: () => ({ show: () => undefined, error: () => undefined }),
  };
});

vi.mock("./web-env.web.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./web-env.web.js")>()),
  hasWebGL2: () => false,
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const { OfficeSettings } = await import("./office-settings.js");

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
let container: HTMLElement;
let root: Root;

async function mount(): Promise<void> {
  const props = {
    theme: THEME,
    layout: { compact: false, platform: "web" },
    host: { id: "host", label: "Host" },
  } as unknown as PluginSurfaceProps;
  await act(async () => root.render(createElement(OfficeSettings, props)));
}

function labelled(label: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[aria-label^="${label}"]`);
}

beforeEach(() => {
  deviceValues.current = { threeD: true, view: "list", rungIncidents: {}, sound: false };
  hostSaves = [];
  deviceSaves = [];
  deliver = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("the screen holds the switches, the fields and the view", async () => {
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));

  expect(labelled("3D office language")?.getAttribute("role")).toBe("group");
  expect(labelled("Wake agents")?.getAttribute("role")).toBe("switch");
  expect(labelled("Agent tools")?.getAttribute("role")).toBe("switch");
  for (const field of ["Notes folder", "Time zone", "Jira projects", "Sentry organisation"]) {
    expect(container.querySelector(`input[aria-label="${field}"]`)).not.toBeNull();
  }
  expect(labelled("List view")?.getAttribute("aria-selected")).toBe("true");
});

test("a view chosen here is saved on the device", async () => {
  await mount();
  await act(async () => labelled("2D view")?.click());

  expect(deviceSaves).toEqual([{ threeD: true, view: "2d", rungIncidents: {}, sound: false }]);
  expect(hostSaves).toEqual([]);
});

test("a view chosen here keeps the last agent the device holds", async () => {
  const lastAgent = { provider: "claude", model: "opus" };
  deviceValues.current = { threeD: true, view: "list", rungIncidents: {}, lastAgent };
  await mount();
  await act(async () => labelled("2D view")?.click());

  expect(deviceSaves).toEqual([{ threeD: true, view: "2d", rungIncidents: {}, lastAgent }]);
});

test("the Sound switch saves the device's document with sound on, and nothing of the host's", async () => {
  await mount();
  await act(async () => labelled("Sound")?.click());

  expect(deviceSaves).toEqual([{ threeD: true, view: "list", rungIncidents: {}, sound: true }]);
  expect(hostSaves).toEqual([]);
});

test("a view chosen here keeps the Sound switch the device holds", async () => {
  deviceValues.current = { threeD: true, view: "list", rungIncidents: {}, sound: true };
  await mount();
  await act(async () => labelled("2D view")?.click());

  expect(deviceSaves).toEqual([{ threeD: true, view: "2d", rungIncidents: {}, sound: true }]);
});

test("a view chosen on a device that never started an agent is stored and not shown as unsaved", async () => {
  deviceValues.current = { threeD: true, rungIncidents: {} };
  await mount();
  await act(async () => labelled("List view")?.click());
  deviceValues.current = { threeD: true, view: "list", rungIncidents: {} };

  expect(deviceSaves).toStrictEqual([{ threeD: false, view: "list", rungIncidents: {} }]);
  expect(container.textContent).not.toContain("Unable to save the view on this device");
});

test("the notes schedule's failure shows under the Time zone field", async () => {
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

  const failure = [...container.querySelectorAll("*")].find(
    (node) =>
      node.children.length === 0 &&
      node.textContent === "Unable to schedule the stand-up notes: unknown zone Mars/Olympus",
  );
  const field = container.querySelector('input[aria-label="Time zone"]');
  if (!failure || !field) throw new Error("The failure or the Time zone field is not drawn");
  expect(field.compareDocumentPosition(failure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("older devices keep their street choice and can switch to countryside in daylight", async () => {
  await mount();
  expect(labelled("City")?.getAttribute("aria-pressed")).toBe("true");
  await act(async () => labelled("Countryside")?.click());
  expect(deviceSaves).toContainEqual({ ...deviceValues.current, scene: "countryside" });
  await act(async () => labelled("Day")?.click());
  expect(deviceSaves).toContainEqual(expect.objectContaining({ lighting: "day" }));
});
