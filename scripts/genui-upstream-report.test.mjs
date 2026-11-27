import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "genui-upstream-report.mjs");
const git = (cwd, ...args) =>
  execFileSync(
    "git",
    [
      "-C",
      cwd,
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { encoding: "utf8" },
  ).trim();
const sha = (text) => createHash("sha256").update(text).digest("hex");

let root;
let checkout;
let first;
let second;

const manifestFor = (commit, files) => {
  const file = path.join(root, `manifest-${commit.slice(0, 7)}.json`);
  writeFileSync(file, JSON.stringify({ upstream: { commit, version: "0.3.3" }, files }));
  return file;
};
const run = (manifest) =>
  JSON.parse(
    execFileSync("node", [SCRIPT, "--upstream", checkout, "--manifest", manifest], {
      encoding: "utf8",
    }),
  );

describe("genui-upstream-report", () => {
  before(() => {
    root = mkdtempSync(path.join(tmpdir(), "genui-upstream-"));
    checkout = path.join(root, "genui");
    mkdirSync(path.join(checkout, "shared"), { recursive: true });
    writeFileSync(path.join(checkout, "package.json"), JSON.stringify({ version: "0.3.3" }));
    writeFileSync(path.join(checkout, "shared/a.ts"), "a1");
    writeFileSync(path.join(checkout, "shared/b.ts"), "b1");
    git(checkout, "init", "-q");
    git(checkout, "add", "-A");
    git(checkout, "commit", "-q", "-m", "first");
    first = git(checkout, "rev-parse", "HEAD");
    writeFileSync(path.join(checkout, "shared/a.ts"), "a2");
    writeFileSync(path.join(checkout, "package.json"), JSON.stringify({ version: "0.4.0" }));
    git(checkout, "rm", "-q", "shared/b.ts");
    git(checkout, "add", "-A");
    git(checkout, "commit", "-q", "-m", "second");
    second = git(checkout, "rev-parse", "HEAD");
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it("reports no move, no changed file and an empty body when the checkout is at the manifest's commit", () => {
    const report = run(manifestFor(second, { "shared/a.ts": sha("a2") }));
    assert.equal(report.moved, false);
    assert.deepEqual(report.changed, []);
    assert.deepEqual(report.removed, []);
    assert.equal(report.body, "");
  });

  it("names the vendored files that changed and the ones upstream dropped", () => {
    const report = run(manifestFor(first, { "shared/a.ts": sha("a1"), "shared/b.ts": sha("b1") }));
    assert.equal(report.moved, true);
    assert.equal(report.from, first);
    assert.equal(report.to, second);
    assert.equal(report.version, "0.4.0");
    assert.deepEqual(report.changed, ["shared/a.ts"]);
    assert.deepEqual(report.removed, ["shared/b.ts"]);
    assert.ok(report.body.startsWith("<!-- paseo-office-genui-upstream -->"));
    assert.ok(report.body.includes(`compare/${first}...${second}`));
  });
});
