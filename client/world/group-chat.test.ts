// The stand-in of my-office's group chat (ui/group-chat.js): the office's people's moments go to the
// host as a kind and a few words, once per period, as upstream's chatLife says them.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
// @ts-expect-error vendored JavaScript has no declarations
import { host } from "../../vendor/my-office/src/office/paseo-host.js";
// @ts-expect-error vendored JavaScript has no declarations
import { chatLife, chatPhoto } from "../../vendor/my-office/src/office/ui/group-chat.js";

const said: unknown[][] = [];
beforeEach(() => {
  said.length = 0;
  host.life = (kind: string, vars: object) => said.push([kind, vars]);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 19, 10));
});

afterEach(() => {
  vi.useRealTimers();
});

test("a moment goes to the host as its kind and words, with no picture and nothing that is not a word", () => {
  chatLife("tea", { photo: chatPhoto({}), id: "a1", monday: false, n: 3, skip: undefined });
  expect(chatPhoto({})).toBeNull();
  expect(said).toEqual([["tea", { id: "a1", monday: "false", n: "3" }]]);
});

test("the same moment of the same person is told once per period", () => {
  chatLife("stairs", { id: "a1", every: 60_000 });
  chatLife("stairs", { id: "a1", every: 60_000 });
  chatLife("stairs", { id: "a2", every: 60_000 });
  vi.advanceTimersByTime(60_000);
  chatLife("stairs", { id: "a1", every: 60_000 });
  expect(said.map(([, vars]) => (vars as { id: string }).id)).toEqual(["a1", "a2", "a1"]);
});

test("a long word is cut to what the server takes", () => {
  chatLife("dutyRoster", { list: "x".repeat(500) });
  expect(said).toEqual([["dutyRoster", { list: "x".repeat(200) }]]);
});
