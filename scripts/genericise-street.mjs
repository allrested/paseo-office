#!/usr/bin/env node
// Swaps the real names of shops, apps and products in the vendored scene for made-up ones, through
// the one table in street-brands.mjs. It covers every vendored file, not only the street's: every
// .js under vendor/my-office/src/ and shared/upstream/ (never three.js, never the table itself).
// Run it again after taking a newer upstream: a file taken later is covered the same way.
//
//   node scripts/genericise-street.mjs [--check] [--files <file> ...]
//
// It writes the changed files, each with a `// PASEO: names` note on its first line, then checks
// them. A file is clean exactly when the swap would change nothing in it: `--check` writes
// nothing, lists on stderr each file the swap would still change and what it would change there,
// and exits 1 when there is one.
//
// The swap reads a file as JavaScript. In strings, comments, template text and regular
// expressions a name becomes the made-up name as it is. In code it becomes something that still
// parses, the same in every file: an object key or a property is quoted where the made-up name is
// not an identifier (`{ 'Pebble Mart': 1 }`, `x['Pebble Mart']`), and any other identifier takes
// the made-up name with `_` for its spaces (`NAVY_COFFEE_HOUSE`).
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
/**
 * A whole word: no letter or digit (of any script) right before or after it. The literal comes
 * first and the look-behind after it, so a long minified line is searched fast.
 */
const whole = (text) => `${escape(text)}(?<![\\p{L}\\p{N}]${escape(text)})(?![\\p{L}\\p{N}])`;
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

function nameSource(form) {
  let source = whole(form.real);
  if (form.next) source += `(?=\\s+(?:${words(form.next)}))`;
  if (form.notNext) source += `(?!\\s+(?:${words(form.notNext)}))`;
  return source;
}

/** The made-up name as an identifier: `_` for each run of other characters. */
const identifier = (name) => name.replace(/[^\w$]+/g, "_").replace(/^(?=\d)/, "_");

/** Each brand's forms with their matchers, longest name first, so a name inside a longer one waits for it. */
const NAMES = BRANDS.flatMap((brand) =>
  forms(brand).map((form) => ({
    brand,
    form,
    re: new RegExp(nameSource(form), "gu"),
    // In code: with the `.` or `?.` of a property access before it, if there is one.
    code: new RegExp(`(\\?\\.|(?<!\\.)\\.)?${nameSource(form)}`, "gu"),
    id: identifier(form.madeUp),
  })),
).sort((a, b) => b.form.real.length - a.form.real.length);

/** A name in code: a property, an object key, or another identifier. */
function inCode({ form, id }) {
  const plain = id === form.madeUp;
  return (match, dot, offset, code) => {
    if (dot) return plain ? `${dot}${id}` : `${dot === "?." ? "?." : ""}['${form.madeUp}']`;
    const key =
      /^\s*:/.test(code.slice(offset + match.length)) &&
      /(?:^|[{,])\s*$/.test(code.slice(Math.max(0, offset - 200), offset));
    return key && !plain ? `'${form.madeUp}'` : id;
  };
}

/**
 * A key as an identifier or a string: not inside a longer word, a path (`shop-frosty.js`) or a file
 * name, but at the head of a camelCase compound (`frostyAsk`); a key with a capital (`JadeTea`) also
 * as a compound's tail. A key that is a file name's stem (`'aqua.svg'`, `'brands/frosty.svg'`) is
 * renamed too. A `quotedOnly` key is renamed as a whole quoted string, unless `cursor` comes before
 * it in the statement, or as an object key (after `{`, `,` or at a line's start). A key with
 * `within` is renamed only inside those exact pieces of text.
 */
function keyMatchers({ from, quotedOnly, within }) {
  const key = escape(from);
  if (within) {
    return within.map((text) => {
      const at = text.indexOf(from);
      const [head, tail] = [text.slice(0, at), text.slice(at + from.length)];
      return new RegExp(`${key}(?<=${escape(head)}${key})(?=${escape(tail)})`, "g");
    });
  }
  if (quotedOnly) {
    return [
      new RegExp(`${key}(?<=(['"\`])${key})(?=\\1)(?<!cursor[^\\n;]*${key})`, "g"),
      new RegExp(`${key}(?<=(?:^|[{,])[ \\t]*${key})(?=\\s*:)`, "gm"),
    ];
  }
  const before = /^\p{Lu}/u.test(from) ? "[\\p{Lu}\\p{N}_$/-]" : "[\\p{L}\\p{N}_$/-]";
  return [
    new RegExp(`${key}(?<!${before}${key})(?![\\p{Ll}\\p{N}_$-])`, "gu"),
    new RegExp(`${key}(?<=/${key})(?=\\.(?:svg|png)\\b)`, "g"),
  ];
}

const KEYS = BRANDS.flatMap((brand) => brand.keys ?? []).map((key) => ({
  from: key.from,
  to: key.to,
  res: keyMatchers(key),
}));
const PHRASE_RES = PHRASES.map(({ from, to }) => ({ re: new RegExp(whole(from), "gu"), to }));

const lineEnd = (src, i) => (src.indexOf("\n", i) + 1 || src.length + 1) - 1;
const blockEnd = (src, i) => (src.indexOf("*/", i + 2) + 1 || src.length - 1) + 1;

function quotedEnd(src, i) {
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === "\\") j++;
    else if (src[j] === src[i] || src[j] === "\n") return j + 1;
  }
  return src.length;
}

function regexEnd(src, i) {
  let inClass = false;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") j++;
    else if (c === "\n") return j;
    else if (c === "[" || c === "]") inClass = c === "[";
    else if (c === "/" && !inClass) {
      while (/[a-z]/i.test(src[j + 1] ?? "")) j++;
      return j + 1;
    }
  }
  return src.length;
}

/** Template text from i (after the backtick or a substitution's `}`): its end, and whether `${` ends it. */
function templateEnd(src, i) {
  for (let j = i; j < src.length; j++) {
    if (src[j] === "\\") j++;
    else if (src[j] === "`") return [j + 1, false];
    else if (src[j] === "$" && src[j + 1] === "{") return [j + 2, true];
  }
  return [src.length, false];
}

/** A `/` starts a regular expression after an operator, a bracket, a keyword or nothing. */
const REGEX_AFTER =
  /(?:^|[(,=:[!&|?{};+\-*%<>~^])$|(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/;

/** Where the text (a string, a comment or a regular expression) starting at i ends; -1 for code. */
function textEnd(src, i, before) {
  const c = src[i];
  const next = src[i + 1];
  if (c === "'" || c === '"') return quotedEnd(src, i);
  if (c === "/" && next === "/") return lineEnd(src, i);
  if (c === "/" && next === "*") return blockEnd(src, i);
  if (c === "#" && next === "!" && i === 0) return lineEnd(src, i);
  if (c === "/" && REGEX_AFTER.test(before)) return regexEnd(src, i);
  return -1;
}

/** JavaScript source cut into code and text (strings, comments, template text, regular expressions). */
export function pieces(src) {
  const out = [];
  const open = []; // the brace depth inside each open template substitution
  let from = 0;
  let last = -1; // the last character of code or of a value, for the regular expression rule
  const cut = (end, code) => {
    if (end > from) out.push({ code, text: src.slice(from, end) });
    from = end;
  };
  const template = (i) => {
    const [end, opens] = templateEnd(src, i + 1);
    cut(i, true);
    cut(end, false);
    if (opens) open.push(0);
    else last = end - 1;
    return end;
  };
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    const end = textEnd(src, i, src.slice(Math.max(0, last - 9), last + 1));
    if (end !== -1) {
      cut(i, true);
      cut(end, false);
      if (c !== "/" || (src[i + 1] !== "/" && src[i + 1] !== "*")) last = end - 1;
      i = end;
    } else if (c === "`" || (c === "}" && open.at(-1) === 0)) {
      if (c === "}") open.pop();
      i = template(i);
    } else {
      if (open.length > 0 && (c === "{" || c === "}")) open[open.length - 1] += c === "{" ? 1 : -1;
      if (!/\s/.test(c)) last = i;
      i++;
    }
  }
  cut(src.length, true);
  return out;
}

function swapText(text) {
  let out = text;
  for (const { re, to } of PHRASE_RES) out = out.replace(re, () => to);
  for (const name of NAMES) out = out.replace(name.re, () => name.form.madeUp);
  return out;
}

function swapCode(code) {
  let out = code;
  for (const name of NAMES) out = out.replace(name.code, inCode(name));
  return out;
}

/** The JavaScript source with every phrase, name and key of the table swapped for its made-up one. */
export function swap(text) {
  let out = pieces(text)
    .map((piece) => (piece.code ? swapCode(piece.text) : swapText(piece.text)))
    .join("");
  for (const { to, res } of KEYS) for (const re of res) out = out.replace(re, () => to);
  return out;
}

const found = (re, text) => new RegExp(re.source, re.flags).test(text);

/**
 * What the swap would still change in the text: the table's real names (in table order), then
 * the real keys (in table order), each once. Empty exactly when `swap(text) === text`.
 */
export function leftIn(text) {
  const names = new Set(NAMES.filter(({ re }) => found(re, text)).map(({ brand }) => brand.real));
  const keys = KEYS.filter(({ res }) => res.some((re) => found(re, text))).map(({ from }) => from);
  return [...BRANDS.map((brand) => brand.real).filter((real) => names.has(real)), ...new Set(keys)];
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
    if (swap(out) !== out) {
      failed = true;
      console.error(`${path.relative(ROOT, file)}: ${leftIn(out).join(", ")}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
