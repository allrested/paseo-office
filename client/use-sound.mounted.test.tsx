/**
 * @vitest-environment jsdom
 */
// The Sound switch's hook, mounted. The device's settings are a stand-in that holds the document and
// records each save.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SettingsState } from "@getpaseo/plugin/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { officeDeviceSettings } from "../shared/settings.js";
import { stockSave } from "./stock-save.test.js";
import { useSoundSwitch, type SoundSwitch } from "./use-sound.js";

type Device = SettingsState<typeof officeDeviceSettings.schema>;
type Values = Extract<Device, { status: "ready" }>["values"];
type Stored = { status: "loading" } | { status: "ready"; values: Values; revision: string };

let stored: Stored;
let saved: { values: Values; revision: string }[];
/** While set, saves are refused; a reload then shows this document (another writer got in first). */
let moved: Stored | null;
/** While true, saves are refused and a reload shows the same document. */
let refuses: boolean;

vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: (): Device => ({
    ...stored,
    saving: false,
    saveError: null,
    save: async (values: Values, revision: string) => {
      if (moved !== null || refuses) return false;
      if (!(await stockSave(officeDeviceSettings)(values))) return false;
      saved.push({ values, revision });
      stored = { status: "ready", values, revision: `r${saved.length + 1}` };
      return true;
    },
    reset: async () => true,
    reload: async () => {
      if (moved !== null) stored = moved;
      moved = null;
    },
  }),
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const values = (over: Partial<Values> = {}): Values => ({
  threeD: true,
  view: "2d",
  rungIncidents: { "jira:SHOP-1": 5 },
  sound: false,
  ...over,
});
const ready = (over: Partial<Values> = {}, revision = "r1"): Stored => ({
  status: "ready",
  values: values(over),
  revision,
});

let container: HTMLElement;
let root: Root;
let current: SoundSwitch;
function Probe() {
  current = useSoundSwitch();
  return null;
}
const mount = () => act(async () => root.render(<Probe />));
const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));

beforeEach(() => {
  stored = ready();
  saved = [];
  moved = null;
  refuses = false;
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(async () => root.unmount()));

test("it reads null while the setting loads, and the stored value once it is read", async () => {
  stored = { status: "loading" };
  await mount();
  expect(current.on).toBeNull();
  stored = ready({ sound: true });
  await mount();
  expect(current.on).toBe(true);
});

test("a tap shows at once and saves the whole document with sound changed", async () => {
  await mount();
  await act(async () => current.set(true));
  await settle();
  expect(current.on).toBe(true);
  expect(saved).toEqual([{ values: values({ sound: true }), revision: "r1" }]);
});

test("a tap that the store already holds saves nothing", async () => {
  stored = ready({ sound: true });
  await mount();
  await act(async () => current.set(true));
  await settle();
  expect(saved).toEqual([]);
});

test("a save that lost to another writer is tried again once on the new revision, keeping their fields", async () => {
  await mount();
  moved = ready({ view: "3d", rungIncidents: { "jira:SHOP-2": 9 } }, "r7");
  await act(async () => current.set(true));
  await settle();
  moved = null;
  await settle();
  expect(saved).toEqual([
    {
      values: values({ view: "3d", rungIncidents: { "jira:SHOP-2": 9 }, sound: true }),
      revision: "r7",
    },
  ]);
  expect(current.unsaved).toBe(false);
});

test("a refusal that moved nothing is not tried again; the switch holds the tap and says unsaved", async () => {
  await mount();
  refuses = true;
  await act(async () => current.set(true));
  await settle();
  await settle();
  expect(saved).toEqual([]);
  expect(current.on).toBe(true);
  expect(current.unsaved).toBe(true);
  // A new tap tries again.
  refuses = false;
  await act(async () => current.set(true));
  await settle();
  expect(current.unsaved).toBe(false);
  expect(saved).toEqual([{ values: values({ sound: true }), revision: "r1" }]);
});
