import { expect, test } from "vitest";
import { WORLD_SCRIPT } from "./world.generated.js";
import { WORLD_WORDS } from "./words.generated.js";
import { embeddedWorldWords } from "./world-words.js";
import { WORDS_LANGUAGES } from "../shared/scene-language.js";
// @ts-expect-error Build-time locale files are plain JavaScript.
import { loadLocale, loadOurs } from "../scripts/locale-words.mjs";
// @ts-expect-error Build-time brand checks are plain JavaScript.
import { findBrands } from "../scripts/locale-brands.mjs";

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(strings);
}
test("the host has exactly the supported downloads", async () => {
  expect(Object.keys(WORLD_WORDS).sort()).toEqual([...WORDS_LANGUAGES].sort());
  await expect(embeddedWorldWords().read("fr")).rejects.toThrow("The office has no words for fr");
});
test.each(WORDS_LANGUAGES)(
  "%s contains its source text and stays outside the scene bundle",
  async (language) => {
    const text = await embeddedWorldWords().read(language);
    const dict = await loadLocale(language);
    const ours = await loadOurs(language);
    expect(JSON.parse(text)).toEqual(ours === null ? { dict } : { dict, ours });
    expect(Buffer.byteLength(text)).toBeGreaterThan(20_000);
    expect(Buffer.byteLength(text)).toBeLessThan(language === "th" ? 150_000 : 100_000);
    const lines = strings(JSON.parse(text));
    expect(lines.flatMap((line) => findBrands(line))).toEqual([]);
    const english = new Set(strings(await loadLocale("en")));
    const unescaped = WORLD_SCRIPT.replace(/\\u([\da-f]{4})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
    for (const line of lines.filter((s) => s.length >= 12 && !english.has(s)).slice(0, 40)) {
      expect(unescaped.includes(line), line).toBe(false);
    }
    if (language === "th") expect(/[\u0e00-\u0e7f]/u.test(unescaped)).toBe(false);
  },
);
