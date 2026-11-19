// @vitest-environment jsdom
// The camera toolbar (ui/camera-bar.js): the bar it builds, its views, the zoom's limit, full screen
// and photo mode's bar. The renderer, the loop and the session drawer are stood in with plain
// objects, as entry.test.ts stands them in: what the bar reads of the world is a camera with a zoom,
// the controls' limits, and a focus target the loop would glide to.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
// @ts-expect-error vendored JavaScript has no declarations
import { state } from "../../vendor/my-office/src/office/core/state.js";

const h = vi.hoisted(() => ({
  /** What the bar did, in order: the chosen person closing before the camera flies, for one. */
  calls: [] as string[],
  closeSession: vi.fn(),
  toast: vi.fn(),
  /** The floor plan the page was started on (paseo-host.js `plan`). */
  plan: "pro" as string,
  /** The host's photo switch (paseo-host.js `photo`): false where the app cannot keep a download. */
  photo: true,
  set: vi.fn(),
  copy: vi.fn(),
  /** What the focus target's clone gives: where a glide goes back to. */
  clone: vi.fn(() => ({ home: true })),
  exitFp: vi.fn(),
  /** The walk's state: a test turns `on` to be walking. */
  fp: { on: false },
}));

vi.mock("../../vendor/my-office/src/office/scene/renderer.js", async () => {
  // A real orthographic camera: fitFloor projects the floor's corners through it.
  // @ts-expect-error vendored JavaScript has no declarations
  const THREE = await import("../../vendor/my-office/three/three.module.min.js");
  const camera = new THREE.OrthographicCamera(-20, 20, 15, -15, 0.1, 200);
  camera.position.set(20, 20, 20);
  camera.zoom = 1;
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return {
    camera,
    controls: {
      target: new THREE.Vector3(0, 0, 0),
      minZoom: 0.5,
      maxZoom: 3.4,
      update() {},
      /** The controls' listeners: `fire("start")` is a drag of the floor beginning. */
      listeners: {} as Record<string, (() => void)[]>,
      addEventListener(type: string, listener: () => void) {
        (this.listeners[type] ??= []).push(listener);
      },
      fire(type: string) {
        for (const listener of this.listeners[type] ?? []) listener();
      },
    },
    fpCam: { fov: 70, updateProjectionMatrix() {} },
  };
});
vi.mock("../../vendor/my-office/src/office/core/loop.js", () => ({
  focusTarget: { set: h.set, copy: h.copy, clone: h.clone },
}));
vi.mock("../../vendor/my-office/src/office/ui/session-drawer.js", () => ({
  closeSession: h.closeSession,
}));
vi.mock("../../vendor/my-office/src/office/paseo-host.js", () => ({
  host: {
    get plan() {
      return h.plan;
    },
    get photo() {
      return h.photo;
    },
    toast: h.toast,
  },
}));
vi.mock("../../vendor/my-office/src/office/interact/first-person.js", () => ({
  floorBounds: () => ({ x0: -7.85, x1: 15.3, z0: -7.85, z1: 11.3 }),
  fp: h.fp,
  exitFp: h.exitFp,
}));

import {
  autoCam,
  build,
  goView,
  panTo,
  setView,
  setup,
  // @ts-expect-error vendored JavaScript has no declarations
} from "../../vendor/my-office/src/office/ui/camera-bar.js";

// @ts-expect-error vendored JavaScript has no declarations
import { setOn, sound, watchAudio } from "../../vendor/my-office/src/office/paseo-sound.js";

const { camera, controls, fpCam } =
  // @ts-expect-error vendored JavaScript has no declarations
  await import("../../vendor/my-office/src/office/scene/renderer.js");

/** The document outlives each test's page: the listeners setup() puts on it are taken off after the test. */
const onDocument = vi.spyOn(document, "addEventListener");

/** The frame's browser: no ResizeObserver, so the bar's observer is this one, and a test can resize. */
let resized: (() => void) | null = null;
class ResizeObserverStub {
  constructor(callback: () => void) {
    resized = callback;
  }
  observe() {}
  disconnect() {}
}

/** An element of the bar the page built. */
function page(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`The bar has no #${id}`);
  return found;
}

function click(selector: string): void {
  const found = document.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`The bar has no ${selector}`);
  found.click();
}

/** The views pressed now, in the order they are in the bar. */
function pressed(): (string | undefined)[] {
  return [...document.querySelectorAll<HTMLElement>(".seg-btn[aria-pressed='true']")].map(
    (b) => b.dataset.view,
  );
}

/** The pointer media query: `change(fine)` is the device's pointer changing. */
function pointer(fine: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: fine,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
  };
  vi.stubGlobal("matchMedia", () => query);
  return {
    change(next: boolean) {
      query.matches = next;
      for (const listener of listeners) listener();
    },
  };
}

/**
 * Builds the bar and wires it, as paseo-entry.js does; `fullscreen` is what the frame's browser offers,
 * `fine` whether its pointer is fine (a mouse). Returns the pointer, to change it.
 */
function open({ fullscreen = true, refuse = false, fine = true } = {}) {
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: fullscreen });
  document.documentElement.requestFullscreen = refuse
    ? vi.fn(() => Promise.reject(new Error("not allowed")))
    : vi.fn(() => Promise.resolve());
  const handle = pointer(fine);
  build();
  setup();
  return handle;
}

// @ts-expect-error vendored JavaScript has no declarations
import { setLanguage } from "../../vendor/my-office/src/i18n/index.js";

beforeEach(() => {
  setLanguage("en");
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  resized = null;
  h.calls.length = 0;
  h.closeSession.mockReset().mockImplementation(() => {
    h.calls.push("close");
  });
  h.set.mockReset().mockImplementation(() => {
    h.calls.push("set");
  });
  h.copy.mockReset();
  h.clone.mockClear();
  h.toast.mockReset();
  h.plan = "pro";
  h.photo = true;
  state.selectedId = null;
  state.zoomGoal = null;
  camera.zoom = 1;
  h.fp.on = false;
  h.exitFp.mockReset();
  fpCam.fov = 70;
  // (each page's setup() adds its own listener; the controls outlive the page)
  (controls as unknown as { listeners: Record<string, unknown[]> }).listeners = {};
  state.camAuto = undefined;
  state.photo = false;
  localStorage.clear();
  document.body.innerHTML = '<div id="stage-wrap"><div id="stage"></div></div>';
  sound.audio = "idle";
  sound.request = () => {};
  setOn(false);
});

/** Spies a test made that must not outlive it. */
const onAfter: { mockRestore(): void }[] = [];
afterEach(() => {
  recorder(false);
  for (const spy of onAfter.splice(0)) spy.mockRestore();
  for (const [type, listener, options] of onDocument.mock.calls) {
    document.removeEventListener(type, listener, options);
  }
  onDocument.mockClear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen;
});

test("the bar has its ten controls with their labels", () => {
  open();

  expect(
    [...document.querySelectorAll(".toolbar button")].map((b) => b.getAttribute("aria-label")),
  ).toEqual([
    "Overview",
    "Desks",
    "Meeting room",
    "Servers",
    "Zoom out",
    "Zoom in",
    "Full screen",
    "Photo mode",
    "Sound",
    "Walk in",
  ]);
  expect(document.querySelector(".toolbar")?.getAttribute("aria-label")).toBe("View");
});

test("the Sound button asks for the opposite of what it shows, inside the press", () => {
  open();
  const asked: boolean[] = [];
  sound.request = (next: boolean) => asked.push(next);
  expect(page("btn-sound").getAttribute("aria-pressed")).toBe("false");
  click("#btn-sound");
  expect(asked).toEqual([true]);
  setOn(true);
  expect(page("btn-sound").getAttribute("aria-pressed")).toBe("true");
  click("#btn-sound");
  expect(asked).toEqual([true, false]);
});

test("the button's icon is a speaker with waves while sound is on and a crossed one while it is off", () => {
  open();
  expect(page("sound-ico").querySelectorAll("line")).toHaveLength(2);
  setOn(true);
  expect(page("sound-ico").querySelectorAll("line")).toHaveLength(0);
  expect(page("sound-ico").querySelectorAll("path")).toHaveLength(2);
});

test("where audio cannot start the button says so, is disabled, and a press says so in a toast", () => {
  open();
  const asked: boolean[] = [];
  sound.request = (next: boolean) => asked.push(next);
  // The bar re-reads the state when `sound` tells it: a real change of `on` does.
  setOn(true);
  sound.audio = "blocked";
  setOn(false);
  expect(page("btn-sound").getAttribute("aria-disabled")).toBe("true");
  expect(page("btn-sound").getAttribute("aria-label")).toBe("Sound is not available here");
  click("#btn-sound");
  expect(asked).toEqual([]);
  expect(h.toast).toHaveBeenCalledWith("This app does not let the office play sound.");
});

/** A page whose audio context runs when asked (`runs`) or never does. */
function audio(runs: boolean): void {
  Object.assign(window, {
    AudioContext: class {
      state = "suspended";
      resume() {
        if (!runs) return new Promise(() => undefined);
        this.state = "running";
        return Promise.resolve();
      }
      close() {
        return Promise.resolve();
      }
    },
  });
}

/** A press on the Sound button as a browser delivers it: pointerup (which the probe hears), then click. */
function pressSound(): void {
  page("btn-sound").dispatchEvent(new Event("pointerup", { bubbles: true }));
  click("#btn-sound");
}

/** The probe left blocked by one press whose context never ran; returns what stops the probe. */
async function blockedAudio(): Promise<() => void> {
  audio(false);
  const stopWatching = watchAudio(window, 1500);
  window.dispatchEvent(new Event("pointerup"));
  await vi.advanceTimersByTimeAsync(1600);
  expect(sound.audio).toBe("blocked");
  return stopWatching;
}

test("a press while audio is blocked whose own probe starts audio turns sound on, and does not say it is unavailable", async () => {
  open();
  const stopWatching = await blockedAudio();
  const asked: boolean[] = [];
  sound.request = (next: boolean) => {
    asked.push(next);
    setOn(next);
  };
  try {
    audio(true);
    pressSound();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual([true]);
    expect(sound.on).toBe(true);
    expect(page("btn-sound").getAttribute("aria-pressed")).toBe("true");
    expect(h.toast).not.toHaveBeenCalled();
  } finally {
    stopWatching();
    delete (window as unknown as Record<string, unknown>).AudioContext;
  }
});

test("a press while audio is blocked whose own probe ends blocked says so once it has, and asks for nothing", async () => {
  open();
  const stopWatching = await blockedAudio();
  const asked: boolean[] = [];
  sound.request = (next: boolean) => asked.push(next);
  try {
    pressSound();
    expect(h.toast).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1600);
    expect(asked).toEqual([]);
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(h.toast).toHaveBeenCalledWith("This app does not let the office play sound.");
  } finally {
    stopWatching();
    delete (window as unknown as Record<string, unknown>).AudioContext;
  }
});

test("a key press on the blocked button, with sound asked for, leaves sound on once its own probe starts audio", async () => {
  open();
  const stopWatching = await blockedAudio();
  // The stored setting says on; blocked, so nothing plays yet.
  setOn(true);
  expect(sound.on).toBe(false);
  const asked: boolean[] = [];
  sound.request = (next: boolean) => {
    asked.push(next);
    setOn(next);
  };
  try {
    // A browser runs the probe's own end between the window's listener and the button's (a context that already
    // runs settles in the microtasks after the first listener). Here the same order comes from a context that
    // runs at once and whose `resume` throws: the probe then ends inside its own listener.
    Object.assign(window, {
      AudioContext: class {
        state = "running";
        resume(): never {
          throw new Error("already running");
        }
        close() {
          return Promise.resolve();
        }
      },
    });
    // Space as a browser delivers it: the key down, which the probe hears first, then the click on its release.
    page("btn-sound").dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    // The probe found audio before the button heard the key, and sound came on by itself, as asked for.
    expect(sound.on).toBe(true);
    click("#btn-sound");
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual([true]);
    expect(sound.on).toBe(true);
    expect(page("btn-sound").getAttribute("aria-pressed")).toBe("true");
    expect(h.toast).not.toHaveBeenCalled();
  } finally {
    stopWatching();
    delete (window as unknown as Record<string, unknown>).AudioContext;
  }
});

test("the first press in a page that never lets audio start says so once its probe has ended, and asks for nothing", async () => {
  open();
  audio(false);
  const stopWatching = watchAudio(window, 1500);
  const asked: boolean[] = [];
  sound.request = (next: boolean) => asked.push(next);
  try {
    page("btn-sound").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    pressSound();
    expect(asked).toEqual([]);
    expect(h.toast).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1600);
    expect(asked).toEqual([]);
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(h.toast).toHaveBeenCalledWith("This app does not let the office play sound.");
  } finally {
    stopWatching();
    delete (window as unknown as Record<string, unknown>).AudioContext;
  }
});

test("a press that goes down on the button and comes up elsewhere leaves nothing behind for a later press", async () => {
  open();
  const asked: boolean[] = [];
  sound.request = (next: boolean) => asked.push(next);
  // Down on the button while sound is off (it would mean "on"), up somewhere else: no click.
  page("btn-sound").dispatchEvent(new Event("pointerdown", { bubbles: true }));
  window.dispatchEvent(new Event("pointerup"));
  await vi.advanceTimersByTimeAsync(0);
  // The host turns sound on meanwhile. A click that brings no press of its own asks for the opposite of what shows.
  setOn(true);
  click("#btn-sound");
  expect(asked).toEqual([false]);
});

test("a press on the speaker's drawing is the button's press: the drawing takes no pointer events", () => {
  build();
  const css = document
    .querySelector(".toolbar")
    ?.parentElement?.querySelector("style")?.textContent;
  // The drawing is replaced when the state changes; a press that began on a node since removed would make no click.
  expect(css).toContain("#sound-ico { pointer-events: none; }");
});

test("the disabled button's icon is drawn dimmed, not its tooltip, and its hover does not light it", () => {
  build();
  const css = document
    .querySelector(".toolbar")
    ?.parentElement?.querySelector("style")?.textContent;
  expect(css).toContain('.tb-full[aria-disabled="true"] { cursor: not-allowed; }');
  expect(css).toContain('.tb-full[aria-disabled="true"] > span { opacity: .45; }');
  // An opacity on the button would dim its ::after tooltip with it.
  expect(css).not.toMatch(/\.tb-full\[aria-disabled="true"\] \{[^}]*opacity/);
  expect(css).toContain(
    '.tb-full[aria-disabled="true"]:hover { background: none; color: #8D97AA; }',
  );
});

test("Overview is pressed at the start, and a drag clears it", () => {
  open();
  expect(pressed()).toEqual(["home"]);

  // (core/loop.js clears the view on the controls' 'start': a drag of the floor)
  setView(null);
  expect(pressed()).toEqual([]);
});

test("Desks flies to upstream's place at 1.9 times the fitted zoom", () => {
  open();
  const fitted = camera.zoom;
  click("[data-view=desks]");

  expect(h.set).toHaveBeenLastCalledWith(2.3, 0.6, 3.6);
  expect(state.zoomGoal).toBeCloseTo(fitted * 1.9);
  expect(pressed()).toEqual(["desks"]);
});

test("on the cozy room the views are upstream's places for it", () => {
  h.plan = "cozy";
  open();
  const fitted = camera.zoom;

  click("[data-view=desks]");
  expect(h.set).toHaveBeenLastCalledWith(0, 0.6, 0.4);
  expect(state.zoomGoal).toBeCloseTo(fitted * 1.75);

  click("[data-view=meeting]");
  expect(h.set).toHaveBeenLastCalledWith(5.2, 0.6, 2.4);
  expect(state.zoomGoal).toBeCloseTo(fitted * 2.3);

  goView("server");
  expect(h.set).toHaveBeenLastCalledWith(5.4, 1.0, -4.4);
  expect(state.zoomGoal).toBeCloseTo(fitted * 2.2);
  expect(pressed()).toEqual(["server"]);
});

test("a plan the bar has no places for uses the company floor's", () => {
  h.plan = "hq";
  open();
  click("[data-view=desks]");
  expect(h.set).toHaveBeenLastCalledWith(2.3, 0.6, 3.6);
});

test("a view closes the chosen person first", () => {
  open();
  state.selectedId = "a";
  click("[data-view=meeting]");

  expect(h.calls[0]).toBe("close");
  expect(h.calls).toContain("set");
  expect(h.closeSession).toHaveBeenCalledTimes(1);
  expect(h.set).toHaveBeenLastCalledWith(-1.2, 0.6, -5.4);
});

test("Overview flies back to the fitted floor", () => {
  open();
  const fitted = camera.zoom;
  click("[data-view=desks]");
  click("[data-view=home]");

  expect(state.zoomGoal).toBeNull();
  expect(camera.zoom).toBeCloseTo(fitted);
  expect(pressed()).toEqual(["home"]);
});

test("zoom in stops at the limit", () => {
  open();
  state.zoomGoal = controls.maxZoom - 0.01;
  click("#zoom-in");
  expect(state.zoomGoal).toBe(controls.maxZoom);
  click("#zoom-in");
  expect(state.zoomGoal).toBe(controls.maxZoom);
});

test("zoom out stops at its own limit", () => {
  open();
  state.zoomGoal = controls.minZoom + 0.01;
  click("#zoom-out");
  expect(state.zoomGoal).toBe(controls.minZoom);
  click("#zoom-out");
  expect(state.zoomGoal).toBe(controls.minZoom);
});

test("the percent reads 100% on Overview", () => {
  open();
  vi.advanceTimersByTime(200);
  expect(page("zoom-val").textContent).toBe("100%");
});

test("full screen is hidden where the browser has it off", () => {
  open({ fullscreen: false });
  expect(page("btn-full").hidden).toBe(true);
});

test("full screen is offered where the browser has it", () => {
  open();
  expect(page("btn-full").hidden).toBe(false);
});

test("a refused full screen says so", async () => {
  open({ refuse: true });
  page("btn-full").click();
  await Promise.resolve();
  await Promise.resolve();

  expect(h.toast).toHaveBeenCalledWith("This browser won't go full screen.");
});

test("a resize refits only on Overview", () => {
  open();
  click("[data-view=desks]");
  const flown = h.copy.mock.calls.length;
  resized?.();
  expect(h.copy.mock.calls.length).toBe(flown);

  click("[data-view=home]");
  const fitted = h.copy.mock.calls.length;
  resized?.();
  expect(h.copy.mock.calls.length).toBe(fitted + 1);
});

test("goView presses the view it was given", () => {
  open();
  goView("server");

  expect(h.set).toHaveBeenLastCalledWith(-5.6, 1.0, -0.6);
  expect(pressed()).toEqual(["server"]);
});

test("photo mode's bar is in the page, hidden, with its own controls", () => {
  open();

  expect(page("photo-bar").hidden).toBe(true);
  expect(
    [...document.querySelectorAll(".photo-bar [data-ph-size]")].map((b) => b.textContent),
  ).toEqual(["Screen", "Full HD", "4K"]);
});

test("photo mode's bar has Auto, Day and Night, Auto pressed first", () => {
  open();

  const buttons = [...document.querySelectorAll<HTMLElement>(".photo-bar [data-ph-time]")];
  expect(buttons.map((b) => [b.dataset.phTime, b.textContent])).toEqual([
    ["auto", "Auto"],
    ["day", "Day"],
    ["night", "Night"],
  ]);
  expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
});

test("every element ui/photo.js wires is built before the modules run", () => {
  // ui/photo.js's setup reads these ids and holds no guard: a missing one throws before the office draws.
  build();
  for (const id of ["btn-photo", "ph-exit", "ph-shoot", "ph-names", "ph-mark", "photo-bar"]) {
    expect(document.getElementById(id), id).not.toBeNull();
  }
});

test("every element first-person.js wires is built before the modules run", () => {
  // first-person.js's setup reads these ids and holds no guard: a missing one throws before the office draws.
  build();
  for (const id of ["btn-fp", "fp-hud", "fp-near", "fp-exit", "fp-joy"]) {
    expect(document.getElementById(id), id).not.toBeNull();
  }
  expect(page("fp-hud").hidden).toBe(true);
  expect(page("btn-fp").getAttribute("aria-pressed")).toBe("false");
  expect(page("btn-fp").getAttribute("title")).toBe("Walk in");
});

test("the overlay's style keeps upstream's light ink and hides the chips while walking", () => {
  build();
  const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  expect(css).toMatch(/\.fp-help \{[^}]*color: #8D97AA;/);
  expect(css).toMatch(/\.is-fp \.zone/);
  expect(css).toMatch(/\.bil-hud \{/);
});

test("while the incident banner shows, the walk's help line sits under it above 520 px", () => {
  // The banner (paseo-style.js `.incident`) is at the stage's top, `--corner-clear` down and about
  // 30 px tall; at 520 px and narrower the help line is 44 px under the corner already.
  build();
  const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  expect(css).toMatch(
    /@media \(min-width: 521px\) \{ #stage-wrap:has\(> #incident:not\(\[hidden\]\)\) \.fp-help \{ top: calc\(var\(--corner-clear\) \+ 40px\); \} \}/,
  );
});

test("the bar's text stays light on its dark track in either theme", () => {
  // Paseo's page colours its text with the theme's foreground, near-black in the light theme: the
  // bar sets upstream's light ink itself so nothing in it inherits that.
  build();
  const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  expect(css).toMatch(/\.toolbar \{[^}]*color: #E8ECF4;/);
});

test("a zoom clears the pressed view, and a resize then does not refit", () => {
  open();
  click("#zoom-in");
  click("#zoom-in");
  expect(pressed()).toEqual([]);
  const zoomed = state.zoomGoal;
  const fitted = h.copy.mock.calls.length;
  resized?.();
  expect(h.copy.mock.calls.length).toBe(fitted);
  expect(state.zoomGoal).toBe(zoomed);

  click("[data-view=home]");
  click("#zoom-out");
  expect(pressed()).toEqual([]);
});

test("a start in a frame with no size still fits the floor, so the views and the percent read from it", () => {
  // scene/renderer.js's resize sizes a stage of 0 x 0 as 1 x 1 (`clientWidth || 1`): a square frustum,
  // never an empty one.
  const frustum = [camera.left, camera.right, camera.top, camera.bottom] as const;
  const s = Math.max(8.8, 12 / 1);
  camera.left = -s;
  camera.right = s;
  camera.top = s;
  camera.bottom = -s;
  try {
    open();
    const fitted = camera.zoom;
    expect(fitted).toBeGreaterThan(controls.minZoom);
    vi.advanceTimersByTime(200);
    expect(page("zoom-val").textContent).toBe("100%");
    click("[data-view=desks]");
    expect(state.zoomGoal).toBeCloseTo(Math.min(controls.maxZoom, fitted * 1.9));
  } finally {
    [camera.left, camera.right, camera.top, camera.bottom] = frustum;
    camera.updateProjectionMatrix();
  }
});

/** The text of the style blocks the page has. */
function styles(): string {
  return [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
}

test("the tools' tooltips are not drawn in a frame too narrow to hold the last one", () => {
  // At 390 px the last tool's name ran past the frame's right edge.
  build();
  expect(styles()).toMatch(
    /@media \(max-width: 520px\) \{[^{]*\.tb-zoom button::after, \.tb-full::after \{ display: none; \}/,
  );
});

/** The rules inside the style's `@media (max-width: <px>px)` blocks, in order. */
function narrow(px: number): string {
  const css = styles();
  const head = `@media (max-width: ${px}px) {`;
  const found: string[] = [];
  for (let at = css.indexOf(head); at !== -1; at = css.indexOf(head, at + 1)) {
    let depth = 1;
    let end = at + head.length;
    for (; depth > 0 && end < css.length; end += 1) {
      if (css[end] === "{") depth += 1;
      if (css[end] === "}") depth -= 1;
    }
    found.push(css.slice(at + head.length, end - 1));
  }
  return found.join("\n");
}

test("from 720 px down Walk in and the views keep their names hidden, with upstream's narrower padding", () => {
  // At 530 px the bar with both names ran past the frame's right edge, and a view's name sliding out on
  // hover or focus still did (upstream's styles/stage.css, its 720 px rule).
  build();
  expect(narrow(720)).toContain(
    ".tb-fp span:last-child, .seg-btn > span:last-child { display: none !important; }",
  );
  expect(narrow(720)).toContain(".tb-fp { padding: 0 11px; }");
  expect(narrow(720)).toContain(
    '.seg-btn, .seg-btn:hover, .seg-btn[aria-pressed="true"] { padding: 0 10px; }',
  );
});

test("at 520 px and narrower the bar's buttons and groups sit closer, so Walk in still fits at 390 px", () => {
  // At 390 px with a mouse, Walk in still ran 30 px past the frame's right edge with the 720 px rule alone,
  // and 2 px past it with 4 px between the groups and 7 px of padding in the views. At 390 px the bar's
  // content may be 366 px (100% - 24px): views 4 x (6 + 16 + 6) + 3 x 2 + 2 x 3 = 124, zoom 28 + 2 + 42 +
  // 2 + 28 + 6 = 108, tools 3 x 28 + 6 = 90, Walk in 11 + 16 + 11 = 38, and 3 gaps of 2: 366.
  build();
  expect(narrow(520)).toContain(".toolbar { gap: 2px; }");
  expect(narrow(520)).toContain(
    '.seg-btn, .seg-btn:hover, .seg-btn:focus-visible, .seg-btn[aria-pressed="true"] { padding: 0 6px; transition-property: background, color; }',
  );
  expect(narrow(520)).toContain(".tb-tools { gap: 0; }");
  expect(narrow(520)).toContain(".tb-zoom button, .tb-full { width: 28px; }");
});

test("photo mode's bar keeps upstream's focus ring, its round exit, and drops the hint on a phone", () => {
  build();
  const css = styles();
  expect(css).toContain(
    ".pb-tgl:focus-visible, .pb-seg button:focus-visible, .pb-shoot:focus-visible, .pb-clip:focus-visible, .clip-stop:focus-visible, .pb-exit:focus-visible { outline: 2px solid #F2B33D; outline-offset: 2px; }",
  );
  expect(css).toContain(".pb-exit { display: inline-grid; place-items: center; padding: 7px; }");
  expect(css).toContain(
    "@media (max-width: 720px) { .photo-hint { display: none; } .pb-sep { display: none; } }",
  );
});

test("Walk in is shown for a fine pointer and hidden for a coarse one, and follows a change", () => {
  const fine = open({ fine: false });
  expect(page("btn-fp").hidden).toBe(true);
  expect(state.isLocal).toBe(false);
  fine.change(true);
  expect(page("btn-fp").hidden).toBe(false);
  expect(state.isLocal).toBe(true);
  fine.change(false);
  expect(page("btn-fp").hidden).toBe(true);
  expect(state.isLocal).toBe(false);
});

test("a view press leaves walk-in first", () => {
  open();
  h.fp.on = true;
  click("[data-view=desks]");
  expect(h.exitFp).toHaveBeenCalledTimes(1);
});

test("zoom while walking changes the field of view by 8, within 40 and 90", () => {
  open();
  h.fp.on = true;
  click("#zoom-in");
  expect(fpCam.fov).toBe(62);
  for (let i = 0; i < 6; i += 1) click("#zoom-in");
  expect(fpCam.fov).toBe(40);
  for (let i = 0; i < 8; i += 1) click("#zoom-out");
  expect(fpCam.fov).toBe(90);
  expect(state.zoomGoal).toBeNull();
});

test("the percent while walking is the field of view's zoom over 70", () => {
  open();
  h.fp.on = true;
  vi.advanceTimersByTime(200);
  expect(page("zoom-val").textContent).toBe("100%");
  click("#zoom-in");
  vi.advanceTimersByTime(200);
  expect(page("zoom-val").textContent).toBe("113%");
});

test("Escape leaves walk-in, but not while the place card is open", () => {
  open();
  document.body.insertAdjacentHTML("beforeend", '<div id="plc"></div>');
  h.fp.on = true;
  page("plc").hidden = false;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(h.exitFp).not.toHaveBeenCalled();

  page("plc").hidden = true;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(h.exitFp).toHaveBeenCalledTimes(1);
});

test("Escape does nothing while not walking", () => {
  open();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(h.exitFp).not.toHaveBeenCalled();
});

/** The page's clock, which the automatic camera's thirty seconds are read from; given back after each test. */
function clock(start: number) {
  const now = { value: start };
  onAfter.push(vi.spyOn(performance, "now").mockImplementation(() => now.value));
  return now;
}

/** A drag of the floor beginning: OrbitControls' 'start'. */
const drag = () => (controls as unknown as { fire(type: string): void }).fire("start");

/** A person as the camera glides to one: where they stand. */
const person = { pos: { x: 3, y: 4 } };

test("the automatic camera may glide while it is on and nobody uses the camera", () => {
  clock(100_000);
  open();
  expect(state.camAuto).toBe(true);
  expect(autoCam()).toBe(true);

  state.selectedId = "a";
  expect(autoCam()).toBe(false);
  state.selectedId = null;
  state.photo = true;
  expect(autoCam()).toBe(false);
  state.photo = false;
  h.fp.on = true;
  expect(autoCam()).toBe(false);
  h.fp.on = false;
  state.camAuto = false;
  expect(autoCam()).toBe(false);
});

test("upstream's switch, office-autocam off, turns it off", () => {
  localStorage.setItem("office-autocam", "off");
  open();
  expect(state.camAuto).toBe(false);
});

test("it waits thirty seconds after a touch of the controls", () => {
  const now = clock(100_000);
  open();
  drag();
  now.value += 29_000;
  expect(autoCam()).toBe(false);
  now.value += 2_000;
  expect(autoCam()).toBe(true);
});

test("a glide looks at the person and goes back after seven seconds, once for two glides", () => {
  open();
  h.copy.mockClear();
  panTo(person);
  expect(h.set).toHaveBeenLastCalledWith(3, 0.9, 4);
  panTo({ pos: { x: 5, y: 6 } });
  vi.advanceTimersByTime(6_999);
  expect(h.copy).not.toHaveBeenCalled();
  vi.advanceTimersByTime(2);
  expect(h.copy).toHaveBeenCalledTimes(1);
  expect(h.clone).toHaveBeenCalledTimes(1);
  expect(h.copy).toHaveBeenCalledWith({ home: true });
});

test("anything else that takes the camera ends the glide, so it does not pull it back", () => {
  open();
  for (const takeIt of [() => setView(null), () => goView("desks"), drag]) {
    h.copy.mockClear();
    panTo(person);
    takeIt();
    vi.advanceTimersByTime(8_000);
    expect(h.copy).not.toHaveBeenCalled();
  }
});

test("a person chosen during the glide keeps the camera where it is when it ends", () => {
  open();
  h.copy.mockClear();
  panTo(person);
  state.selectedId = "a";
  vi.advanceTimersByTime(8_000);
  expect(h.copy).not.toHaveBeenCalled();
});

/** What a browser needs to record a clip: a recorder and a canvas that can be captured. */
function recorder(has: boolean) {
  if (has) {
    vi.stubGlobal("MediaRecorder", vi.fn());
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      configurable: true,
      value: () => ({}),
    });
  } else {
    vi.stubGlobal("MediaRecorder", undefined);
    delete (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream;
  }
}

test("photo mode's bar has the clip's controls, hidden until the bar knows the clip can be made", () => {
  build();

  expect(page("ph-clipset").hidden).toBe(true);
  expect(page("ph-clip").textContent).toContain("Clip 15 s");
  expect(
    [...document.querySelectorAll<HTMLElement>("[data-clip-shape]")].map(
      (b) => b.dataset.clipShape,
    ),
  ).toEqual(["square", "tall"]);
  expect(page("ph-music").getAttribute("aria-pressed")).toBe("true");
});

test("the clip is offered with a recorder, a capturable canvas, a fine pointer and photo mode", () => {
  recorder(true);
  open();
  expect(page("ph-clipset").hidden).toBe(false);
});

test("the clip is hidden without a recorder, with a coarse pointer, or where photo mode is off", () => {
  recorder(false);
  open();
  expect(page("ph-clipset").hidden).toBe(true);

  recorder(true);
  document.body.innerHTML = '<div id="stage-wrap"><div id="stage"></div></div>';
  open({ fine: false });
  expect(page("ph-clipset").hidden).toBe(true);

  document.body.innerHTML = '<div id="stage-wrap"><div id="stage"></div></div>';
  h.photo = false;
  open();
  expect(page("ph-clipset").hidden).toBe(true);
});

test("the clip follows the pointer when it changes", () => {
  recorder(true);
  const fine = open({ fine: false });
  expect(page("ph-clipset").hidden).toBe(true);
  fine.change(true);
  expect(page("ph-clipset").hidden).toBe(false);
});

test("the clip's cover is not hidden by photo mode's rule, and the clip's styles are in the bar", () => {
  build();
  const css = styles();
  expect(css).toContain(
    "body.is-photo #stage-wrap > :not(#stage):not(#photo-bar):not(.clip-cover) { display: none !important; }",
  );
  for (const rule of [
    ".pb-clip {",
    ".pb-music {",
    ".pb-music:disabled {",
    ".clip-cover {",
    ".clip-view {",
    ".clip-prog {",
    ".clip-label {",
    ".clip-stop {",
  ]) {
    expect(css).toContain(rule);
  }
  expect(css).not.toContain("var(--accent-line)");
  expect(css).not.toContain("var(--font)");
});

test("translated camera labels preserve literal punctuation and fall back per key", () => {
  const home = 'Tổng quan "b" <i> & c';
  setLanguage(
    "vi",
    JSON.stringify({ dict: { ui: { cameraToolbar: { home }, photo: { shoot: "Chụp ảnh" } } } }),
  );
  build();
  const view = document.querySelector('[data-view="home"]');
  expect([
    view?.getAttribute("aria-label"),
    view?.getAttribute("title"),
    view?.textContent,
  ]).toEqual([home, home, home]);
  expect(view?.querySelector("i")).toBeNull();
  expect(page("ph-shoot").textContent).toBe("Chụp ảnh");
  expect(document.querySelector('[data-view="desks"]')?.textContent).toBe("Desks");
});

test("the English camera controls use the office labels", () => {
  build();
  expect(
    [...document.querySelectorAll("[data-view]")].map((el) => el.getAttribute("aria-label")),
  ).toEqual(["Overview", "Desks", "Meeting room", "Servers"]);
  expect(
    ["zoom-out", "zoom-in", "btn-full", "btn-fp", "ph-exit"].map((id) =>
      page(id).getAttribute("aria-label"),
    ),
  ).toEqual(["Zoom out", "Zoom in", "Full screen", "Walk in", "Leave photo mode"]);
  expect(document.querySelector(".fp-help")?.textContent).toMatch(/^Walking the office/);
  expect(page("ph-shoot").textContent).toBe("Take photo");
});
