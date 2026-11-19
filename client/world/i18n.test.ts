import { afterEach, expect, test } from "vitest";
import {
  OURS,
  createT,
  lang,
  locale,
  num,
  setLanguage,
  t,
  // @ts-expect-error vendored JavaScript has no declarations
} from "../../vendor/my-office/src/i18n/index.js";
// @ts-expect-error vendored JavaScript has no declarations
import vi from "../../vendor/my-office/src/i18n/locales/vi/index.js";
// @ts-expect-error vendored JavaScript has no declarations
import th from "../../vendor/my-office/src/i18n/locales/th/index.js";

const words = (dict: object, ours?: object) => JSON.stringify({ dict, ours });
afterEach(() => setLanguage("en"));

test("English interpolates, pluralizes, formats numbers and reports missing keys", () => {
  expect([lang(), locale(), num(1234.5, 1)]).toEqual(["en", "en-US", "1,234.5"]);
  expect(createT()("time.min", { n: 3 })).toBe("3 min");
  expect([1, 2].map((n) => t("time.day", { n }))).toEqual(["1 day", "2 days"]);
  expect(t("missing.key")).toBe("missing.key");
  expect(t("missing.key", null, "list")).toEqual([]);
});

test("loaded dictionary selects its locale and can return to English", () => {
  setLanguage("vi", words(vi));
  expect([lang(), locale(), num(1234.5, 1), t("time.day", { n: 2 })]).toEqual([
    "vi",
    "vi-VN",
    "1.234,5",
    "2 ngày",
  ]);
  setLanguage("th", words(th));
  expect([lang(), locale()]).toEqual(["th", "th-TH"]);
  expect(t("time.day", { n: 2 })).toMatch(/[\u0e00-\u0e7f]/);
  setLanguage("en");
  expect(t("time.day", { n: 2 })).toBe("2 days");
});

test("partial languages fall back, fill host slots and strip decorative emoji", () => {
  setLanguage("vi", words({ x: { a: "{Mac} ở {mac} 🎉", b: ["a 🎉", "b"], c: "🎉" } }));
  expect(t("time.day", { n: 1 })).toBe("1 day");
  expect(t("x.a")).toBe("Host ở host");
  expect(t("x.b", null, "list")).toEqual(["a", "b"]);
  expect(t("x.c")).toBe("🎉");
});

test("the port's overrides take precedence in each language", () => {
  const vars = { n: 2, label: "x", key: "K", title: "T" };
  const lines = () =>
    Object.keys(OURS).map((k) => (Array.isArray(OURS[k]) ? t(k, vars, "list") : t(k, vars)));
  const expected = lines();
  for (const [language, dict] of [
    ["vi", vi],
    ["th", th],
  ]) {
    setLanguage(language, words(dict));
    expect(lines()).toEqual(expected);
  }
  setLanguage(
    "id",
    words({}, { "people.handOver": "Tugas baru untukmu", "world.dev.lost": { other: "{n} agen" } }),
  );
  expect(t("people.handOver")).toBe("Tugas baru untukmu");
  expect(t("world.dev.lost", { n: 1 })).toBe("1 agen");
  expect(t("paseo.leisure.nap")).toBe("Quick nap");
});

test.each([
  ["vi", "not json"],
  ["vi", undefined],
  ["xx", words({})],
  ["vi", "{}"],
  ["vi", '{"dict":[]}'],
])("invalid language data falls back to English", (language, data) => {
  setLanguage("vi", words(vi));
  setLanguage(language, data);
  expect(lang()).toBe("en");
});

test("all Vietnamese and Thai display lines omit decorative emoji", () => {
  function check(key: string, value: unknown) {
    if (value && typeof value === "object" && !Array.isArray(value) && !("other" in value)) {
      for (const [field, child] of Object.entries(value))
        check(key ? key + "." + field : field, child);
      return;
    }
    const displayed: string[] = Array.isArray(value) ? t(key, null, "list") : [t(key, { n: 2 })];
    for (const line of displayed) {
      if (/[\p{L}\p{N}]/u.test(line))
        expect(line, key).not.toMatch(/(?![©®™])\p{Extended_Pictographic}/u);
    }
  }
  for (const [language, dict] of [
    ["vi", vi],
    ["th", th],
  ]) {
    setLanguage(language, words(dict));
    check("", dict);
  }
});
