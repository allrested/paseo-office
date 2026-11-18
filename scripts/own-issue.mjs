#!/usr/bin/env node
// Picks the issue the weekly upstream job made, from `gh issue list --json number,body,author` on
// stdin: it prints the number, or nothing when there is none.
//
//   gh issue list --state open --limit 100 --json number,body,author | node scripts/own-issue.mjs
//
// The job's issue is written by the Actions bot and carries the report's marker. A person's issue
// with the same marker, or the bot's issue without it, is not the job's.
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MARKER } from "./upstream-report.mjs";

// Which spelling of the Actions bot's login gh puts in `author.login` was not observed, so the
// three it is known by are taken: `github-actions`, `app/github-actions` (as `--author` takes it)
// and `github-actions[bot]` (as the REST API names it). A bot flag, when gh gives one, must be true.
const BOT_LOGINS = new Set(["github-actions", "app/github-actions", "github-actions[bot]"]);

export function selectOwnIssue(issues) {
  const own = issues.filter(
    (issue) =>
      BOT_LOGINS.has(issue.author?.login) &&
      issue.author.is_bot !== false &&
      typeof issue.body === "string" &&
      issue.body.includes(MARKER),
  );
  // Should the job ever have made two, the lowest number is the older one: it gets the update.
  return own.map((issue) => issue.number).sort((a, b) => a - b)[0];
}

// Real paths on both sides: run through a symlink, argv[1] is the link and import.meta.url is not.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const number = selectOwnIssue(JSON.parse(readFileSync(0, "utf8")));
  if (number !== undefined) console.log(number);
}
