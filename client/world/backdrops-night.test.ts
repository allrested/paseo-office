// @vitest-environment jsdom
// The backdrop stand-in's two ways to light the scene: the theme's (applyNight) and a held one (holdNight).
import { beforeEach, expect, test, vi } from "vitest";
// @ts-expect-error vendored JavaScript has no declarations
import { state } from "../../vendor/my-office/src/office/core/state.js";

const h = vi.hoisted(() => ({
  host: { night: false, surface: "#F4EFE6" },
  setNight: vi.fn(),
  scene: { background: null as unknown, fog: { color: { copy: () => undefined } } },
}));

vi.mock("../../vendor/my-office/src/office/paseo-host.js", () => ({ host: h.host }));
vi.mock("../../vendor/my-office/src/office/scene/renderer.js", () => ({ scene: h.scene }));
vi.mock("../../vendor/my-office/src/office/world/windows.js", () => ({
  cityDay: {},
  cityNight: {},
}));
vi.mock("../../vendor/my-office/src/office/world/room-update.js", () => ({
  setNight: h.setNight,
}));

import {
  applyNight,
  holdNight,
  setup,
  // @ts-expect-error vendored JavaScript has no declarations
} from "../../vendor/my-office/src/office/world/backdrops/index.js";

beforeEach(() => {
  h.setNight.mockReset();
  h.host.night = false;
  setup();
  h.setNight.mockReset();
});

test("the theme's night is not a held one", () => {
  state.nightManual = true;
  applyNight(true);
  expect(h.setNight).toHaveBeenLastCalledWith(true);
  expect(state.nightManual).toBe(false);
});

test("a held day or night says so, and the theme's next change lets go", () => {
  holdNight(false);
  expect(h.setNight).toHaveBeenLastCalledWith(false);
  expect(state.nightManual).toBe(true);
  holdNight(true);
  expect(h.setNight).toHaveBeenLastCalledWith(true);
  applyNight(false);
  expect(state.nightManual).toBe(false);
});

test("both keep the backdrop in the app's surface colour", () => {
  holdNight(true);
  const background = h.scene.background as { getHexString(): string };
  expect(background.getHexString()).toBe("f4efe6");
});
