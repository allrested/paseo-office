// @vitest-environment jsdom
// Upstream's sound engine (audio/sfx.js) as the port takes it: every sound but one shop's tune, off
// until the switch is on, and a context made on the first press. Web Audio is a stand-in that counts
// what starts.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { leftIn } from "../../scripts/genericise-street.mjs";

vi.mock("../../vendor/my-office/src/office/core/env.js", () => ({
  reduceMotion: false,
  replay: { on: false },
}));

const made = vi.hoisted(() => ({
  contexts: [] as { state: string; currentTime: number }[],
  started: 0,
}));

class FakeNode {
  frequency = { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 };
  gain = { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 };
  type = "";
  buffer: unknown = null;
  connect(next: unknown) {
    return next;
  }
  start() {
    made.started += 1;
  }
  stop() {}
}

class FakeContext {
  state = "suspended";
  currentTime = 0;
  sampleRate = 48_000;
  destination = {};
  constructor() {
    made.contexts.push(this);
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  createOscillator = () => new FakeNode();
  createGain = () => new FakeNode();
  createBiquadFilter = () => new FakeNode();
  createBufferSource = () => new FakeNode();
  createBuffer = () => ({ getChannelData: () => new Float32Array(8) });
}

/** A file of the vendored scene, by its path under src/office/. */
const vendored = (file: string) =>
  path.resolve(import.meta.dirname, "../../vendor/my-office/src/office", file);

/** The listeners a test's setup() put on the window, taken off after it. */
const added: [string, EventListenerOrEventListenerObject][] = [];

beforeEach(() => {
  made.contexts.length = 0;
  made.started = 0;
  added.length = 0;
  localStorage.clear();
  Object.assign(window, { AudioContext: FakeContext });
  const real = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
    added.push([type, listener]);
    real(type, listener, options);
  });
});
afterEach(() => {
  for (const [type, listener] of added) window.removeEventListener(type, listener);
  vi.restoreAllMocks();
  delete (window as { AudioContext?: unknown }).AudioContext;
});

async function load() {
  vi.resetModules();
  // @ts-expect-error vendored JavaScript has no declarations
  const mod = await import("../../vendor/my-office/src/office/audio/sfx.js");
  mod.setup();
  return mod.sfx as {
    on: boolean;
    set(on: boolean): void;
    play(name: string): void;
  };
}

/** A press on the page: upstream's engine makes its context and resumes it. */
function press() {
  window.dispatchEvent(new Event("pointerdown"));
}

/** Plays a name with the clock moved past every gap, so only the name decides. */
function play(sfx: { play(name: string): void }, name: string): number {
  const before = made.started;
  const context = made.contexts[made.contexts.length - 1];
  if (context) context.currentTime += 100;
  sfx.play(name);
  return made.started - before;
}

const SOUNDS = [
  "perm",
  "turn",
  "key",
  "print",
  "ding",
  "deploy",
  "alarm",
  "siren",
  "meow",
  "pop",
  "chat",
  "bloop",
  "brew",
  "rustle",
  "click",
  "pock",
  "shutter",
  "coin",
  "beep",
  "micro",
  "buzz",
  "thunder",
  "bell",
  "water",
  "clap",
  "thud",
];

test("each of upstream's sounds but the one tune makes a sound", async () => {
  const sfx = await load();
  press();
  sfx.set(true);
  for (const name of SOUNDS) expect(play(sfx, name), name).toBeGreaterThan(0);
});

test("the file's sounds and gaps are upstream's less the one tune, and no real name is left in it", () => {
  const text = readFileSync(vendored("audio/sfx.js"), "utf8");
  const sounds = text.slice(text.indexOf("const SOUNDS = {"), text.indexOf("const GAP = {"));
  const named = [...sounds.matchAll(/^ {6}(\w+): \(t\) =>/gm)].map((m) => m[1]);
  expect([...named].sort()).toEqual([...SOUNDS].sort());
  const gapStart = text.indexOf("const GAP = {");
  const gaps = text.slice(gapStart, text.indexOf("};", gapStart));
  for (const [, name] of gaps.matchAll(/(\w+): [\d.]+/g)) expect(SOUNDS, name).toContain(name);
  expect(leftIn(text)).toEqual([]);
  expect(text).toMatch(/\/\/ PASEO: upstream's tune for one shop is not taken/);
});

test("nothing plays while the switch is off, and nothing before a press", async () => {
  const sfx = await load();
  // Upstream starts on, but until a press there is no context to play with.
  expect(sfx.on).toBe(true);
  expect(play(sfx, "click")).toBe(0);
  press();
  expect(play(sfx, "click")).toBeGreaterThan(0);
  sfx.set(false);
  expect(play(sfx, "click")).toBe(0);
  sfx.set(true);
  expect(play(sfx, "click")).toBeGreaterThan(0);
});

test("on is the real switch, which karaoke reads, and set(true) is stored under office-sound", async () => {
  const sfx = await load();
  sfx.set(false);
  expect(sfx.on).toBe(false);
  expect(localStorage.getItem("office-sound")).toBe("off");
  sfx.set(true);
  expect(sfx.on).toBe(true);
  expect(localStorage.getItem("office-sound")).toBe("on");
});

test("the karaoke scene has no change by hand and follows the switch in the three places it reads it", () => {
  const karaoke = readFileSync(vendored("people/karaoke.js"), "utf8");
  // (the names script's first line, if it ever changes the file, is not a change by hand)
  expect(karaoke).not.toMatch(/PASEO:(?! names of real shops)/);
  expect(karaoke).toContain("!sfx.on || replay.on) return;");
  expect(karaoke).toContain("mix.out.gain.value = sfx.on && !replay.on ? loud() : 0;");
  expect(karaoke).toContain("if (sfx.on) unlock();");
});

test("the entry does not set the engine up by hand: the module list does, once", () => {
  const entry = readFileSync(vendored("paseo-entry.js"), "utf8");
  const modules = readFileSync(vendored("paseo-modules.js"), "utf8");
  expect(entry).not.toMatch(/audioSfx\.setup/);
  expect(modules.match(/\['audioSfx', audioSfx\]/g)).toHaveLength(1);
});
