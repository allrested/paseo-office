/**
 * @vitest-environment jsdom
 */
// The 3D office's view, mounted, for where the keyboard goes when the scene calls back. The frame,
// the loaded script and the host's hooks are stand-ins; the scene's API records its start.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeAgent } from "../../shared/contracts.js";
import { buildOfficeModel, type OfficeModel } from "../../shared/model.js";
import { useOfficeStyles, type OfficeStyles } from "../styles.js";
import type { WorldPlan } from "./adapter.js";
import type { WorldApi, WorldStartOptions } from "./world-api.js";
import { WorldView } from "./world-view.js";

import type { SceneWords } from "./use-scene-words.js";
const words = vi.hoisted(() => ({ current: {} as SceneWords }));
vi.mock("./use-scene-words.js", () => ({ useSceneWords: () => words.current }));

const frame = vi.hoisted(() => ({
  focusApp: vi.fn(),
  started: null as WorldStartOptions | null,
  /** Every start, in order, and how many frames were taken out. */
  starts: [] as WorldStartOptions[],
  disposed: 0,
  // useSyncExternalStore wants the same snapshot back while nothing changed.
  loaded: { status: "ready", script: "" },
}));

vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: () => async () => ({}),
  useSettings: () => ({ status: "loading" }),
}));
vi.mock("@getpaseo/plugin/client/ui", () => ({
  useToast: () => ({ error: () => undefined }),
}));
vi.mock("../web-env.web.js", () => ({ readBrand: () => null }));
vi.mock("./world-loader.js", () => ({
  messageOf: (error: unknown) => String(error),
  sharedWorldLoader: {
    subscribe: () => () => undefined,
    state: () => frame.loaded,
    load: async () => undefined,
  },
}));
vi.mock("./world-frame.web.js", () => ({
  focusApp: frame.focusApp,
  openWorldFrame: () => {
    // Every method does nothing but start; "then" stays absent so the promise resolves to it.
    const api = new Proxy({} as WorldApi, {
      get: (_, key) => {
        if (key === "then") return undefined;
        if (key === "start") {
          return (options: WorldStartOptions) => {
            frame.started = options;
            frame.starts.push(options);
          };
        }
        return () => undefined;
      },
    });
    return {
      api: Promise.resolve(api),
      dispose: () => {
        frame.disposed += 1;
      },
    };
  },
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const STYLES = new Proxy({}, { get: () => ({}) }) as OfficeStyles;
const MODEL: OfficeModel = {
  rooms: [],
  attention: [],
  agentTasks: [],
  agents: new Map(),
  roomOfAgent: new Map(),
  waitingOn: new Map(),
};
const ignore = () => undefined;
/** The surface holds the Sound switch: still being read here. */
const SOUND = { on: null, unsaved: false, set: ignore };

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  words.current = { status: "ready", language: "en", words: undefined, note: null };
  frame.focusApp.mockClear();
  frame.started = null;
  frame.starts = [];
  frame.disposed = 0;
  // jsdom lays nothing out: the view starts the office only in a container with a size.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function office(
  plan: WorldPlan | null,
  onSelectAgent: (id: string | null) => void = ignore,
  model: OfficeModel = MODEL,
) {
  return (
    <WorldView
      plan={plan}
      model={model}
      theme={THEME}
      styles={STYLES}
      focusRoomId={null}
      focusRequest={null}
      selectedAgentId={null}
      onSelectAgent={onSelectAgent}
      onSelectBoard={ignore}
      machine={null}
      onOpenMachine={ignore}
      onOpenResources={undefined}
      onOpenSession={undefined}
      onOpenLibrary={ignore}
      onOpenNotes={ignore}
      meeting={false}
      incidents={undefined}
      onOpenIncidents={ignore}
      onProblem={ignore}
      sound={SOUND}
    />
  );
}

async function startedOffice(
  onSelectAgent: (id: string | null) => void,
  model: OfficeModel = MODEL,
): Promise<WorldStartOptions> {
  await act(async () => root.render(office("pro", onSelectAgent, model)));
  if (frame.started === null) throw new Error("the office did not start");
  return frame.started;
}

test("with no plan yet nothing starts, and the view says it is loading", async () => {
  await act(async () => root.render(office(null)));
  expect(frame.starts).toHaveLength(0);
  expect(container.textContent).toContain("Loading the 3D view...");
});

test("the scene starts on the plan it is given", async () => {
  await act(async () => root.render(office("cozy")));
  expect(frame.starts.map((options) => options.plan)).toEqual(["cozy"]);
});

test("a changed plan takes the frame out and starts the scene again on the new plan", async () => {
  await act(async () => root.render(office("pro")));
  expect(frame.disposed).toBe(0);
  await act(async () => root.render(office("cozy")));
  expect(frame.disposed).toBe(1);
  expect(frame.starts.map((options) => options.plan)).toEqual(["pro", "cozy"]);
  // The same plan again is no restart.
  await act(async () => root.render(office("cozy")));
  expect(frame.starts).toHaveLength(2);
  expect(frame.disposed).toBe(1);
});

test("a person chosen in the scene opens their card and takes the keyboard with it", async () => {
  const onSelectAgent = vi.fn();
  const options = await startedOffice(onSelectAgent);
  options.onSelect?.("agent-1");
  expect(onSelectAgent).toHaveBeenCalledWith("agent-1");
  expect(frame.focusApp).toHaveBeenCalledTimes(1);
});

// Walk in closes an open card (first-person.js enterFp); the walk needs the keys in the frame.
test("a card closed from the scene leaves the keyboard where it is", async () => {
  const onSelectAgent = vi.fn();
  const options = await startedOffice(onSelectAgent);
  options.onSelect?.(null);
  expect(onSelectAgent).toHaveBeenCalledWith(null);
  expect(frame.focusApp).not.toHaveBeenCalled();
});

const EMPTY_FLOOR = "No agents on this host yet. One that starts takes a desk here.";

test("an empty floor gets its note; a floor with someone on it does not", async () => {
  await startedOffice(ignore);
  expect(container.textContent).toContain(EMPTY_FLOOR);
  words.current.note = "The language could not be loaded.";
  await startedOffice(ignore);
  expect(container.textContent).not.toContain(words.current.note);
  const agent: OfficeAgent = {
    id: "a1",
    title: "Agent a1",
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-16T00:00:00Z",
  };
  const model = buildOfficeModel({
    agents: [agent],
    workspaces: [{ id: "w1", name: "shop-api", projectName: "shop" }],
    activity: {},
    doing: {},
    boards: {},
    wake: { paused: false, queued: {} },
  });
  await startedOffice(ignore, model);
  expect(container.textContent).not.toContain(EMPTY_FLOOR);
  expect(container.textContent).toContain(words.current.note);
});

let probed: OfficeStyles | null = null;
function StylesProbe(props: { compact: boolean; touchScreen: boolean }) {
  probed = useOfficeStyles(THEME, props.compact, props.touchScreen);
  return null;
}

/** How far down the view corner reaches, from its top, padding, border and controls. */
function cornerBottom(styles: OfficeStyles): number {
  const corner = styles.viewCorner;
  const controls = Number(styles.segment.minHeight);
  return (
    Number(corner.top) +
    2 * Number(corner.paddingVertical) +
    2 * Number(corner.borderWidth) +
    controls
  );
}

// The scene's camera bar is at the bottom centre and the view corner at the top right; a phone's
// corner takes most of the top, so the note goes under it. Where it lands in pixels is a look.
test.each([
  { compact: true, touchScreen: true },
  { compact: false, touchScreen: false },
  { compact: false, touchScreen: true },
])("the floor's note sits top left, under the view corner (%o)", async (layout) => {
  await act(async () => root.render(<StylesProbe {...layout} />));
  if (probed === null) throw new Error("no styles");
  const note = probed.sceneNote;
  expect(note.position).toBe("absolute");
  expect(note.bottom).toBeUndefined();
  expect(note.left).toBe(probed.viewCorner.right);
  expect(Number(note.top)).toBeGreaterThan(cornerBottom(probed));
});

test("the start gives the scene a Sound callback", async () => {
  const options = await startedOffice(ignore);
  expect(typeof options.onSound).toBe("function");
});

test("the web frame waits for words and restarts in each chosen language", async () => {
  words.current.status = "loading";
  await act(async () => root.render(office("pro")));
  expect(frame.starts).toHaveLength(0);
  expect(container.textContent).toContain("Loading the 3D view...");
  words.current = { status: "ready", language: "vi", words: '{"dict":{}}', note: null };
  await act(async () => root.render(office("pro")));
  expect(frame.started).toMatchObject({ language: "vi", words: '{"dict":{}}' });
  words.current = { ...words.current, language: "th", words: "{}" };
  await act(async () => root.render(office("pro")));
  expect(frame.disposed).toBe(1);
  expect(frame.starts).toMatchObject([{ language: "vi" }, { language: "th", words: "{}" }]);
});
