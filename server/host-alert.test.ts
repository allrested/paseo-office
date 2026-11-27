import { expect, test } from "vitest";
import type { Machine } from "../shared/contracts.js";
import { createHostAlert } from "./host-alert.js";

function machine(usedBytes: number | null): Machine {
  return {
    readAt: "2026-11-16T12:00:00.000Z",
    memory: usedBytes === null ? null : { usedBytes, totalBytes: 100 },
    cpuPercent: null,
    agents: [],
  };
}

function setup() {
  const told: number[] = [];
  const alert = createHostAlert((percent) => told.push(percent));
  return { told, observe: (used: number | null) => alert.observe(machine(used)) };
}

test("memory at the Host card's danger threshold is told once for the episode", () => {
  const { told, observe } = setup();
  observe(70);
  observe(89);
  expect(told).toEqual([]);
  observe(90);
  observe(95);
  observe(91);
  expect(told).toEqual([90]);
});

test("the episode ends when memory is back under the warning threshold, not before", () => {
  const { told, observe } = setup();
  observe(95);
  observe(85);
  observe(92);
  expect(told).toEqual([95]);
  observe(79);
  observe(93);
  expect(told).toEqual([95, 93]);
});

test("a reading without memory changes nothing", () => {
  const { told, observe } = setup();
  observe(95);
  observe(null);
  observe(96);
  expect(told).toEqual([95]);
});
