// @vitest-environment jsdom
// The stand-in of ui/settings.js: what 'auto', 'day' and 'night' mean in Paseo's scene. Auto is the app's
// theme; day and night are held against it, for a photo or a clip.
import { beforeEach, expect, test, vi } from "vitest";
// @ts-expect-error vendored JavaScript has no declarations
import { state } from "../../vendor/my-office/src/office/core/state.js";

const h = vi.hoisted(() => ({
  host: { night: false },
  applyNight: vi.fn(),
  holdNight: vi.fn(),
  /** Whether the scene is lit by night now (world/room-update.js `night`). */
  night: false,
}));

vi.mock("../../vendor/my-office/src/office/paseo-host.js", () => ({ host: h.host }));
vi.mock("../../vendor/my-office/src/office/world/room-update.js", () => ({
  get night() {
    return h.night;
  },
}));
vi.mock("../../vendor/my-office/src/office/world/backdrops/index.js", () => ({
  applyNight: h.applyNight,
  holdNight: h.holdNight,
}));

import {
  setTimeMode,
  syncTimeBtns,
  syncToggles,
  // @ts-expect-error vendored JavaScript has no declarations
} from "../../vendor/my-office/src/office/ui/settings.js";

beforeEach(() => {
  h.applyNight.mockReset();
  h.holdNight.mockReset();
  h.host.night = false;
});

test("day and night are held against the theme", () => {
  h.host.night = true;
  setTimeMode("day");
  expect(h.holdNight).toHaveBeenLastCalledWith(false);
  setTimeMode("night");
  expect(h.holdNight).toHaveBeenLastCalledWith(true);
  expect(h.applyNight).not.toHaveBeenCalled();
});

test("auto goes back to the app's theme, dark or light", () => {
  h.host.night = true;
  setTimeMode("auto");
  expect(h.applyNight).toHaveBeenLastCalledWith(true);
  h.host.night = false;
  setTimeMode("auto");
  expect(h.applyNight).toHaveBeenLastCalledWith(false);
  expect(h.holdNight).not.toHaveBeenCalled();
});

test("a mode it does not know is the theme", () => {
  h.host.night = true;
  setTimeMode("noon");
  expect(h.applyNight).toHaveBeenLastCalledWith(true);
});

test("photo mode's buttons show the light the scene is in, and Auto again once the theme lets go", () => {
  document.body.innerHTML =
    '<button data-ph-time="auto"></button><button data-ph-time="day"></button><button data-ph-time="night"></button>';
  const pressed = () =>
    [...document.querySelectorAll<HTMLElement>("[data-ph-time]")]
      .filter((b) => b.getAttribute("aria-pressed") === "true")
      .map((b) => b.dataset.phTime);

  state.nightManual = true;
  h.night = true;
  syncTimeBtns();
  expect(pressed()).toEqual(["night"]);
  h.night = false;
  syncTimeBtns();
  expect(pressed()).toEqual(["day"]);
  state.nightManual = false; // (the theme's applyNight)
  syncTimeBtns();
  expect(pressed()).toEqual(["auto"]);
});

test("without the photo bar the calls other modules make do nothing", () => {
  document.body.innerHTML = "";
  expect(() => {
    syncTimeBtns();
    syncToggles();
  }).not.toThrow();
});
