import { expect, test } from "vitest";
import { chatT } from "./chat-words.js";
import { LIFE_KINDS, lifeLine, type LifeContext } from "./life-lines.js";

const ctx: LifeContext = {
  resting: () => ["a1"],
  name: (id) => (id === "a1" ? "Ann" : null),
  now: 1_000_000,
};

test("every kind the scenes call has a line, a sender and words that exist", () => {
  expect([...LIFE_KINDS].sort()).toEqual([
    "altar",
    "atm",
    "back",
    "birthday",
    "breakEve",
    "bye",
    "com",
    "drillDone",
    "drillNotice",
    "dutyGrumble",
    "dutyRoster",
    "evDone",
    "evLow",
    "farewell",
    "farewellPhoto",
    "frosty",
    "handset",
    "harbor",
    "jadetea",
    "liftDone",
    "lunchOrder",
    "makeup",
    "micro",
    "microPop",
    "microSmell",
    "nap",
    "navycafe",
    "nhauCheers",
    "nhauInvite",
    "nhauNoDrive",
    "nhauRide",
    "nhauYes",
    "official",
    "olivecafe",
    "parcel",
    "payday",
    "photoGo",
    "photoQueue",
    "photoStrip",
    "pickleAsk",
    "pickleDone",
    "plateau",
    "stairs",
    "standup",
    "store",
    "tea",
    "trophy",
    "wake",
  ]);
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
    expect(chatT(line.key, line.vars), kind).not.toBe(line.key);
    for (const reply of line.options.answer || [])
      expect(chatT("chat.reply." + reply.key, {})).not.toBe("chat.reply." + reply.key);
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

test("outdoor scenes use their own words and the registered participant", () => {
  expect(lifeLine("com", { id: "a1", friday: "true" }, ctx)?.key).toBe("chat.life.comFriday");
  expect(lifeLine("nhauCheers", { id: "a1" }, ctx)).toMatchObject({
    from: "a1",
    key: "chat.life.nhauCheers",
  });
  expect(chatT("chat.life.nhauRide", {})).toContain("Ridely");
  expect(lifeLine("nhauRide", { id: "not-a-person" }, ctx)).toBeNull();
});
