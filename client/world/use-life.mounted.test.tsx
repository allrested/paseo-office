/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { LifeEvent } from "../../shared/contracts.js";
import { useLife, type LifeState } from "./use-life.js";
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let deliver: (e: LifeEvent) => void;
let status = "live";
const write = vi.fn(async () => ({ ok: true }));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: () => write,
  useSubscription: (_contract: unknown, _input: unknown, receive: typeof deliver) => {
    deliver = receive;
    return { status };
  },
}));
test("receives life, sends a tenure decision and clears unavailable data", async () => {
  const root = createRoot(document.createElement("div"));
  let state!: LifeState;
  function Probe() {
    state = useLife();
    return null;
  }
  const event: LifeEvent = {
    type: "life",
    tenure: { choices: [30], days: 30, projects: [] },
    lift: { left: 0, total: 1, newBuild: false, sticker: null },
    born: {},
  };
  try {
    await act(async () => root.render(<Probe />));
    await act(async () => deliver(event));
    expect(state.life).toEqual(event);
    state.tell({ op: "official", name: "api" });
    expect(write).toHaveBeenCalledWith({ op: "official", name: "api" });
    status = "error";
    await act(async () => root.render(<Probe />));
    expect(state.life).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
