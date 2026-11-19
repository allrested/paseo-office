// What the locale tests, the brand script and the words build read: the locale folders under the
// vendored i18n. A locale's index.js is a folder's entry; `ours.js` (Indonesian only) is the port's
// own wording of the stand-in's OURS strings.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const LOCALES_DIR = path.join(ROOT, "vendor/my-office/src/i18n/locales");
export const STAND_IN = path.join(ROOT, "vendor/my-office/src/i18n/index.js");

export function otherLanguages() {
  return readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "en")
    .map((entry) => entry.name)
    .sort();
}

export const localeFile = (language, file) => path.join(LOCALES_DIR, language, `${file}.js`);
const load = async (file) => (await import(pathToFileURL(file).href)).default;
export const loadLocale = (language) => load(localeFile(language, "index"));
export const loadArea = (language, file) => load(localeFile(language, file));
export async function loadOurs(language) {
  const file = localeFile(language, "ours");
  return existsSync(file) ? load(file) : null;
}

/** The areas an index.js imports, as [name, file], in order. */
export function areasOf(language) {
  const text = readFileSync(localeFile(language, "index"), "utf8");
  return [...text.matchAll(/^import (\w+) from '\.\/(\w[\w-]*)\.js';/gm)].map((m) => [m[1], m[2]]);
}

export const isPair = (value) =>
  typeof value === "object" &&
  value !== null &&
  typeof value.other === "string" &&
  Object.keys(value).every(
    (key) => key === "other" || (key === "one" && typeof value.one === "string"),
  );

/** Every leaf as [dotted path, value], upstream's rule: a { one, other } pair and a list are one leaf. */
export function leaves(object, prefix = "") {
  return Object.entries(object).flatMap(([key, value]) =>
    typeof value === "object" && value !== null && !Array.isArray(value) && !isPair(value)
      ? leaves(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]],
  );
}

export function stringsOf(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
  if (isPair(value)) return [value.one, value.other].filter((item) => typeof item === "string");
  return [];
}

/** A locale travels as JSON: no function, no undefined. */
export function assertPlain(value, where = "locale") {
  if (
    typeof value === "function" ||
    typeof value === "undefined" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    throw new Error(`${where} is a ${typeof value}: a locale must be plain data`);
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, inner] of Object.entries(value)) assertPlain(inner, `${where}.${key}`);
  }
}
