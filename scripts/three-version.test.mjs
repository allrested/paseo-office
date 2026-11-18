import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "three-version.mjs");

let root;
const versionOf = (three) => {
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify(three === undefined ? { dependencies: {} } : { dependencies: { three } }),
  );
  return spawnSync("node", [SCRIPT, root], { encoding: "utf8" });
};

describe("three-version", () => {
  before(() => {
    root = mkdtempSync(path.join(tmpdir(), "three-version-"));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it("prints a plain version", () => {
    const run = versionOf("0.160.0");
    assert.equal(run.status, 0);
    assert.equal(run.stdout.trim(), "0.160.0");
  });

  it("strips one leading caret or tilde", () => {
    assert.equal(versionOf("^0.160.0").stdout.trim(), "0.160.0");
    assert.equal(versionOf("~0.160.1").stdout.trim(), "0.160.1");
  });

  for (const [name, value] of [
    ["a GitHub shorthand", "0xevil/repo"],
    ["a URL", "https://example.com/three.tgz"],
    ["a path", "../three"],
    ["an empty value", ""],
    ["a range", ">=0.160.0"],
    ["a prerelease", "0.160.0-beta.1"],
    ["a doubled prefix", "^^0.160.0"],
    ["a missing field", undefined],
    ["a trailing newline", "0.160.0\n"],
    ["a trailing space", "0.160.0 "],
    ["a tag", "latest"],
    ["a workspace reference", "workspace:*"],
    ["an alias", "npm:evil@1.0.0"],
  ]) {
    it(`refuses ${name}, with a message and no output`, () => {
      const run = versionOf(value);
      assert.notEqual(run.status, 0);
      assert.equal(run.stdout, "");
      assert.match(run.stderr, /three/);
    });
  }
});
