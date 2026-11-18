import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { MARKER } from "./upstream-report.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "own-issue.mjs");
const bot = { login: "github-actions", is_bot: true };
const prefixedBot = { login: "app/github-actions", is_bot: true };
const suffixedBot = { login: "github-actions[bot]", is_bot: true };
const person = { login: "someone", is_bot: false };

const select = (issues, script = SCRIPT) => {
  const run = spawnSync("node", [script], { input: JSON.stringify(issues), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
};

describe("own-issue", () => {
  it("prints nothing when there are no issues", () => {
    assert.equal(select([]), "");
  });

  it("skips a person's issue that contains the marker", () => {
    assert.equal(select([{ number: 4, author: person, body: `${MARKER}\ntext` }]), "");
  });

  it("skips the bot's issue without the marker", () => {
    assert.equal(select([{ number: 5, author: bot, body: "something else" }]), "");
  });

  it("selects the bot's issue with the marker, whichever way gh names the bot", () => {
    assert.equal(select([{ number: 6, author: bot, body: `${MARKER}\ntext` }]), "6");
    assert.equal(select([{ number: 8, author: prefixedBot, body: `${MARKER}\ntext` }]), "8");
    assert.equal(select([{ number: 10, author: suffixedBot, body: `${MARKER}\ntext` }]), "10");
  });

  it("runs when started through a symlink", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "own-issue-"));
    after(() => rmSync(dir, { recursive: true, force: true }));
    const link = path.join(dir, "own-issue.mjs");
    symlinkSync(SCRIPT, link);
    assert.equal(select([{ number: 6, author: bot, body: MARKER }], link), "6");
  });

  it("skips an author that is not a bot, whatever its login", () => {
    assert.equal(
      select([{ number: 9, author: { login: "github-actions", is_bot: false }, body: MARKER }]),
      "",
    );
  });

  it("takes the lowest number when the bot has several", () => {
    const issues = [
      { number: 12, author: bot, body: MARKER },
      { number: 3, author: person, body: MARKER },
      { number: 9, author: bot, body: MARKER },
    ];
    assert.equal(select(issues), "9");
  });

  it("copes with an issue that has no author or body", () => {
    assert.equal(select([{ number: 1, author: null, body: null }, { number: 2 }]), "");
  });
});
