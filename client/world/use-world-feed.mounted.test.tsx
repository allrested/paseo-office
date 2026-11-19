/**
 * @vitest-environment jsdom
 */
// What the hook sends a started scene, with a recording stand-in for the scene's API.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeAgent } from "../../shared/contracts.js";
import { buildOfficeModel, type OfficeModel } from "../../shared/model.js";
import { useWorldFeed, type WorldFeedInput } from "./use-world-feed.js";
import type { WorldApi } from "./world-api.js";

vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: () => ({ status: "loading" }),
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

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
const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

function input(overrides: Partial<WorldFeedInput> = {}): WorldFeedInput {
  return {
    model: MODEL,
    theme: THEME,
    focusRoomId: null,
    focusRequest: null,
    selectedAgentId: null,
    machine: null,
    meeting: false,
    incidents: undefined,
    sound: null,
    plan: "pro",
    ...overrides,
  };
}

function fakeScene() {
  const calls: string[] = [];
  const api = new Proxy({} as WorldApi, {
    get:
      (_, name: string) =>
      (...args: unknown[]) =>
        calls.push(`${name}:${JSON.stringify(args)}`),
  });
  return { api, calls };
}

let container: HTMLElement;
let root: Root;
let note: string | null = "unset";

function Probe(props: { api: WorldApi | null; feed: WorldFeedInput }) {
  note = useWorldFeed(props.api, props.feed).note;
  return null;
}

beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

test("sends nothing while there is no scene", async () => {
  const { calls } = fakeScene();
  await act(async () => root.render(<Probe api={null} feed={input()} />));
  await act(async () =>
    root.render(<Probe api={null} feed={input({ selectedAgentId: "a1", meeting: true })} />),
  );
  expect(note).toBeNull();
  expect(calls).toEqual([]);
});

test("sends nothing once the scene is gone, whatever changes after", async () => {
  const { api, calls } = fakeScene();
  await act(async () => root.render(<Probe api={api} feed={input()} />));
  await act(async () => root.render(<Probe api={null} feed={input()} />));
  calls.length = 0;
  await act(async () =>
    root.render(
      <Probe
        api={null}
        feed={input({
          selectedAgentId: "a1",
          meeting: true,
          focusRequest: { agentId: "a2", nonce: 1 },
        })}
      />,
    ),
  );
  expect(calls).toEqual([]);
  expect(note).toBeNull();
});

test("seats the people, writes the board, sets the machine and the selection once the scene starts", async () => {
  const { api, calls } = fakeScene();
  await act(async () => root.render(<Probe api={api} feed={input()} />));
  const names = calls.map((call) => call.split(":")[0]);
  expect(names).toEqual(
    expect.arrayContaining([
      "setTheme",
      "setSessions",
      "setBoardRows",
      "setDuties",
      "setMachine",
      "select",
    ]),
  );
  expect(calls).toContain("setSessions:[[]]");
  // No duty list from the host yet: the scene keeps its own rota.
  expect(calls).toContain("setDuties:[null]");
  expect(calls).toContain("setMachine:[null]");
  expect(calls).toContain("select:[null]");
});

test("a duty list from the host, even an empty one, replaces the scene's rota", async () => {
  const { api, calls } = fakeScene();
  await act(async () =>
    root.render(<Probe api={api} feed={input({ model: { ...MODEL, dutyList: [] } })} />),
  );
  expect(calls).toContain("setDuties:[[]]");
  expect(calls).not.toContain("setDuties:[null]");
});

test("follows the selection and the stand-up", async () => {
  const { api, calls } = fakeScene();
  await act(async () => root.render(<Probe api={api} feed={input()} />));
  await act(async () => root.render(<Probe api={api} feed={input({ selectedAgentId: "a1" })} />));
  await act(async () =>
    root.render(<Probe api={api} feed={input({ selectedAgentId: "a1", meeting: true })} />),
  );
  expect(calls).toContain('select:["a1"]');
  expect(calls).toContain("meet:[]");
});

test("a request for a person is sent once", async () => {
  const { api, calls } = fakeScene();
  const request = { agentId: "a2", nonce: 1 };
  await act(async () => root.render(<Probe api={api} feed={input()} />));
  await act(async () => root.render(<Probe api={api} feed={input({ focusRequest: request })} />));
  await act(async () => root.render(<Probe api={api} feed={input({ focusRequest: request })} />));
  expect(calls.filter((call) => call === 'select:["a2"]')).toHaveLength(1);
});

test("the Sound switch is sent once it is read, again when it changes, and never as null", async () => {
  const { api, calls } = fakeScene();
  const show = (sound: boolean | null) =>
    act(async () => root.render(<Probe api={api} feed={input({ sound })} />));
  await show(null);
  expect(calls.filter((call) => call.startsWith("setSound"))).toEqual([]);
  await show(false);
  await show(true);
  expect(calls.filter((call) => call.startsWith("setSound"))).toEqual([
    "setSound:[false]",
    "setSound:[true]",
  ]);
});

/** `count` agents at rest in one workspace. */
function crowd(count: number): OfficeModel {
  const agents: OfficeAgent[] = Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    title: `Agent ${index + 1}`,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: `2026-11-16T00:00:${String(index + 1).padStart(2, "0")}Z`,
  }));
  return buildOfficeModel({
    agents,
    workspaces: [{ id: "w1", name: "shop-api", projectName: "shop" }],
    activity: {},
    doing: {},
    boards: {},
    wake: { paused: false, queued: {} },
  });
}

/** How many people a scene was told to seat when it started. */
function seated(calls: string[]): number {
  const first = calls.find((call) => call.startsWith("setSessions:")) ?? "";
  return (JSON.parse(first.slice("setSessions:".length)) as unknown[][])[0].length;
}

test("the plan's desks decide who is seated, and the note says who has none", async () => {
  // Ten agents: more than the cozy room's nine desks, fewer than the company floor's twelve.
  const company = fakeScene();
  await act(async () =>
    root.render(<Probe api={company.api} feed={input({ model: crowd(10), plan: "pro" })} />),
  );
  expect(seated(company.calls)).toBe(10);
  expect(note).toBeNull();

  const cozy = fakeScene();
  await act(async () =>
    root.render(<Probe api={cozy.api} feed={input({ model: crowd(10), plan: "cozy" })} />),
  );
  expect(seated(cozy.calls)).toBe(9);
  expect(note).toBe("1 agent has no desk on this floor. The list shows everyone.");
  const headquarters = fakeScene();
  await act(async () =>
    root.render(<Probe api={headquarters.api} feed={input({ model: crowd(45), plan: "hq" })} />),
  );
  expect(seated(headquarters.calls)).toBe(44);
  expect(note).toBe("1 agent has no desk on this floor. The list shows everyone.");
});

test("weather follows the host after seating the people", async () => {
  const { api, calls } = fakeScene();
  await act(async () => root.render(<Probe api={api} feed={input()} />));
  expect(calls.indexOf('setWeather:[{"kind":"none"}]')).toBeGreaterThan(
    calls.indexOf("setSessions:[[]]"),
  );
  const weather = { kind: "reading" as const, code: 63, temp: 14, cloud: 0.9 };
  await act(async () => root.render(<Probe api={api} feed={input({ weather })} />));
  expect(calls).toContain("setWeather:" + JSON.stringify([weather]));
});

test("life reaches each started scene once across equivalent lift readings", async () => {
  const { api, calls } = fakeScene();
  const life = {
    type: "life" as const,
    born: {},
    tenure: { days: 30, choices: [30], projects: [] },
    lift: { left: 1, total: 2, newBuild: false, sticker: null },
  };
  await act(async () => root.render(<Probe api={api} feed={input({ life })} />));
  await act(async () =>
    root.render(<Probe api={api} feed={input({ life: { ...life, lift: { ...life.lift } } })} />),
  );
  expect(calls.filter((call) => call.startsWith("setTenure:"))).toHaveLength(1);
  expect(calls.filter((call) => call.startsWith("setLiftService:"))).toHaveLength(1);
});

test("the active floor explains a failed street kit", async () => {
  const { api } = fakeScene();
  await act(async () => root.render(<Probe api={api} feed={input({ streetNote: true })} />));
  expect(note).toContain("The street's cars could not be loaded.");
});

const LIFE = {
  type: "life" as const,
  born: {},
  tenure: { days: 30, choices: [30], projects: [] },
  lift: { left: 60_000, total: 180_000, newBuild: false, sticker: null },
};

test("the tenure list and the lift's servicing are sent once each, and again to a new scene", async () => {
  const first = fakeScene();
  await act(async () => root.render(<Probe api={first.api} feed={input({ life: LIFE })} />));
  await act(async () => root.render(<Probe api={first.api} feed={input({ life: LIFE })} />));
  const told = (calls: string[]) =>
    calls.filter((call) => call.startsWith("setTenure") || call.startsWith("setLiftService"));
  expect(told(first.calls)).toEqual([
    `setTenure:${JSON.stringify([LIFE.tenure])}`,
    `setLiftService:${JSON.stringify([LIFE.lift])}`,
  ]);

  const second = fakeScene();
  await act(async () => root.render(<Probe api={second.api} feed={input({ life: LIFE })} />));
  expect(told(second.calls)).toHaveLength(2);
});

test("nothing of the staff scenes is sent before the server has said", async () => {
  const { api, calls } = fakeScene();
  await act(async () => root.render(<Probe api={api} feed={input()} />));
  expect(calls.filter((call) => /^set(Tenure|LiftService)/.test(call))).toEqual([]);
});

test("a person carries their team's repository's first day once the server has read it", async () => {
  const { api, calls } = fakeScene();
  const model = crowd(1);
  const life = { ...LIFE, born: { "shop-api": "2020-02-03" } };
  await act(async () => root.render(<Probe api={api} feed={input({ model, life })} />));
  const sessions = calls.find((call) => call.startsWith("setSessions:")) ?? "";
  expect(sessions).toContain('"git":{"repo":"shop-api","born":"2020-02-03"}');
});

test("the active lift servicing ends when the host supplies its completed snapshot", async () => {
  const { api, calls } = fakeScene();
  await act(async () => root.render(<Probe api={api} feed={input({ life: LIFE })} />));
  const done = { ...LIFE.lift, left: 0 };
  await act(async () =>
    root.render(<Probe api={api} feed={input({ life: { ...LIFE, lift: done } })} />),
  );
  expect(calls.filter((call) => call.startsWith("setLiftService:"))).toEqual([
    "setLiftService:" + JSON.stringify([LIFE.lift]),
    "setLiftService:" + JSON.stringify([done]),
  ]);
});
