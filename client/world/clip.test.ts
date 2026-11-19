// @vitest-environment jsdom
// Clip recording's entry point (ui/timelapse.js, upstream's): without a recorder it says so and draws nothing.
// Recording itself needs a real canvas and recorder: it is looked at in a browser (docs/verified.md).
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("../../vendor/my-office/src/office/core/env.js", () => ({
  $: (id: string) => document.getElementById(id),
  el: (tag: string, cls?: string, text?: string) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  },
  fmtBytes: () => "1 MB",
}));
vi.mock("../../vendor/my-office/src/office/scene/renderer.js", () => ({
  camera: {},
  composer: {},
  controls: {},
  renderer: {},
  resize() {},
}));
vi.mock("../../vendor/my-office/src/office/world/room-update.js", () => ({ night: false }));
vi.mock("../../vendor/my-office/src/office/people/workers.js", () => ({ workers: new Map() }));
vi.mock("../../vendor/my-office/src/office/ui/settings.js", () => ({
  setTimeMode() {},
  syncTimeBtns() {},
}));
vi.mock("../../vendor/my-office/src/office/ui/photo.js", () => ({
  paintMark() {},
  paintNames() {},
}));
vi.mock("../../vendor/my-office/src/office/ui/activity.js", () => ({ toast: h.toast }));
vi.mock("../../vendor/my-office/src/office/ui/clip-music.js", () => ({ musicTrack: () => null }));
vi.mock("../../vendor/my-office/src/i18n/index.js", () => ({
  t: (key: string) => key,
  locale: () => "en-US",
  num: (n: number) => String(n),
}));

import {
  clipOn,
  makeClip,
  // @ts-expect-error vendored JavaScript has no declarations
} from "../../vendor/my-office/src/office/ui/timelapse.js";

beforeEach(() => {
  h.toast.mockReset();
  document.body.innerHTML = '<div id="stage-wrap"></div>';
});
afterEach(() => vi.unstubAllGlobals());

test("without a recorder, making a clip says so and covers nothing", () => {
  vi.stubGlobal("MediaRecorder", undefined);
  makeClip();

  expect(h.toast).toHaveBeenCalledWith("ui.clip.unsupported");
  expect(document.querySelector(".clip-cover")).toBeNull();
  expect(clipOn()).toBe(false);
});
