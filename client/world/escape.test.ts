// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import {
  leaveFullscreenAfter,
  lockEscape,
  pageUsesEscape,
  sceneUsesEscape,
  unlockEscape,
} from "./escape.js";

afterEach(() => {
  document.body.className = "";
  document.body.replaceChildren();
  vi.useRealTimers();
});

test("the scene uses Escape while seated at an activity, walking or in photo mode", () => {
  expect(sceneUsesEscape(document)).toBe(false);
  for (const mark of ["is-gaming", "is-fp", "is-photo"]) {
    document.body.className = mark;
    expect(sceneUsesEscape(document)).toBe(true);
  }
});

test("the scene uses Escape while its place card or the tour's card is open", () => {
  const card = document.createElement("div");
  card.id = "plc";
  card.hidden = true;
  document.body.append(card);
  expect(sceneUsesEscape(document)).toBe(false);
  card.hidden = false;
  expect(sceneUsesEscape(document)).toBe(true);
  card.remove();
  const tour = document.createElement("div");
  tour.className = "tour";
  document.body.append(tour);
  expect(sceneUsesEscape(document)).toBe(true);
});

test("Paseo's page uses Escape while a dialog of it is open", () => {
  expect(pageUsesEscape(document)).toBe(false);
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", "");
  document.body.append(dialog);
  expect(pageUsesEscape(document)).toBe(true);
});

/** A page that is fullscreen, and how often it was asked to leave. */
function fullscreenPage(element: Element | null) {
  const exitFullscreen = vi.fn(async () => {});
  const page = { fullscreenElement: element, exitFullscreen } as unknown as Document;
  return { page, exitFullscreen };
}

const escape = () => new KeyboardEvent("keydown", { key: "Escape", cancelable: true });

test("an Escape nothing used leaves fullscreen", () => {
  vi.useFakeTimers();
  const { page, exitFullscreen } = fullscreenPage(document.body);
  leaveFullscreenAfter(escape(), false, page);
  vi.runAllTimers();
  expect(exitFullscreen).toHaveBeenCalledTimes(1);
});

test("an Escape that was used stays in fullscreen", () => {
  vi.useFakeTimers();
  const { page, exitFullscreen } = fullscreenPage(document.body);
  // used at the press: seated at the karaoke
  leaveFullscreenAfter(escape(), true, page);
  // taken by a handler after the press was read
  const taken = escape();
  leaveFullscreenAfter(taken, false, page);
  taken.preventDefault();
  // another key
  leaveFullscreenAfter(new KeyboardEvent("keydown", { key: "e" }), false, page);
  vi.runAllTimers();
  expect(exitFullscreen).not.toHaveBeenCalled();
});

test("outside fullscreen an Escape asks for nothing", () => {
  vi.useFakeTimers();
  const { page, exitFullscreen } = fullscreenPage(null);
  leaveFullscreenAfter(escape(), false, page);
  vi.runAllTimers();
  expect(exitFullscreen).not.toHaveBeenCalled();
});

test("Escape is held where the browser can lock it, and nothing breaks where it cannot", async () => {
  const lock = vi.fn(async () => {});
  const unlock = vi.fn();
  const able = { keyboard: { lock, unlock } } as unknown as Navigator;
  lockEscape(able);
  expect(lock).toHaveBeenCalledWith(["Escape"]);
  unlockEscape(able);
  expect(unlock).toHaveBeenCalledTimes(1);

  const refusing = {
    keyboard: { lock: vi.fn(async () => Promise.reject(new Error("not fullscreen"))) },
  } as unknown as Navigator;
  lockEscape(refusing);
  await Promise.resolve();

  const unable = {} as Navigator;
  expect(() => {
    lockEscape(unable);
    unlockEscape(unable);
  }).not.toThrow();
});
