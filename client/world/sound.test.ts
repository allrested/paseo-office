// @vitest-environment jsdom
// The page's Sound state (paseo-sound.js) and the probe that finds out whether the frame lets audio start.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Mode = "runs" | "hangs" | "rejects" | "throws";
const made = { contexts: 0, closed: 0 };

function install(mode: Mode, name: "AudioContext" | "webkitAudioContext" = "AudioContext") {
  class Fake {
    state = "suspended";
    constructor() {
      if (mode === "throws") throw new Error("no audio");
      made.contexts += 1;
    }
    resume() {
      if (mode === "hangs") return new Promise(() => undefined);
      if (mode === "rejects") return Promise.reject(new Error("not allowed"));
      this.state = "running";
      return Promise.resolve();
    }
    close() {
      made.closed += 1;
      return Promise.resolve();
    }
  }
  Object.assign(window, { [name]: Fake });
}

async function fresh() {
  vi.resetModules();
  // @ts-expect-error vendored JavaScript has no declarations
  return await import("../../vendor/my-office/src/office/paseo-sound.js");
}
const settle = () => vi.advanceTimersByTimeAsync(0);
let stop: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  made.contexts = 0;
  made.closed = 0;
});
afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  delete (window as unknown as Record<string, unknown>).AudioContext;
  delete (window as unknown as Record<string, unknown>).webkitAudioContext;
});

test("a page with no Web Audio is unsupported at once, and the switch stays off", async () => {
  const m = await fresh();
  stop = m.watchAudio(window);
  expect(m.sound.audio).toBe("unsupported");
  m.setOn(true);
  expect(m.sound.on).toBe(false);
  expect(m.available()).toBe(false);
});

test("the prefixed constructor counts as Web Audio", async () => {
  install("runs", "webkitAudioContext");
  const m = await fresh();
  stop = m.watchAudio(window);
  expect(m.sound.audio).toBe("idle");
});

test("nothing is made until a press; the first press tries one context, finds it running and closes it", async () => {
  install("runs");
  const m = await fresh();
  stop = m.watchAudio(window);
  expect(made.contexts).toBe(0);
  window.dispatchEvent(new Event("pointerup"));
  await settle();
  expect(m.sound.audio).toBe("ready");
  expect(made).toEqual({ contexts: 1, closed: 1 });
  window.dispatchEvent(new Event("pointerup"));
  window.dispatchEvent(new Event("keydown"));
  await settle();
  expect(made.contexts).toBe(1);
});

test("a key press starts the probe too", async () => {
  install("runs");
  const m = await fresh();
  stop = m.watchAudio(window);
  window.dispatchEvent(new Event("keydown"));
  await settle();
  expect(m.sound.audio).toBe("ready");
});

test("a context that does not run within the time is blocked, and the switch goes off", async () => {
  install("hangs");
  const m = await fresh();
  stop = m.watchAudio(window, 1500);
  m.setOn(true);
  const told = vi.fn();
  m.sound.subscribe(told);
  window.dispatchEvent(new Event("pointerup"));
  await vi.advanceTimersByTimeAsync(1499);
  expect(m.sound.audio).toBe("idle");
  await vi.advanceTimersByTimeAsync(2);
  expect(m.sound.audio).toBe("blocked");
  expect(m.sound.on).toBe(false);
  expect(told).toHaveBeenCalled();
  m.setOn(true);
  expect(m.sound.on).toBe(false);
});

test("a resume that rejects, and a constructor that throws, are blocked", async () => {
  install("rejects");
  let m = await fresh();
  stop = m.watchAudio(window);
  window.dispatchEvent(new Event("pointerup"));
  await settle();
  expect(m.sound.audio).toBe("blocked");
  stop?.();
  install("throws");
  m = await fresh();
  stop = m.watchAudio(window);
  window.dispatchEvent(new Event("pointerup"));
  await settle();
  expect(m.sound.audio).toBe("blocked");
});

test("setOn tells subscribers only when the switch changes, and an unsubscribed listener hears nothing", async () => {
  install("runs");
  const m = await fresh();
  const told = vi.fn();
  const off = m.sound.subscribe(told);
  m.setOn(true);
  m.setOn(true);
  expect(told).toHaveBeenCalledTimes(1);
  off();
  m.setOn(false);
  expect(told).toHaveBeenCalledTimes(1);
  m.setOn("yes"); // only `true` turns it on
  expect(m.sound.on).toBe(false);
});
