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

test("the probe remembers what the switch was when a press reached it, for that press alone", async () => {
  install("runs");
  const m = await fresh();
  stop = m.watchAudio(window);
  // Blocked first, with sound asked for: nothing plays, and a press could not start audio as far as is known.
  m.setOn(true);
  install("hangs");
  window.dispatchEvent(new Event("pointerup"));
  await vi.advanceTimersByTimeAsync(1600);
  expect(m.sound.audio).toBe("blocked");
  install("runs");
  const press = new Event("keydown");
  window.dispatchEvent(press);
  await settle();
  // The press's own probe turned sound on; what the press met is still known.
  expect(m.sound.on).toBe(true);
  expect(m.before(press)).toMatchObject({ on: false, can: false });
  expect(m.before(new Event("keydown"))).toBeNull();
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

const key = (name: string) => Object.assign(new Event("keydown"), { key: name });

test("an Escape or a bare modifier key is not an activation: the state stays idle and a later press probes", async () => {
  install("runs");
  const m = await fresh();
  stop = m.watchAudio(window);
  window.dispatchEvent(key("Escape"));
  window.dispatchEvent(key("Shift"));
  await settle();
  expect(m.sound.audio).toBe("idle");
  expect(made.contexts).toBe(0);
  window.dispatchEvent(new Event("pointerup"));
  await settle();
  expect(m.sound.audio).toBe("ready");
});

test("an event while the frame has no active user activation does not probe", async () => {
  install("runs");
  const m = await fresh();
  const activation = { isActive: false };
  Object.defineProperty(navigator, "userActivation", { configurable: true, value: activation });
  try {
    stop = m.watchAudio(window);
    window.dispatchEvent(new Event("pointerup"));
    await settle();
    expect(m.sound.audio).toBe("idle");
    expect(made.contexts).toBe(0);
    activation.isActive = true;
    window.dispatchEvent(new Event("pointerup"));
    await settle();
    expect(m.sound.audio).toBe("ready");
  } finally {
    delete (navigator as unknown as Record<string, unknown>).userActivation;
  }
});

test("blocked is not final: a later press whose context runs makes it ready and lets the switch on", async () => {
  install("hangs");
  const m = await fresh();
  stop = m.watchAudio(window, 1500);
  window.dispatchEvent(new Event("pointerup"));
  await vi.advanceTimersByTimeAsync(1600);
  expect(m.sound.audio).toBe("blocked");
  m.setOn(true);
  expect(m.sound.on).toBe(false);
  install("runs");
  window.dispatchEvent(new Event("pointerup"));
  await settle();
  expect(m.sound.audio).toBe("ready");
  m.setOn(true);
  expect(m.sound.on).toBe(true);
});

test("a press while a probe is in flight does not start a second one", async () => {
  install("hangs");
  const m = await fresh();
  stop = m.watchAudio(window, 1500);
  window.dispatchEvent(new Event("pointerup"));
  window.dispatchEvent(new Event("pointerup"));
  expect(made.contexts).toBe(1);
  await vi.advanceTimersByTimeAsync(1600);
  expect(m.sound.audio).toBe("blocked");
});

test("unsupported is not retried", async () => {
  const m = await fresh();
  stop = m.watchAudio(window);
  install("runs");
  window.dispatchEvent(new Event("pointerup"));
  await settle();
  expect(m.sound.audio).toBe("unsupported");
  expect(made.contexts).toBe(0);
});

test("stop() during a probe in flight leaves the state and the listeners alone when it later fires", async () => {
  install("hangs");
  const m = await fresh();
  const stopWatching = m.watchAudio(window, 1500);
  const told = vi.fn();
  m.sound.subscribe(told);
  window.dispatchEvent(new Event("pointerup"));
  stopWatching();
  await vi.advanceTimersByTimeAsync(3000);
  expect(m.sound.audio).toBe("idle");
  expect(told).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("pointerup"));
  expect(made.contexts).toBe(1);
});

test("the host's on is kept through a block: once a later press makes audio ready, sound comes on by itself", async () => {
  install("hangs");
  const m = await fresh();
  stop = m.watchAudio(window, 1500);
  m.sound.request = vi.fn();
  m.setOn(true);
  window.dispatchEvent(new Event("pointerup"));
  await vi.advanceTimersByTimeAsync(1600);
  expect(m.sound.audio).toBe("blocked");
  expect(m.sound.on).toBe(false);
  install("runs");
  window.dispatchEvent(new Event("pointerup"));
  await settle();
  expect(m.sound.audio).toBe("ready");
  expect(m.sound.on).toBe(true);
  // The probe asks the host for nothing: the stored setting is the host's.
  expect(m.sound.request).not.toHaveBeenCalled();
});

test("the host's off is kept too: audio becoming ready does not turn sound on", async () => {
  install("hangs");
  const m = await fresh();
  stop = m.watchAudio(window, 1500);
  window.dispatchEvent(new Event("pointerup"));
  await vi.advanceTimersByTimeAsync(1600);
  install("runs");
  window.dispatchEvent(new Event("pointerup"));
  await settle();
  expect(m.sound.audio).toBe("ready");
  expect(m.sound.on).toBe(false);
});

test("whenProbed waits for the probe in flight, and runs at once when none is", async () => {
  install("hangs");
  const m = await fresh();
  stop = m.watchAudio(window, 1500);
  const heard: string[] = [];
  m.whenProbed(() => heard.push(`idle:${m.sound.audio}`));
  window.dispatchEvent(new Event("pointerup"));
  m.whenProbed(() => heard.push(`after:${m.sound.audio}`));
  expect(heard).toEqual(["idle:idle"]);
  await vi.advanceTimersByTimeAsync(1600);
  expect(heard).toEqual(["idle:idle", "after:blocked"]);
});

test("stop() drops what waits on the probe in flight", async () => {
  install("hangs");
  const m = await fresh();
  const stopWatching = m.watchAudio(window, 1500);
  const waiter = vi.fn();
  window.dispatchEvent(new Event("pointerup"));
  m.whenProbed(waiter);
  stopWatching();
  await vi.advanceTimersByTimeAsync(3000);
  expect(waiter).not.toHaveBeenCalled();
  m.whenProbed(waiter);
  expect(waiter).toHaveBeenCalledTimes(1);
});
