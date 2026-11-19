#!/usr/bin/env node
// Swaps the real names of shops, apps and products in the vendored scene for made-up ones, through
// the one table in street-brands.mjs. It covers every vendored file, not only the street's: every
// .js under vendor/my-office/src/ and shared/upstream/ (never three.js, never the table itself).
// Run it again after taking a newer upstream: a file taken later is covered the same way.
//
//   node scripts/genericise-street.mjs [--check] [--files <file> ...]
//
// It writes the changed files, each with a `// PASEO: names` note on its first line, then checks
// them. `--check` writes nothing: it lists each file that still carries a real name, on stderr,
// and exits 1 when there is one.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRANDS, PHRASES } from "./street-brands.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const TABLE = path.join(HERE, "street-brands.mjs");
const DIRS = ["vendor/my-office/src", "shared/upstream"];
export const NOTE =
  "// PASEO: names of real shops, apps and products are made-up ones (scripts/genericise-street.mjs).";

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A whole word: no letter or digit (of any script) right before or after it. */
const whole = (text) => `(?<![\\p{L}\\p{N}])${escape(text)}(?![\\p{L}\\p{N}])`;
const words = (list) => list.map((word) => whole(word)).join("|");

/** The forms a name is written in: as in the table, and in all caps. */
function forms(brand) {
  const as = {
    real: brand.real,
    madeUp: brand.madeUp,
    next: brand.followedBy,
    notNext: brand.notFollowedBy,
  };
  const caps = {
    real: brand.real.toUpperCase(),
    madeUp: brand.madeUp.toUpperCase(),
    next: brand.followedBy?.map((word) => word.toUpperCase()),
    notNext: brand.notFollowedBy?.map((word) => word.toUpperCase()),
  };
  return caps.real === as.real ? [as] : [as, caps];
}

function nameMatcher(form) {
  let source = whole(form.real);
  if (form.next) source += `(?=\\s+(?:${words(form.next)}))`;
  if (form.notNext) source += `(?!\\s+(?:${words(form.notNext)}))`;
  return new RegExp(source, "gu");
}

/** Each brand's forms with their matcher, longest name first so that GrabFood goes before Grab. */
const NAMES = BRANDS.flatMap((brand) =>
  forms(brand).map((form) => ({ brand, form, re: nameMatcher(form) })),
).sort((a, b) => b.form.real.length - a.form.real.length);

/**
 * A key as an identifier or a string: not inside a longer word, a path (`shop-mixue.js`) or a file
 * name, but at the head of a camelCase compound (`mixueAsk`); a key with a capital (`PhucLong`) also
 * as a compound's tail. A key that is a file name's stem (`'xanh-sm.svg'`, `'brands/mixue.svg'`)
 * is renamed too.
 */
function keyMatchers({ from, quotedOnly }) {
  const key = escape(from);
  if (quotedOnly) {
    return [
      new RegExp(`(?<!cursor\\s*[:=]\\s*['"\`])(?<=(['"\`]))${key}(?=\\1)`, "g"),
      new RegExp(`(?<=^|[{,\\s])${key}(?=\\s*:)`, "gm"),
    ];
  }
  const before = /^\p{Lu}/u.test(from) ? "[\\p{Lu}\\p{N}_$/-]" : "[\\p{L}\\p{N}_$/-]";
  return [
    new RegExp(`(?<!${before})${key}(?![\\p{Ll}\\p{N}_$-])`, "gu"),
    new RegExp(`(?<=/)${key}(?=\\.(?:svg|png)\\b)`, "g"),
  ];
}

const KEYS = BRANDS.flatMap((brand) => brand.keys ?? [])
  .sort((a, b) => b.from.length - a.from.length)
  .map((key) => ({ to: key.to, res: keyMatchers(key) }));
const PHRASE_RES = PHRASES.map(({ from, to }) => ({ re: new RegExp(whole(from), "gu"), to }));

/** The text with every phrase, name and key of the table swapped for its made-up one. */
export function swap(text) {
  let out = text;
  for (const { re, to } of PHRASE_RES) out = out.replace(re, () => to);
  for (const { form, re } of NAMES) out = out.replace(re, () => form.madeUp);
  for (const { to, res } of KEYS) for (const re of res) out = out.replace(re, () => to);
  return out;
}

/** The table's real names still in the text, in table order, found as `swap` finds them. */
export function leftIn(text) {
  const found = new Set(
    NAMES.filter(({ re }) => new RegExp(re.source, re.flags).test(text)).map(
      ({ brand }) => brand.real,
    ),
  );
  return BRANDS.map((brand) => brand.real).filter((real) => found.has(real));
}

/** The text as this script leaves a file: swapped, with the note on its first line when it changed. */
export function named(text) {
  const out = swap(text);
  if (out === text || out.includes("PASEO: names")) return out;
  return `${NOTE}\n${out}`;
}

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(file);
    return entry.name.endsWith(".js") ? [file] : [];
  });
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const at = args.indexOf("--files");
  const files =
    at === -1
      ? DIRS.flatMap((dir) => jsFiles(path.join(ROOT, dir))).sort()
      : args
          .slice(at + 1)
          .filter((arg) => !arg.startsWith("--"))
          .map((file) => path.resolve(file));
  let failed = false;
  for (const file of files) {
    if (file === TABLE) continue;
    const text = readFileSync(file, "utf8");
    const out = check ? text : named(text);
    if (out !== text) {
      writeFileSync(file, out);
      console.log(`named: ${path.relative(ROOT, file)}`);
    }
    const left = leftIn(out);
    if (left.length > 0) {
      failed = true;
      console.error(`${path.relative(ROOT, file)}: ${left.join(", ")}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
