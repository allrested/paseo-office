// @vitest-environment jsdom
// The street-off path in the real outings and guard modules.
import { expect, test, vi } from "vitest";

vi.mock("../../vendor/my-office/src/office/people/workers.js", () => ({
  workers: new Map(),
  sessions: new Map([
    ["rest", { status: "rest", bg: [] }],
    ["busy", { status: "work", bg: [] }],
    ["bg", { status: "rest", bg: [{ desc: "x" }] }],
  ]),
}));
vi.mock("../../vendor/my-office/src/i18n/index.js", () => ({ t: (k: string) => k }));
vi.mock("../../vendor/my-office/src/office/ui/event-text.js", () => ({
  ANIM_AT: { desk: "type" },
  verb: () => "",
}));

// @ts-expect-error vendored JavaScript has no declarations
import * as outings from "../../vendor/my-office/src/office/people/outings.js";
// @ts-expect-error vendored JavaScript has no declarations
import * as guard from "../../vendor/my-office/src/office/people/guard.js";

const person = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  sub: false,
  root: { parent: {} },
  phase: "idle",
  anim: "sleep",
  station: "desk",
  ...extra,
});

test("without a city the guard and outings stay inactive", () => {
  expect(outings.street()).toBeNull();

  const done = vi.fn();
  outings.walk({}, null, [], done);
  expect(done).toHaveBeenCalledTimes(1);

  expect(guard.marshal.on).toBe(false);
  expect(() => guard.marshal.say("x")).not.toThrow();
  expect(() => outings.updateOutings()).not.toThrow();
  expect(() => guard.updateGuard()).not.toThrow();
});

test("resting is someone asleep at their own desk with nothing running", () => {
  expect(outings.resting(person("rest"))).toBe(true);
  expect(outings.resting(person("busy"))).toBe(false);
  expect(outings.resting(person("bg"))).toBe(false);
  expect(outings.resting(person("rest", { anim: "type" }))).toBe(false);
  expect(outings.resting(person("rest", { chore: {} }))).toBe(false);
  expect(outings.resting(person("rest", { sub: true }))).toBe(false);
});

test("called is work that came in", () => {
  expect(outings.called(person("rest"))).toBe(false);
  expect(outings.called(person("busy"))).toBe(true);
  expect(outings.called(person("bg"))).toBe(true);
  expect(outings.called(person("rest", { want: true }))).toBe(true);
  expect(outings.called(person("nobody"))).toBe(true);
});

test("resume puts someone back to rest at the desk", () => {
  const w = { ...person("rest"), say: vi.fn(), hush: vi.fn(), P: { held: {} } };
  outings.resume(w, false);
  expect(w.station).toBe("desk");
  expect(w.anim).toBe("sleep");
  expect(w.hush).toHaveBeenCalled();
  const busy = { ...person("busy"), say: vi.fn(), hush: vi.fn(), P: { held: {} } };
  outings.resume(busy, false);
  expect(busy.anim).toBe("type");
});

test("a real stretch of pavement locates the guard post beside the street exit", () => {
  const exit = { L: { axis: "x" }, a: [0, 0], b: [10, 0], s: 5 };
  expect(guard.guardPost(exit)).toBeCloseTo(3.1);
});
