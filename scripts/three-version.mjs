#!/usr/bin/env node
// Prints the three.js version a my-office checkout pins, or exits non-zero.
//
//   node scripts/three-version.mjs <my-office checkout>
//
// The value comes from another repository and is then handed to `npm install`, so it must be a
// plain x.y.z (after one leading ^ or ~). Anything else, such as a GitHub shorthand, a URL or a
// path, would make npm fetch and run code from somewhere else.
import { readFileSync } from "node:fs";
import path from "node:path";

const checkout = process.argv[2];
if (!checkout) {
  console.error("usage: three-version.mjs <my-office checkout>");
  process.exit(2);
}

const pinned = JSON.parse(readFileSync(path.join(checkout, "package.json"), "utf8")).dependencies
  ?.three;
const version = typeof pinned === "string" ? pinned.replace(/^[\^~]/, "") : "";
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`dependencies.three is ${JSON.stringify(pinned)}, not a plain x.y.z version`);
  process.exit(1);
}
console.log(version);
