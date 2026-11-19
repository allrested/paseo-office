// The importer already replaces names and identifiers with the street table. Thai captions can
// put a name directly beside Thai letters, so also check those boundaries in locale text.
import { BRANDS as STREET_BRANDS } from "./street-brands.mjs";

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function patternFor(brand, real) {
  const boundary = "(?![A-Za-z0-9_])";
  let source = `(?<![A-Za-z0-9_])${escape(real)}${boundary}(?!['"]?\\s*:)`;
  const words = (list) =>
    list.map((word) => escape(real === brand.real ? word : word.toUpperCase())).join("|");
  if (brand.followedBy) source += `(?=\\s+(?:${words(brand.followedBy)})${boundary})`;
  if (brand.notFollowedBy) source += `(?!\\s+(?:${words(brand.notFollowedBy)})${boundary})`;
  return new RegExp(source, "gu");
}

export const BRANDS = STREET_BRANDS.flatMap((brand) => {
  const forms = [[brand.real, brand.madeUp]];
  if (brand.real !== brand.real.toUpperCase())
    forms.push([brand.real.toUpperCase(), brand.madeUp.toUpperCase()]);
  return forms.map(([real, generic]) => ({
    name: brand.real,
    pattern: patternFor(brand, real),
    generic,
  }));
});

export function findBrands(text) {
  const normalized = text.normalize("NFC");
  return BRANDS.flatMap(({ name, pattern }) =>
    Array.from(normalized.matchAll(pattern), () => name),
  );
}

export function replaceBrands(text) {
  for (const { pattern, generic } of BRANDS) text = text.replace(pattern, () => generic);
  return text;
}
