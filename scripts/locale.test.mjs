import assert from "node:assert/strict";
import { test } from "node:test";
import { OURS } from "../vendor/my-office/src/i18n/index.js";
import { areasOf, isPair, leaves, loadArea, loadLocale, loadOurs } from "./locale-words.mjs";

const SLOT = /\{(\w+)\}/g;
const TAG = /<\/?[A-Za-z][^>]*>/g;
const EMOJI =
  /\p{Extended_Pictographic}[\uFE0F\u200D\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}]*/gu;
const joined = (text, pattern) => (text.match(pattern) ?? []).join("|");
const slots = (text) =>
  [...text.matchAll(SLOT)]
    .map((m) => m[1])
    .sort()
    .join(",");

/** What a translation keeps of its English line, apart from the words. */
const kept = (text) => ({
  slots: slots(text),
  tags: joined(text, TAG),
  emoji: joined(text, EMOJI),
  breaks: (text.match(/\n/g) ?? []).length,
});

/** Lines that are the same in both languages on purpose, by dotted key (`area.key`), with why. */
const KEEP = new Set([
  // Vietnamese inscriptions and toasts retain their local spelling.
  "world.csgt.sign1",
  "world.csgt.sign2",
  "world.nhau.sign2",
  "world.nhau.say.mot",
  "world.nhau.chat.cheers",
  "life.drill.signSub",
  "life.altar.header",
  "life.altar.left",
  "life.altar.right",
  // Product names, version labels and score placeholders.
  "world.nhau.how.aqua",
  "life.liftService.stickerWhat",
  "props.gametv.score",
]);

function checkText(key, source, target) {
  assert.equal(typeof target, "string", `${key}: not a string`);
  assert.equal(target.trim() === "", source === "", `${key}: empty text differs from English`);
  assert.deepEqual(
    kept(target),
    kept(source),
    `${key}: placeholders, markup, emoji or line breaks differ from English\n  en: ${source}\n  id: ${target}`,
  );
  if (target === source && source.split(/\s+/).length >= 3 && !KEEP.has(key)) {
    assert.fail(`${key}: still English\n  ${source}`);
  }
}

function checkLeaf(key, source, target) {
  if (typeof source === "string") return checkText(key, source, target);
  if (Array.isArray(source)) {
    assert.ok(Array.isArray(target), `${key}: English has a list`);
    assert.equal(
      target.length,
      source.length,
      `${key}: ${target.length} lines, English has ${source.length}`,
    );
    return source.forEach((line, i) => checkText(`${key}[${i}]`, line, target[i]));
  }
  assert.ok(isPair(source), `${key}: English has a ${typeof source}: add a case for it`);
  assert.ok(isPair(target), `${key}: English has a plural pair`);
  assert.deepEqual(
    Object.keys(target),
    ["other"],
    `${key}: Indonesian has one plural form: only "other"`,
  );
  return checkText(`${key}.other`, source.other, target.other);
}

test("Indonesian has one plural form, so a pair has only `other`", () => {
  const rules = new Intl.PluralRules("id-ID");
  for (const n of [0, 1, 2, 5, 11, 21, 100]) assert.equal(rules.select(n), "other");
});

for (const language of ["vi", "th"]) {
  test(`${language} covers the English areas and keys except known upstream gaps`, async () => {
    assert.deepEqual(areasOf(language), areasOf("en"));
    const english = new Set(leaves(await loadLocale("en")).map(([key]) => key));
    const translated = new Set(leaves(await loadLocale(language)).map(([key]) => key));
    assert.deepEqual(
      [...translated].filter((key) => !english.has(key)),
      [],
    );
    // Upstream Thai omits the closed-session message. It uses the scene’s English fallback.
    const allowedMissing = language === "th" ? ["drawer.sessionGone"] : [];
    assert.deepEqual(
      [...english].filter((key) => !translated.has(key) && !allowedMissing.includes(key)),
      [],
    );
  });
}

for (const [name, file] of areasOf("en")) {
  test(`id/${file}.js has English's keys in order, and keeps each line's slots, markup and emoji`, async () => {
    const source = leaves(await loadArea("en", file));
    const target = leaves(await loadArea("id", file));
    assert.deepEqual(
      target.map(([key]) => key),
      source.map(([key]) => key),
      `${file}: keys differ from English`,
    );
    source.forEach(([key, value], i) => checkLeaf(`${name}.${key}`, value, target[i][1]));
  });
}

test("id's index names the same areas as English's, in the same order", async () => {
  assert.deepEqual(areasOf("id"), areasOf("en"));
  assert.deepEqual(Object.keys(await loadLocale("id")), Object.keys(await loadLocale("en")));
});

test("id/ours.js has Indonesian for each of Paseo's own strings, and for no other", async () => {
  const ours = await loadOurs("id");
  assert.ok(ours, "locales/id/ours.js is missing");
  assert.deepEqual(Object.keys(ours), Object.keys(OURS), "keys differ from OURS in the stand-in");
  for (const [key, source] of Object.entries(OURS)) checkLeaf(`ours.${key}`, source, ours[key]);
});
