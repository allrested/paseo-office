// Upstream's rain and light (life/weather.js) with Paseo's changes, driven by setWeather.
import { readFileSync } from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";

const WEATHER = "../../vendor/my-office/src/office/life/weather.js";

const h = vi.hoisted(() => ({
  night: false,
  reduce: false,
  sim: 0,
  plays: [] as string[],
  added: [] as { geometry: { drawRange: { count: number } }; visible: boolean }[],
  scene: {
    fog: { near: 40, far: 96 } as Record<string, unknown>,
    add: (_object: never): void => undefined,
  },
  lights: { hemi: { intensity: 0.25 }, sun: { intensity: 1.35 } },
  kit: { visible: false },
}));

vi.mock("../../vendor/my-office/src/office/core/env.js", () => ({
  rand: (from: number) => from,
  get reduceMotion() {
    return h.reduce;
  },
}));
vi.mock("../../vendor/my-office/src/office/core/state.js", () => ({
  state: {
    get sim() {
      return h.sim;
    },
  },
}));
vi.mock("../../vendor/my-office/src/office/scene/renderer.js", () => ({ scene: h.scene }));
vi.mock("../../vendor/my-office/src/office/scene/lights.js", () => h.lights);
vi.mock("../../vendor/my-office/src/office/world/layout.js", () => ({
  LAY: { box: { x0: -8, x1: 14, z0: -8, z1: 8 } },
}));
vi.mock("../../vendor/my-office/src/office/life/rain.js", () => ({ rainKit: h.kit }));
vi.mock("../../vendor/my-office/src/office/world/room-update.js", () => ({
  get night() {
    return h.night;
  },
}));
vi.mock("../../vendor/my-office/src/office/audio/sfx.js", () => ({
  sfx: { play: (name: string) => h.plays.push(name) },
}));

const RAIN = { code: 63, temp: 14.2, cloud: 0.9 };

async function load() {
  vi.resetModules();
  // @ts-expect-error vendored JavaScript has no declarations
  return (await import("../../vendor/my-office/src/office/life/weather.js")) as {
    setWeather(reading: object | null): void;
    applyWeather(): void;
    updateWeather(dt: number): void;
    wx: Record<string, unknown>;
  };
}

beforeEach(() => {
  h.night = false;
  h.reduce = false;
  h.sim = 0;
  h.plays.length = 0;
  h.added.length = 0;
  h.scene.fog = { near: 40, far: 96 };
  h.scene.add = (object: never) => void h.added.push(object);
  h.lights.sun.intensity = 1.35;
  h.lights.hemi.intensity = 0.25;
  h.kit.visible = false;
  vi.useRealTimers();
});
test("the file asks nobody and reads no page", () => {
  const source = readFileSync(new URL(WEATHER, import.meta.url), "utf8");
  expect(source).not.toMatch(/\bfetch\s*\(/);
  for (const word of ["localStorage", "document", "XMLHttpRequest", "WebSocket"]) {
    expect(source).not.toContain(word);
  }
  expect(source).toContain("// PASEO:");
});

test("rain falls outside the office, darkens daylight and follows a change of theme", async () => {
  const w = await load();
  w.setWeather(RAIN);
  w.setWeather(RAIN);
  w.updateWeather(0.016);
  expect(h.added).toHaveLength(1);
  expect(h.added[0]?.geometry.drawRange.count).toBe(4248);
  expect(h.kit.visible).toBe(true);
  expect(h.scene.fog.base).toEqual([30, 78]);
  expect(h.lights.sun.intensity).toBeCloseTo(0.6858);
  h.night = true;
  w.applyWeather();
  expect(h.lights.sun.intensity).toBeCloseTo(0.2794);
  w.setWeather(null);
  expect(h.kit.visible).toBe(false);
  expect(h.added[0]?.visible).toBe(false);
  expect(h.scene.fog.base).toEqual([40, 96]);
});
test("fog closes in, and a storm flashes and sounds thunder unless motion is reduced", async () => {
  vi.useFakeTimers();
  const w = await load();
  w.setWeather({ code: 45, temp: 12, cloud: 0.9 });
  expect(h.scene.fog.base).toEqual([14, 52]);
  w.setWeather({ code: 95, temp: 12, cloud: 1 });
  h.reduce = true;
  w.updateWeather(0.016);
  expect(w.wx.flashAt).toBe(0);
  h.reduce = false;
  w.updateWeather(0.016);
  h.sim = 7;
  w.updateWeather(0.016);
  expect(h.lights.hemi.intensity).toBeCloseTo(3.45);
  vi.advanceTimersByTime(400);
  expect(h.plays).toEqual(["thunder"]);
  vi.useRealTimers();
});
