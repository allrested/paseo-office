/**
 * @vitest-environment jsdom
 */
// What the staff scenes are fed and how they speak, mounted: the subscription and the two calls are
// stand-ins that record what they are given.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { LifeEvent } from "../../shared/contracts.js";
import { useLife, type LifeState } from "./use-life.js";

const h = vi.hoisted(() => ({
  status: "live" as string,
  onEvent: null as ((event: unknown) => void) | null,
  calls: [] as [string, unknown][],
}));

vi.mock("@getpaseo/plugin/client", () => ({
  useSubscription: (_contract: unknown, _input: unknown, onEvent: (event: unknown) => void) => {
    h.onEvent = onEvent;
    return { status: h.status };
  },
  useRpc: (contract: { name: string }) => async (input: unknown) => {
    h.calls.push([contract.name, input]);
    return { ok: true };
  },
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const EVENT: LifeEvent = {
  type: "life",
  born: { api: "2020-02-03" },
  tenure: { days: 30, choices: [30], projects: [] },
  lift: { left: 1000, total: 180_000, newBuild: false, sticker: null },
};

let container: HTMLElement;
let root: Root;
let state: LifeState | null = null;

function Probe() {
  state = useLife();
  return null;
}

beforeEach(() => {
  h.status = "live";
  h.onEvent = null;
  h.calls = [];
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

test("an event is what the scenes read, until the subscription fails", async () => {
  await act(async () => root.render(<Probe />));
  expect(state?.life).toBeNull();
  await act(async () => h.onEvent?.(EVENT));
  expect(state?.life).toEqual(EVENT);
  h.status = "error";
  await act(async () => root.render(<Probe />));
  expect(state?.life).toBeNull();
});

test("a chat line and a tenure write go to their calls", async () => {
  await act(async () => root.render(<Probe />));
  await act(async () => {
    state?.say("parcel", { id: "a1" });
    state?.tell({ op: "official", name: "web" });
  });
  expect(h.calls).toEqual([
    ["office.chat.request", { op: "life", kind: "parcel", vars: { id: "a1" } }],
    ["office.tenure.request", { op: "official", name: "web" }],
  ]);
});
