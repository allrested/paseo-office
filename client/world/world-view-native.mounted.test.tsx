/**
 * @vitest-environment jsdom
 */
// The 3D office's native view, mounted with ScriptFrame faked: what it posts to the page, in
// order, and what it does with what the page posts back.
import { act, forwardRef, useEffect, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeModel } from "../../shared/model.js";
import type { OfficeStyles } from "../styles.js";
import type { WorldPlan } from "./adapter.js";
import { WorldViewNative } from "./world-view-native.js";

import type { SceneWords } from "./use-scene-words.js";
const words = vi.hoisted(() => ({ current: {} as SceneWords }));
vi.mock("./use-scene-words.js", () => ({ useSceneWords: () => words.current }));

const h = vi.hoisted(() => ({
  mounted: 0,
  unmounted: 0,
  posted: [] as string[],
  props: null as {
    script: string;
    title: string;
    onMessage(t: string): void;
    onError?(m: string): void;
  } | null,
  loaded: { status: "ready", script: "SCENE_SCRIPT" },
}));

let receiveStreet: (event: import("../../shared/contracts.js").StreetEvent) => void;
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: () => async () => "car models",
  useSubscription: (
    contract: { name: string },
    _input: unknown,
    onEvent: (event: import("../../shared/contracts.js").StreetEvent) => void,
  ) => {
    if (contract.name === "office.street.events") receiveStreet = onEvent;
    return { status: "live" };
  },
  useSettings: () => ({ status: "loading" }),
}));
vi.mock("@getpaseo/plugin/client/ui", () => ({ useToast: () => ({ error: () => undefined }) }));
vi.mock("./script-frame-kit.js", async () => {
  const Frame = forwardRef((props: NonNullable<typeof h.props>, ref) => {
    h.props = props;
    useEffect(() => {
      h.mounted++;
      return () => {
        h.unmounted++;
      };
    }, []);
    useImperativeHandle(ref, () => ({ post: (text: string) => h.posted.push(text) }));
    return null;
  });
  return { kitScriptFrame: () => Frame, hasScriptFrame: () => true };
});
vi.mock("./world-loader.js", async (original) => ({
  ...(await original<typeof import("./world-loader.js")>()),
  messageOf: (error: unknown) => String(error),
  sharedWorldLoader: {
    subscribe: () => () => undefined,
    state: () => h.loaded,
    load: async () => undefined,
  },
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const STYLES = new Proxy({}, { get: () => ({}) }) as OfficeStyles;
const MODEL: OfficeModel = {
  rooms: [],
  attention: [],
  agentTasks: [],
  agents: new Map(),
  roomOfAgent: new Map(),
  waitingOn: new Map(),
  dutyList: null,
  duties: [],
};
const ignore = () => undefined;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  words.current = { status: "ready", language: "en", words: undefined, note: null };
  h.mounted = 0;
  h.unmounted = 0;
  h.posted = [];
  h.props = null;
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

async function mount(overrides: Partial<Parameters<typeof WorldViewNative>[0]> = {}) {
  const props = {
    model: MODEL,
    theme: THEME,
    styles: STYLES,
    plan: "pro" as WorldPlan | null,
    focusRoomId: null,
    focusRequest: null,
    selectedAgentId: null,
    onSelectAgent: ignore,
    onSelectBoard: ignore,
    machine: null,
    onOpenMachine: ignore,
    onOpenResources: undefined,
    onOpenAgentWorkspace: undefined,
    onOpenLibrary: ignore,
    onOpenNotes: ignore,
    meeting: false,
    incidents: undefined,
    onOpenIncidents: ignore,
    onProblem: ignore,
    // The surface holds the switch: still being read here.
    sound: { on: null, unsaved: false, set: ignore },
    ...overrides,
  };
  await act(async () => root.render(<WorldViewNative {...props} />));
}

const calls = () => h.posted.map((text) => JSON.parse(text) as { call: string; args: unknown[] });

test("the frame runs the bridge's page with the scene's script, under the office's title", async () => {
  await mount();
  expect(h.props?.title).toBe("Office in 3D");
  expect(h.props?.script).toContain("SCENE_SCRIPT");
  expect(h.props?.script).toContain("PaseoOfficeWorld");
});

test("start is the first message; photo is off; the feed follows in order", async () => {
  await mount();
  const [start, ...rest] = calls();
  expect(start.call).toBe("start");
  const options = start.args[0] as Record<string, unknown>;
  expect(options.photo).toBe(false);
  expect(options.brand).toEqual({ name: "Paseo", logoUrl: null });
  expect(options.callbacks).toEqual(
    expect.arrayContaining([
      "onSelect",
      "onBoard",
      "onMachine",
      "onLibrary",
      "onBell",
      "onNotes",
      "onIncidents",
      "onProblem",
    ]),
  );
  expect(options.callbacks).not.toContain("onOpen");
  expect(options.callbacks).not.toContain("onResources");
  const names = rest.map((message) => message.call);
  expect(names).toEqual(
    expect.arrayContaining(["setTheme", "setSessions", "setBoardRows", "setMachine", "select"]),
  );
  // the people are seated before the view looks at any
  expect(names.indexOf("setSessions")).toBeLessThan(names.indexOf("select"));
});

test("onOpen is given where the office can open a session", async () => {
  await mount({ onOpenAgentWorkspace: ignore });
  expect((calls()[0].args[0] as { callbacks: string[] }).callbacks).toContain("onOpen");
});

test("a person chosen in the scene opens their card", async () => {
  const onSelectAgent = vi.fn();
  await mount({ onSelectAgent });
  act(() => h.props?.onMessage(JSON.stringify({ callback: "onSelect", args: ["a1"] })));
  expect(onSelectAgent).toHaveBeenCalledWith("a1");
});

test("a problem the page posts, and a frame error, reach the surface", async () => {
  const onProblem = vi.fn();
  await mount({ onProblem });
  act(() => h.props?.onMessage(JSON.stringify({ problem: "WebGL2 is not available" })));
  act(() => h.props?.onError?.("The page's process ended"));
  expect(onProblem.mock.calls).toEqual([["WebGL2 is not available"], ["The page's process ended"]]);
});

test("closing the view tells the page to stop", async () => {
  await mount();
  h.posted = [];
  act(() => root.unmount());
  expect(calls().map((message) => message.call)).toEqual(["stop"]);
  root = createRoot(container);
});

test("the start names the Sound callback to the page", async () => {
  await mount();
  expect((calls()[0].args[0] as { callbacks: string[] }).callbacks).toContain("onSound");
});

test("with no plan yet nothing is posted", async () => {
  await mount({ plan: null });
  expect(h.posted).toEqual([]);
  expect(h.props).toBeNull();
});

test("a changed plan stops the page and starts a new one on the new plan", async () => {
  await mount({ plan: "pro" });
  h.posted = [];
  await mount({ plan: "cozy" });
  const names = calls().map((message) => message.call);
  expect(names[0]).toBe("stop");
  const start = calls().find((message) => message.call === "start");
  expect(start?.args[0]).toMatchObject({ plan: "cozy" });
  expect(names.filter((name) => name === "start")).toHaveLength(1);
});

test("starts a new phone frame with the car kit after the street is enabled", async () => {
  await mount({ streetOn: false });
  h.posted = [];
  await mount({ streetOn: true });
  const started = calls().find((m) => m.call === "start");
  expect(started?.args[0]).toMatchObject({ street: { kit: "car models" } });
  receiveStreet({ type: "release", tag: "v3.8.4" });
  receiveStreet({ type: "claude", reading: { version: "2.2.0", at: 123 } });
  expect(calls().slice(-2)).toEqual([
    { call: "photoRelease", args: ["v3.8.4"] },
    { call: "setClaudeVersion", args: [{ version: "2.2.0", at: 123 }] },
  ]);
});

test("the phone waits for words and remounts its frame in each chosen language", async () => {
  words.current.status = "loading";
  await mount();
  expect(h.mounted).toBe(0);
  expect(calls()).toEqual([]);
  words.current = { status: "ready", language: "vi", words: '{"dict":{}}', note: null };
  await mount();
  expect(calls()[0].args[0]).toMatchObject({ language: "vi", words: '{"dict":{}}' });
  words.current = { ...words.current, language: "th", words: "{}" };
  await mount();
  expect([h.mounted, h.unmounted]).toEqual([2, 1]);
  expect(
    calls()
      .filter((m) => m.call === "start")
      .map((m) => m.args[0]),
  ).toMatchObject([{ language: "vi" }, { language: "th", words: "{}" }]);
});

test("a language failure appears in the floor note after the phone starts", async () => {
  words.current.note = "ไทย text could not be loaded; the scene is in English";
  const agent = {
    id: "a1",
    title: "Agent",
    provider: "claude",
    model: null,
    status: "idle" as const,
    workspaceId: null,
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-16T00:00:00Z",
  };
  await mount({ model: { ...MODEL, agents: new Map([[agent.id, agent]]) } });
  expect(container.textContent).toContain(words.current.note);
});

test("the phone starts directly on Beach, changes its lighting in place and remounts for Countryside", async () => {
  await mount({ scene: "beach", night: false, streetOn: true });
  expect(calls()[0]).toMatchObject({ call: "start", args: [{ scene: "beach", dark: false }] });
  expect(calls()[0].args[0]).not.toHaveProperty("street");
  h.posted = [];
  await mount({ scene: "beach", night: true, streetOn: true });
  expect(calls()).toContainEqual({ call: "setTheme", args: [{ dark: true, colors: {} }] });
  expect([h.mounted, h.unmounted]).toEqual([1, 0]);
  h.posted = [];
  await mount({ scene: "countryside", night: true, streetOn: true });
  const start = calls().find((c) => c.call === "start");
  expect(start?.args[0]).toMatchObject({ scene: "countryside", dark: true });
  expect(start?.args[0]).not.toHaveProperty("street");
  expect([h.mounted, h.unmounted]).toEqual([2, 1]);
});
