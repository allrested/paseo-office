// The Paseo app on a phone runs Hermes, which lacks the newer array and collection methods
// listed below. A call to one is only a TypeError when it runs, but `shared/settings.ts` is
// parsed at module top level, so one throw while the client bundle loads fails the whole
// plugin ("undefined is not a function"). The server side runs in Node on the host and may use
// these freely, so this guard covers only what the app loads: index.client.tsx, client/, shared/.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

const banned: { name: string; pattern: RegExp }[] = [
  ".toSorted(",
  ".toReversed(",
  ".toSpliced(",
  ".findLast(",
  ".findLastIndex(",
  "Object.groupBy(",
  "Map.groupBy(",
  "Array.fromAsync(",
  ".intersection(",
  ".difference(",
  ".symmetricDifference(",
  ".isSubsetOf(",
  ".isSupersetOf(",
  ".isDisjointFrom(",
].map((name) => ({ name, pattern: new RegExp(name.replace(/[.()]/g, "\\$&")) }));
// `z.union(` is zod's schema combinator, not Set#union.
banned.push({ name: ".union(", pattern: /(?<!\bz)\.union\(/ });
// The copying Array#with takes (index, value); a one-argument `.with(` is something else.
banned.push({ name: ".with(index, value)", pattern: /\.with\([^()]*,/ });

function appSideFiles(): string[] {
  const out = ["index.client.tsx"];
  const walk = (dir: string) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (rel !== path.join("shared", "upstream")) walk(rel);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push(rel);
      }
    }
  };
  walk("client");
  walk("shared");
  return out;
}

describe("engine compatibility of the app's side", () => {
  it("calls no array or collection method the phone's engine lacks", () => {
    const hits: string[] = [];
    for (const file of appSideFiles()) {
      readFileSync(path.join(root, file), "utf8")
        .split("\n")
        .forEach((line, index) => {
          for (const { name, pattern } of banned) {
            if (pattern.test(line)) hits.push(`${file}:${index + 1} uses ${name}`);
          }
        });
    }
    expect(hits).toEqual([]);
  });
});
