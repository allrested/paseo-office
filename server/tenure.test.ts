import { expect, test } from "vitest";
import {
  FAREWELL_DAYS,
  createTenure,
  farewellDue,
  isIntern,
  promoteDue,
  wasActive,
} from "./tenure.js";

const DAY = 86_400_000;
const memory = () => {
  let saved: unknown = null;
  return {
    load: () => saved,
    save: (data: unknown) => {
      saved = structuredClone(data);
    },
  };
};

test("a team is active after two days and due after thirty quiet ones", () => {
  expect(wasActive({ days: 1 })).toBe(false);
  expect(wasActive({ days: 2 })).toBe(true);
  const quiet = { days: 3, last: 0, farewell: 0 };
  expect(farewellDue(quiet, FAREWELL_DAYS, 29 * DAY, false)).toBe(false);
  expect(farewellDue(quiet, FAREWELL_DAYS, 30 * DAY, false)).toBe(true);
  expect(farewellDue(quiet, FAREWELL_DAYS, 31 * DAY, true)).toBe(false);
  expect(farewellDue({ ...quiet, farewell: 5 }, FAREWELL_DAYS, 31 * DAY, false)).toBe(false);
});

test("a team new to the office is an intern until 20 turns on two days", () => {
  const p = { checked: true, turns: 19, days: 2 };
  expect(isIntern(p)).toBe(true);
  expect(promoteDue(p)).toBe(false);
  expect(promoteDue({ ...p, turns: 20 })).toBe(true);
  expect(isIntern({ ...p, pre: true })).toBe(false);
  expect(isIntern({ ...p, official: 1 })).toBe(false);
});

test("the teams present on the first start are permanent", () => {
  let now = 10 * DAY;
  const t = createTenure({ store: memory(), now: () => now });
  t.seed([{ name: "api", first: 0, daysSeen: 4 }]);
  expect(t.list(new Set()).find((p) => p.name === "api")).toBeUndefined();
  expect(t.touch("web", { at: now })).toBe("new");
  now += DAY;
  expect(t.list(new Set()).find((p) => p.name === "web")?.intern).toBe(true);
});

test("turns and days count, and a team that comes back after its farewell says so", () => {
  let now = 100 * DAY;
  const t = createTenure({ store: memory(), now: () => now });
  t.seed([{ name: "api", first: 0, daysSeen: 5 }]);
  now += 40 * DAY;
  expect(t.list(new Set())[0]).toMatchObject({ name: "api", due: true });
  expect(t.markFarewell("api", true)).toBe(false);
  expect(t.markFarewell("api", false)).toBe(true);
  expect(t.markFarewell("api", false)).toBe(false);
  expect(t.touch("api", { at: now + DAY, turn: true })).toBe("back");
  expect(t.list(new Set())[0]).toMatchObject({ name: "api", due: false, farewell: 0 });
});

test("an intern ready after 20 turns is made permanent once", () => {
  let now = 0;
  const t = createTenure({ store: memory(), now: () => now });
  t.seed([]);
  t.touch("new", { at: now });
  for (let i = 0; i < 20; i += 1) {
    now += DAY / 10;
    t.touch("new", { at: now, turn: true });
  }
  now += DAY;
  t.touch("new", { at: now, turn: true });
  expect(t.list(new Set())[0]).toMatchObject({ intern: true, ready: true });
  expect(t.markOfficial("new")).toBe(true);
  expect(t.markOfficial("new")).toBe(false);
  expect(t.list(new Set())[0]).toMatchObject({ intern: false, official: expect.any(Number) });
});

test("the ledger is kept and read back", () => {
  const store = memory();
  const a = createTenure({ store, now: () => 5 * DAY });
  a.seed([{ name: "api", first: 0, daysSeen: 3 }]);
  a.touch("api", { at: 5 * DAY, turn: true });
  const b = createTenure({ store, now: () => 5 * DAY });
  expect(b.get("api")).toMatchObject({ turns: 1 });
});

test("no more than 300 teams are kept, the most lately at work", () => {
  let now = 0;
  const t = createTenure({ store: memory(), now: () => now });
  t.seed([]);
  for (let i = 0; i < 305; i += 1) {
    now += 1000;
    t.touch(`t${i}`, { at: now });
  }
  expect(t.get("t0")).toBeNull();
  expect(t.get("t304")).not.toBeNull();
});

test("first census keeps turns finished before the office was opened", () => {
  const ledger = createTenure({ store: memory(), now: () => 10 * DAY });
  ledger.touch("api", { at: 9 * DAY, turn: true });
  ledger.seed([{ name: "api", first: 3 * DAY, daysSeen: 2 }]);
  expect(ledger.get("api")).toMatchObject({ first: 3 * DAY, pre: true, turns: 1, days: 2 });
});

test("a name that is an object's own key is a team like any other", () => {
  const t = createTenure({ store: memory(), now: () => 0 });
  t.seed([]);
  expect(t.get("__proto__")).toBeNull();
  expect(t.get("constructor")).toBeNull();
  expect(t.markOfficial("toString")).toBe(false);
});
