/**
 * @vitest-environment jsdom
 */
// The plan poll's pace, mounted: readings kept for it do not outlive the office being closed.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PlanUsage } from "../shared/plan-usage.js";
import { usePlanUsage, type PlanState } from "./use-plan-usage.js";

const HOUR = 3_600_000;
let usedPct: number;
let resetsAt: number;

vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: () => async () => ({
    ok: true,
    providers: [
      {
        provider: "claude",
        name: "Claude",
        plan: null,
        windows: [{ id: "five", label: "5 hours", usedPct, resetsAt }],
      },
    ] satisfies PlanUsage[],
  }),
  useSettings: () => ({ status: "loading" }),
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

let state: PlanState;
function Probe({ live }: { live: boolean }) {
  state = usePlanUsage(live);
  return null;
}

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 26, 9, 0));
  resetsAt = Date.now() + 10 * HOUR;
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

const render = (live: boolean) => act(async () => root.render(<Probe live={live} />));
const minutes = (n: number) =>
  act(async () => void (await vi.advanceTimersByTimeAsync(n * 60_000)));

test("the pace comes from two readings 5 minutes apart, and is forgotten when the office closes", async () => {
  usedPct = 20;
  await render(true);
  expect(state.outAt).toBeNull();
  usedPct = 30;
  await minutes(6);
  expect(state.outAt).toMatchObject({ provider: "Claude", window: "5 hours" });

  await render(false);
  expect(state.outAt).toBeNull();

  // Open again: the first reading is not a pair with one from before the office was closed.
  usedPct = 40;
  await minutes(60);
  await render(true);
  expect(state.outAt).toBeNull();
  usedPct = 50;
  await minutes(6);
  expect(state.outAt).not.toBeNull();
});
