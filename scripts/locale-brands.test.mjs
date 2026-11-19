import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { BRANDS, findBrands, replaceBrands } from "./locale-brands.mjs";
import { ROOT, leaves, loadLocale, otherLanguages, stringsOf } from "./locale-words.mjs";

test("a made-up name is not itself a real one", () => {
  for (const { generic } of BRANDS) {
    assert.deepEqual(findBrands(generic), [], generic);
  }
});

test("a brand may touch Thai letters, but an identifier, ordinary word or country name stays intact", () => {
  assert.deepEqual(findBrands("ไปMixueไอศกรีม"), ["Mixue"]);
  assert.deepEqual(findBrands("shipper GrabFood tới rồi"), ["GrabFood"]);
  assert.deepEqual(findBrands("trà sữa Phúc Long"), ["Phúc Long"]);
  assert.deepEqual(findBrands("Shopee, TikTok and Panadol"), ["Shopee", "Panadol", "TikTok"]);
  assert.deepEqual(findBrands("grab a coffee"), []);
  assert.deepEqual(findBrands("CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM"), []);
  assert.deepEqual(findBrands("mixueHot: 'x'"), []);
  assert.deepEqual(findBrands("traSuaPhucLong: 'x'"), []);
  assert.deepEqual(findBrands("{ mixue: 'x' }"), []);
});

test("a replacement keeps the text round the name and is done once", () => {
  const once = replaceBrands("Em ra Mixue mua kem, rồi gọi GrabBike 🍦");
  assert.equal(once, "Em ra Frosty Cone mua kem, rồi gọi Ridely Bike 🍦");
  assert.equal(replaceBrands(once), once);
});

test("no locale names a real brand in a line it shows", async () => {
  const hits = [];
  for (const language of ["en", ...otherLanguages()]) {
    for (const [key, value] of leaves(await loadLocale(language))) {
      for (const text of stringsOf(value)) {
        for (const name of findBrands(text)) hits.push(`${language} ${key}: ${name}`);
      }
    }
  }
  assert.deepEqual(hits, []);
});

test("a vendored locale file is upstream's text unless it says it was changed", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(ROOT, "vendor/my-office/MANIFEST.json"), "utf8"),
  );
  const changed = [];
  for (const [rel, sha] of Object.entries(manifest.files)) {
    if (!rel.startsWith("i18n/locales/")) continue;
    const text = readFileSync(path.join(ROOT, "vendor/my-office/src", rel), "utf8");
    if (createHash("sha256").update(text).digest("hex") !== sha && !text.includes("// PASEO:"))
      changed.push(rel);
  }
  assert.deepEqual(changed, []);
});
