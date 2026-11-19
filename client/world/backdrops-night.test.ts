// @vitest-environment jsdom
// The backdrop stand-in's two ways to light the scene: the theme's (applyNight) and a held one (holdNight).
import { beforeEach, expect, test, vi } from "vitest";
// @ts-expect-error vendored JavaScript has no declarations
import { state } from "../../vendor/my-office/src/office/core/state.js";

const h = vi.hoisted(() => ({
  host: { street: false, night: false, surface: "#F4EFE6" },
  setNight: vi.fn(),
  buildCity: vi.fn(() => ({ night: vi.fn(), street: {} })),
  scene: { add: vi.fn(), background: null as unknown, fog: { color: { copy: () => undefined } } },
}));

vi.mock("../../vendor/my-office/src/office/paseo-host.js", () => ({ host: h.host }));
vi.mock("../../vendor/my-office/src/office/scene/renderer.js", () => ({ scene: h.scene }));
vi.mock("../../vendor/my-office/src/office/world/windows.js", () => ({
  cityDay: {},
  cityNight: {},
}));
vi.mock("../../vendor/my-office/src/office/world/room-update.js", () => ({
  night: false,
  setNight: h.setNight,
}));

vi.mock("../../vendor/my-office/src/office/world/backdrops/city.js", () => ({
  buildCity: h.buildCity,
}));
vi.mock("../../vendor/my-office/src/office/interact/first-person.js", () => ({
  fp: {},
  buildGrid: vi.fn(),
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
  h.host.street = false;
  h.buildCity.mockClear();
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

test("builds the city only when the street is enabled", () => {
  expect(h.buildCity).not.toHaveBeenCalled();
  h.host.street = true;
  setup();
  expect(h.buildCity).toHaveBeenCalledTimes(1);
  expect(state.nightManual).toBe(false);
  holdNight(true);
  expect(state.nightManual).toBe(true);
  applyNight(false);
  expect(state.nightManual).toBe(false);
  expect(h.setNight).toHaveBeenLastCalledWith(false);
});
