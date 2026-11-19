// @vitest-environment jsdom
// The first-visit tour (ui/tips.js, upstream's with Paseo's changes). The scene's pieces it points at are
// stood in with what it reads: props with a centre and a top, one person, the cat, the camera's target.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
// @ts-expect-error vendored JavaScript has no declarations
import { state } from "../../vendor/my-office/src/office/core/state.js";

const h = vi.hoisted(() => {
  /** Every label the tour put in the scene: over a prop, the cat or a person. */
  const anchors: { element: HTMLElement }[] = [];
  return {
    anchors,
    /** What the scene, the cat and a person do with a label added to them: here, keep it. */
    hold: (anchor: { element: HTMLElement }) => anchors.push(anchor),
    set: vi.fn(),
    setView: vi.fn(),
    setOutline: vi.fn(),
    props: new Map<string, unknown>(),
    workers: new Map<string, unknown>(),
    fp: { on: false },
  };
});

vi.mock("../../vendor/my-office/src/office/core/env.js", () => ({
  $: (id: string) => document.getElementById(id),
  STATIC: false,
  replay: { on: false },
  el: (tag: string, cls?: string, text?: string) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  },
}));
vi.mock("../../vendor/my-office/src/office/scene/renderer.js", () => ({
  BASE_ZOOM: 1,
  scene: { add: h.hold },
}));
vi.mock("../../vendor/my-office/src/office/core/loop.js", () => ({ focusTarget: { set: h.set } }));
vi.mock("../../vendor/my-office/src/office/interact/props.js", () => ({
  PROPS: h.props,
  hoverProp: null,
  setOutline: h.setOutline,
}));
vi.mock("../../vendor/my-office/src/office/interact/first-person.js", () => ({ fp: h.fp }));
vi.mock("../../vendor/my-office/src/office/world/props/cat.js", () => ({
  cat: { g: { add: h.hold, position: { x: 0, z: 0 } } },
}));
vi.mock("../../vendor/my-office/src/office/people/workers.js", () => ({ workers: h.workers }));
vi.mock("../../vendor/my-office/src/office/ui/lite.js", () => ({ lite: false }));
vi.mock("../../vendor/my-office/src/office/ui/settings.js", () => ({ togglePop() {} }));
vi.mock("../../vendor/my-office/src/office/ui/camera-bar.js", () => ({ setView: h.setView }));
vi.mock("../../vendor/my-office/src/i18n/index.js", () => ({ t: (key: string) => key }));

import {
  endTips,
  setup,
  startTips,
  updateTips,
  // @ts-expect-error vendored JavaScript has no declarations
} from "../../vendor/my-office/src/office/ui/tips.js";
// @ts-expect-error vendored JavaScript has no declarations
import { STYLE } from "../../vendor/my-office/src/office/paseo-style.js";

const prop = { center: { x: 0, y: 0.5, z: 0 }, top: 1, meshes: [] };
const worker = { root: { visible: true, add: h.hold }, pos: { x: 1, y: 2 }, anim: "work" };
const latest = () => h.anchors[h.anchors.length - 1];
const clickNext = () => latest()?.element.querySelector<HTMLElement>(".tour-next")?.click();
const title = () => latest()?.element.querySelector(".tour-title")?.textContent;

/** The window outlives each test's page: the Escape listener setup() puts on it is taken off after the test. */
const onWindow = vi.spyOn(window, "addEventListener");
/** The page's clock, set by a test and given back after it. */
let clock: { mockRestore(): void } | null = null;
function at(now: { value: number }) {
  clock = vi.spyOn(performance, "now").mockImplementation(() => now.value);
}

beforeEach(() => {
  endTips(false);
  h.anchors.length = 0;
  h.props.clear();
  h.workers.clear();
  h.set.mockClear();
  h.setView.mockClear();
  h.fp.on = false;
  localStorage.clear();
  state.photo = false;
  state.isLocal = false;
  state.sim = 1;
  state.selectedId = null;
  document.body.innerHTML = '<div id="stage-wrap"><button id="btn-fp"></button></div>';
  for (const id of ["lamp0", "switch0", "coffee", "printer", "cat", "bell"]) h.props.set(id, prop);
  h.workers.set("a", worker);
});

afterEach(() => {
  for (const [type, listener, options] of onWindow.mock.calls) {
    window.removeEventListener(type, listener, options);
  }
  onWindow.mockClear();
  clock?.mockRestore();
  clock = null;
});

test("the tour goes lamp, switch, coffee, printer, cat, a person, then Walk in, and leaves out the bell", () => {
  startTips();
  const titles: (string | null | undefined)[] = [];
  for (let step = 0; step < 6; step += 1) {
    titles.push(title());
    clickNext();
  }

  expect(titles).toEqual([
    "tips.lamp.title",
    "tips.switch.title",
    "tips.coffee.title",
    "tips.printer.title",
    "tips.cat.title",
    "tips.person.title",
  ]);
  // The Walk in card stands above its button, in the stage.
  expect(document.querySelector("#stage-wrap > .tour--page .tour-title")?.textContent).toBe(
    "tips.walk.title",
  );
});

test("a floor without a prop skips its card", () => {
  h.props.delete("lamp0");
  h.props.delete("cat");
  h.workers.clear();
  startTips();

  expect(title()).toBe("tips.switch.title");
});

test("a card looking at something leaves Overview unpressed", () => {
  startTips();
  expect(h.setView).toHaveBeenCalledWith(null);
});

test("the first visit starts the tour once things settle, on a device with a pointer and keys", () => {
  const now = { value: 1_000 };
  at(now);
  setup();

  now.value = 6_000;
  updateTips();
  expect(h.anchors).toHaveLength(0); // a phone: state.isLocal is false

  state.isLocal = true;
  updateTips();
  expect(h.anchors.length).toBeGreaterThan(0);
});

test("a finished tour is remembered and does not start again", () => {
  startTips();
  endTips();
  expect(localStorage.getItem("office-tips")).toBe("seen");

  const now = { value: 1_000 };
  at(now);
  state.isLocal = true;
  h.anchors.length = 0;
  setup();
  now.value = 60_000;
  updateTips();
  expect(h.anchors).toHaveLength(0);
});

test("Walk in or Photo mode ends the tour for good", () => {
  startTips();
  state.photo = true;
  updateTips();
  expect(localStorage.getItem("office-tips")).toBe("seen");

  localStorage.clear();
  state.photo = false;
  startTips();
  h.fp.on = true;
  updateTips();
  expect(localStorage.getItem("office-tips")).toBe("seen");
});

test("Escape ends it", () => {
  setup();
  startTips();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(localStorage.getItem("office-tips")).toBe("seen");
});

test("the page has styles for the card, in the app's colours", () => {
  for (const rule of [".tour-wrap {", ".tour {", ".tour-next", ".tour-skip", ".tour--page {"]) {
    expect(STYLE).toContain(rule);
  }
  expect(STYLE).not.toContain("var(--green)");
  expect(STYLE).not.toContain("var(--font)");
  expect(STYLE).not.toContain("var(--accent-line)");
});
