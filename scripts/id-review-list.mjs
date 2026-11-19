#!/usr/bin/env node
// Prints the Indonesian lines most worth a native speaker's look, as Markdown: first the lines the
// translator noted in scripts/id-review-notes.json, then every other line longer than LONG characters.
//   node scripts/id-review-list.mjs > /tmp/id-review.md
import { readFileSync } from "node:fs";
import path from "node:path";
import { OURS } from "../vendor/my-office/src/i18n/index.js";
import { ROOT, areasOf, isPair, leaves, loadArea, loadOurs } from "./locale-words.mjs";

const LONG = 110;
const notes = JSON.parse(readFileSync(path.join(ROOT, "scripts/id-review-notes.json"), "utf8"));

/** The lines of one leaf as [suffix, English, Indonesian]. */
function units(source, target) {
  if (typeof source === "string") return [["", source, target]];
  if (Array.isArray(source)) return source.map((line, i) => [`[${i}]`, line, target[i]]);
  if (isPair(source)) return [["", source.other, target.other]];
  return [];
}

const rows = new Map();
for (const [name, file] of areasOf("en")) {
  const english = leaves(await loadArea("en", file));
  const indonesian = leaves(await loadArea("id", file));
  english.forEach(([key, value], i) => {
    for (const [suffix, en, id] of units(value, indonesian[i][1]))
      rows.set(`${name}.${key}${suffix}`, { en, id });
  });
}
const ours = await loadOurs("id");
for (const [key, value] of Object.entries(OURS)) {
  for (const [suffix, en, id] of units(value, ours[key]))
    rows.set(`ours.${key}${suffix}`, { en, id });
}

const unknown = Object.keys(notes).filter((key) => !rows.has(key));
if (unknown.length > 0) throw new Error(`notes for lines that do not exist: ${unknown.join(", ")}`);

const show = (key, row, why) =>
  [`- \`${key}\`${why ? `: ${why}` : ""}`, `  - EN: ${row.en}`, `  - ID: ${row.id}`].join("\n");
const noted = Object.keys(notes).map((key) => show(key, rows.get(key), notes[key]));
const long = [...rows]
  .filter(([key, row]) => !(key in notes) && row.id.length > LONG)
  .sort((a, b) => b[1].id.length - a[1].id.length)
  .map(([key, row]) => show(key, row, `${row.id.length} characters`));
console.log(
  `# Indonesian lines to read first\n\n${rows.size} lines in all. ${noted.length} noted by the translator, ${long.length} longer than ${LONG} characters.\n`,
);
console.log(
  `## Noted\n\n${noted.join("\n") || "None."}\n\n## Long\n\n${long.join("\n") || "None."}`,
);
