import { expect, test } from "vitest";
import chat from "./upstream/chat.js";
import { LIFE_KINDS, lifeLine, type LifeContext } from "./life-lines.js";

const ctx: LifeContext = {
  resting: () => ["a1"],
  name: (id) => (id === "a1" ? "Ann" : null),
  now: 1_000_000,
};

test("every kind the scenes call has a line, a sender and words that exist", () => {
  expect([...LIFE_KINDS].sort()).toEqual([
    "altar",
    "back",
    "birthday",
    "breakEve",
    "bye",
    "drillDone",
    "drillNotice",
    "dutyGrumble",
    "dutyRoster",
    "farewell",
    "farewellPhoto",
    "liftDone",
    "makeup",
    "micro",
    "microPop",
    "microSmell",
    "nap",
    "official",
    "parcel",
    "stairs",
    "standup",
    "tea",
    "trophy",
    "wake",
  ]);
  const life = chat.life as Record<string, unknown>;
  for (const kind of LIFE_KINDS) {
    const line = lifeLine(
      kind,
      {
        id: "a1",
        name: "Ann",
        names: "Ann",
        chore: "cups",
        list: "x",
        q: "1",
        n: "3",
        time: "1:02",
        off: "1/5",
        makeup: "",
      },
      ctx,
    );
    expect(line, kind).not.toBeNull();
    if (line === null) continue;
    expect(typeof line.from).toBe("string");
    const key = line.key.replace(/^chat\.life\./, "");
    expect(
      life[key] ?? (chat.work as Record<string, unknown>)[key.replace(/^chat\.work\./, "")],
      kind,
    ).toBeDefined();
  }
});

test("the staff speak for themselves and a person speaks as themselves", () => {
  expect(lifeLine("altar", {}, ctx)?.from).toBe("reception");
  expect(lifeLine("drillNotice", { q: "2" }, ctx)).toMatchObject({
    from: "hr",
    options: { pin: true },
  });
  expect(lifeLine("stairs", { id: "a1" }, ctx)?.from).toBe("a1");
  expect(lifeLine("parcel", { id: "a1" }, ctx)).toMatchObject({
    from: "reception",
    vars: { name: "Ann" },
  });
});

test("a kind that needs a person and has none says nothing", () => {
  expect(lifeLine("stairs", {}, ctx)).toBeNull();
  expect(lifeLine("microSmell", {}, { ...ctx, resting: () => [] })).toBeNull();
});

test("someone at rest speaks when the scene names nobody", () => {
  expect(lifeLine("nap", {}, ctx)?.from).toBe("a1");
});

test("a kind no table has is refused", () => {
  expect(lifeLine("tgdd", {}, ctx)).toBeNull();
  expect(lifeLine("__proto__", {}, ctx)).toBeNull();
});

test("the key a line is said once under changes with the period", () => {
  const a = lifeLine("altar", { every: "1200000" }, { ...ctx, now: 0 });
  const b = lifeLine("altar", { every: "1200000" }, { ...ctx, now: 1_300_000 });
  expect(a?.options.key).not.toBe(b?.options.key);
});
