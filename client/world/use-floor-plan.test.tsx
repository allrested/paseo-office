/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { floorPlanOf, useFloorPlan } from "./use-floor-plan.js";

const h = vi.hoisted(() => ({ settings: { status: "loading" } as Record<string, unknown> }));
vi.mock("@getpaseo/plugin/client", () => ({ useSettings: () => h.settings }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

test("a stored plan is the plan", () => {
  expect(floorPlanOf({ status: "ready", values: { floorPlan: "cozy" } }, null)).toBe("cozy");
  expect(floorPlanOf({ status: "ready", values: { floorPlan: "pro" } }, "cozy")).toBe("pro");
});

test("while the settings are read there is no plan, or the last one", () => {
  expect(floorPlanOf({ status: "loading" }, null)).toBeNull();
  expect(floorPlanOf({ status: "loading" }, "cozy")).toBe("cozy");
});

test("settings that cannot be read keep the last plan, else draw the company floor", () => {
  expect(floorPlanOf({ status: "error" }, null)).toBe("pro");
  expect(floorPlanOf({ status: "invalid" }, null)).toBe("pro");
  expect(floorPlanOf({ status: "error" }, "cozy")).toBe("cozy");
  expect(floorPlanOf({ status: "invalid" }, "cozy")).toBe("cozy");
});

let container: HTMLElement;
let root: Root;
let seen: (string | null)[];

function Probe() {
  seen.push(useFloorPlan());
  return null;
}

beforeEach(() => {
  seen = [];
  h.settings = { status: "loading" };
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

test("the hook gives null until the host answers, then the plan, and keeps it through a new read", async () => {
  await act(async () => root.render(<Probe />));
  expect(seen.at(-1)).toBeNull();

  h.settings = { status: "ready", values: { floorPlan: "cozy" } };
  await act(async () => root.render(<Probe />));
  expect(seen.at(-1)).toBe("cozy");

  h.settings = { status: "loading" };
  await act(async () => root.render(<Probe />));
  expect(seen.at(-1)).toBe("cozy");

  h.settings = { status: "ready", values: { floorPlan: "pro" } };
  await act(async () => root.render(<Probe />));
  expect(seen.at(-1)).toBe("pro");
});
