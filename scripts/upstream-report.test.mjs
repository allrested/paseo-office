import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "upstream-report.mjs");
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

let root;
let checkout;
let first;
let second;
let manifestAt;

const manifestFor = (commit) => {
  const file = path.join(root, `manifest-${commit.slice(0, 7)}.json`);
  writeFileSync(file, JSON.stringify({ upstream: { commit, version: "0.6.0" } }));
  return file;
};

const run = (...args) =>
  JSON.parse(execFileSync("node", [SCRIPT, "--upstream", checkout, ...args], { encoding: "utf8" }));

// A stand-in for the import tool: prints `body` to stdout, then exits with `status`.
let toolCount = 0;
const toolPrinting = (body, status = 0) => {
  const file = path.join(root, `tool-${toolCount++}.mjs`);
  writeFileSync(
    file,
    `process.stdout.write(${JSON.stringify(body)}); process.exitCode = ${status};`,
  );
  return file;
};
const withTool = (tool, ...args) =>
  run("--manifest", manifestAt(first), "--three", "/unused", "--tool", tool, ...args);

const setVersion = (version) =>
  writeFileSync(
    path.join(checkout, "package.json"),
    JSON.stringify({ name: "my-office", version, dependencies: { three: "0.160.0" } }),
  );

describe("upstream-report", () => {
  before(() => {
    root = mkdtempSync(path.join(tmpdir(), "upstream-report-"));
    checkout = path.join(root, "my-office");
    mkdirSync(checkout);
    git(checkout, "init", "-q");
    writeFileSync(
      path.join(checkout, "package.json"),
      JSON.stringify({ name: "my-office", version: "0.7.0", dependencies: { three: "0.160.0" } }),
    );
    git(checkout, "add", "-A");
    git(checkout, "commit", "-q", "-m", "first");
    first = git(checkout, "rev-parse", "HEAD");
    git(checkout, "commit", "-q", "--allow-empty", "-m", "second");
    second = git(checkout, "rev-parse", "HEAD");
    manifestAt = manifestFor;
  });

  after(() => rmSync(root, { recursive: true, force: true }));

  it("reports no move, and an empty body, when the commit is the manifest's", () => {
    const report = run("--manifest", manifestAt(second));
    assert.equal(report.moved, false);
    assert.equal(report.from, second);
    assert.equal(report.to, second);
    assert.equal(report.body, "");
  });

  it("reports a move with both commits, the compare link and the version", () => {
    const report = run("--manifest", manifestAt(first));
    assert.equal(report.moved, true);
    assert.equal(report.from, first);
    assert.equal(report.to, second);
    assert.equal(report.version, "0.7.0");
    const site = "https://github.com/khanh020905/my-office";
    assert.ok(report.body.includes(`${site}/commit/${first}`));
    assert.ok(report.body.includes(`${site}/commit/${second}`));
    assert.ok(report.body.includes(`${site}/compare/${first}...${second}`));
  });

  it("says the check was not run when --three is absent", () => {
    const report = run("--manifest", manifestAt(first));
    assert.match(report.body, /the check was not run/i);
  });

  it("changes no file in the checkout", () => {
    run("--manifest", manifestAt(first));
    assert.equal(git(checkout, "status", "--porcelain"), "");
  });

  it("starts the body with the marker the workflow looks for", () => {
    const report = run("--manifest", manifestAt(first));
    assert.ok(report.body.startsWith("<!-- paseo-office-upstream -->\n"));
  });

  it("puts the tool's output in a fenced block", () => {
    const report = withTool(toolPrinting("would write: 0\n"));
    assert.match(report.body, /```\nwould write: 0\n```/);
    assert.doesNotMatch(report.body, /exited with status/);
  });

  it("says so when the tool exits non-zero, and keeps its output", () => {
    const report = withTool(toolPrinting("boom\n", 3));
    assert.match(report.body, /exited with status 3/);
    assert.match(report.body, /boom/);
  });

  it("cuts the tool's output to its last 200 lines and says so", () => {
    const lines = Array.from({ length: 250 }, (_, i) => `line ${i + 1}`).join("\n");
    const { body } = withTool(toolPrinting(lines));
    assert.match(body, /last 200 of 250 lines/);
    assert.ok(body.includes("line 250"));
    assert.ok(body.includes("line 51"));
    assert.ok(!body.includes("line 50\n"));
  });

  it("keeps the body under 60000 characters, cutting the output from the top", () => {
    const lines = Array.from({ length: 150 }, (_, i) => `${"x".repeat(1000)} ${i + 1}`).join("\n");
    const { body } = withTool(toolPrinting(lines));
    assert.ok(body.length < 60000, `body is ${body.length} characters`);
    assert.match(body, /characters/);
    assert.ok(body.includes(" 150\n"));
    assert.ok(!body.includes(" 1\n"));
  });

  it("fences the output with more backticks than any run inside it", () => {
    const { body } = withTool(toolPrinting("a ```` b\n```\nend\n"));
    assert.match(body, /\n`{5}\na ````/);
    assert.match(body, /end\n`{5}\n/);
  });

  it("reduces the version to word characters, dots, plus and minus", () => {
    setVersion("1.0.0`<script>[x](y)\n# h");
    const report = run("--manifest", manifestAt(first));
    assert.match(report.version, /^[\w.+-]*$/);
    assert.ok(!report.body.includes("<script>"));
    assert.ok(!report.body.includes("# h"));
    setVersion("0.7.0");
  });

  it("cuts a single very long line by characters, keeping its end", () => {
    const long = `${"a".repeat(200000)}THE-END`;
    const { body } = withTool(toolPrinting(long));
    assert.ok(body.length < 60000, `body is ${body.length} characters`);
    assert.match(body, /last \d+ characters/);
    assert.ok(body.includes("THE-END\n"));
  });

  it("exports the marker the body starts with", async () => {
    const { MARKER } = await import("./upstream-report.mjs");
    assert.equal(MARKER, "<!-- paseo-office-upstream -->");
    assert.ok(run("--manifest", manifestAt(first)).body.startsWith(`${MARKER}\n`));
  });
});
