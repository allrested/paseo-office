#!/usr/bin/env node
// Replaces real brand names in the vendored locale files (English, Vietnamese, Thai) with made-up
// ones and puts a `// PASEO:` line at the head of each file it changes. The import tool then keeps
// the file instead of overwriting it. `--check` changes nothing and exits 1 when a name is left.
//
// To take a newer upstream: delete the changed locale files, run the import tool, run this again.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { findBrands, replaceBrands } from "./locale-brands.mjs";
import { LOCALES_DIR } from "./locale-words.mjs";

const CHECK = process.argv.includes("--check");
let files = 0;
let names = 0;
for (const language of ["en", "vi", "th"]) {
  const dir = path.join(LOCALES_DIR, language);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".js") && f !== "index.js")) {
    const full = path.join(dir, file);
    const text = readFileSync(full, "utf8");
    const found = [...new Set(findBrands(text))];
    if (found.length === 0) continue;
    files += 1;
    names += findBrands(text).length;
    console.log(`${language}/${file}: ${found.join(", ")}`);
    if (CHECK) continue;
    const note = `// PASEO: real brand names replaced by made-up ones (scripts/replace-locale-brands.mjs).\n`;
    writeFileSync(full, note + replaceBrands(text));
  }
}
console.log(`${names} names in ${files} files${CHECK ? "" : ", replaced"}`);
if (CHECK && files > 0) process.exit(1);
