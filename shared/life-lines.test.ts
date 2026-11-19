import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { leftIn } from "../scripts/genericise-street.mjs";
import chat from "./upstream/chat.js";
import { LIFE_KINDS, lifeLine, type LifeContext } from "./life-lines.js";

const ctx: LifeContext = {
  resting: () => ["a1"],
  name: (id) => (id === "a1" ? "Ann" : null),
  now: 1_000_000,
};
const area = (name: string) => chat[name] as Readonly<Record<string, unknown>>;
const VARS = { id: "a1", who: "a1", names: "Ann", chore: "cups", list: "x", q: "1", n: "3" };

test("every kind the taken scenes call has a line", () => {
  expect([...LIFE_KINDS].sort()).toEqual([
    "altar",
    "back",
    "birthday",
    "breakEve",
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
});

// The table is a copy of upstream's chatLife, which reads the chat's words by their keys: the keys
// must be the ones the vendored chat.js has after the names swap (scripts/genericise-street.mjs).
test("every line, answer and second line is a key of the vendored chat words", () => {
  const life = area("life");
  const reply = area("reply");
  for (const kind of LIFE_KINDS) {
    for (const vars of [VARS, { ...VARS, monday: "true", makeup: "1/5" }]) {
      const line = lifeLine(kind, vars, ctx);
      expect(line, kind).not.toBeNull();
      if (line === null) continue;
      expect(life[line.key.replace(/^chat\.life\./, "")], `${kind}: ${line.key}`).toBeDefined();
      for (const answer of line.options.answer ?? []) {
        expect(reply[answer.key], `${kind}: ${answer.key}`).toBeDefined();
      }
      if (line.extra !== undefined) {
        expect(reply[line.extra.key.replace(/^chat\.reply\./, "")], kind).toBeDefined();
      }
    }
  }
});

test("the table names no real shop, app or product", () => {
  const text = readFileSync(path.resolve(import.meta.dirname, "life-lines.ts"), "utf8");
  expect(leftIn(text)).toEqual([]);
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
    vars: { id: "a1", name: "Ann" },
    extra: { from: "a1", key: "chat.reply.parcelGot", delay: 4500 },
  });
});

test("a kind that needs a person and has none says nothing", () => {
  expect(lifeLine("stairs", {}, ctx)).toBeNull();
  expect(lifeLine("stairs", { id: "gone" }, ctx)).toBeNull();
});

test("someone at rest speaks when the scene names nobody", () => {
  expect(lifeLine("nap", {}, ctx)?.from).toBe("a1");
  expect(lifeLine("nap", {}, { ...ctx, resting: () => [] })?.from).toBe("reception");
});

test("a kind no table has is refused", () => {
  expect(lifeLine("handset", {}, ctx)).toBeNull();
  expect(lifeLine("__proto__", {}, ctx)).toBeNull();
  expect(lifeLine("toString", {}, ctx)).toBeNull();
});

test("the key a line is said once under changes with the period", () => {
  const a = lifeLine("altar", { every: "1200000" }, { ...ctx, now: 0 });
  const b = lifeLine("altar", { every: "1200000" }, { ...ctx, now: 1_300_000 });
  expect(a?.options.key).toBe("life:altar::0");
  expect(b?.options.key).toBe("life:altar::1");
});
