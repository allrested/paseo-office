#!/usr/bin/env node
// Looks at whether my-office has moved past the commit vendored in vendor/my-office.
//
//   node scripts/upstream-report.mjs --upstream <my-office checkout> [--three <node_modules/three>]
//                                    [--manifest <MANIFEST.json>] [--tool <import-upstream.mjs>]
//
// Prints one JSON line: { moved, from, to, version, body }. `body` is an issue's Markdown when
// upstream has moved, and empty when it has not. It changes no file.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://github.com/khanh020905/my-office";
const MAX_CHECK_LINES = 200;
const MAX_BODY_CHARS = 60000;
/** The first line of the body: scripts/own-issue.mjs finds the job's own issue by it. */
export const MARKER = "<!-- paseo-office-upstream -->";

function main() {
  const args = process.argv.slice(2);
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const upstream = option("--upstream");
  const three = option("--three");
  const manifestPath = option("--manifest") ?? path.join(ROOT, "vendor/my-office/MANIFEST.json");
  const tool = option("--tool") ?? path.join(ROOT, "vendor/my-office/import-upstream.mjs");
  if (!upstream) {
    console.error(
      "usage: upstream-report.mjs --upstream <my-office checkout> [--three <dir>] [--manifest <file>]",
    );
    process.exit(2);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const from = manifest.upstream.commit;
  const to = execFileSync("git", ["-C", upstream, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  // Upstream's text ends up in an issue title and body: keep only what a version is made of.
  const version = String(
    JSON.parse(readFileSync(path.join(upstream, "package.json"), "utf8")).version,
  ).replace(/[^\w.+-]/g, "");

  /** What the import tool says it would change, cut to its last lines when long. */
  function checkSection(room) {
    if (!three) {
      return "The check was not run: no three.js folder was given (`--three`), and the import tool needs the version upstream pins.";
    }
    const run = spawnSync("node", [tool, "--from", upstream, "--three", three, "--check"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const all = `${run.stdout}${run.stderr}`.trimEnd().split("\n");
    let shown = all.slice(-MAX_CHECK_LINES);
    const fits = (lines) => lines.join("\n").length <= room;
    while (shown.length > 1 && !fits(shown)) shown = shown.slice(Math.ceil(shown.length / 10));
    let text = shown.join("\n");
    // A single line can still be longer than the room: keep its end.
    const keptChars = text.length > room;
    if (keptChars) text = text.slice(-room);
    const lost = [];
    if (shown.length < all.length) lost.push(`the last ${shown.length} of ${all.length} lines`);
    if (keptChars) lost.push(`the last ${text.length} characters`);
    const cut = lost.length
      ? `Cut to ${lost.join(", then to ")}, to keep the issue under ${MAX_BODY_CHARS} characters.\n\n`
      : "";
    const status = run.status === 0 ? "" : `The tool exited with status ${run.status}.\n\n`;
    // A fence longer than any run of backticks inside the output cannot be closed early by it.
    const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((ticks) => ticks.length));
    const fence = "`".repeat(Math.max(3, longest + 1));
    return `${status}${cut}${fence}\n${text}\n${fence}`;
  }

  function issueBody() {
    const around = (check) => `${MARKER}
my-office has moved since the version vendored here.

- Vendored: [\`${from}\`](${SITE}/commit/${from}) (v${manifest.upstream.version})
- Upstream now: [\`${to}\`](${SITE}/commit/${to}) (v${version})
- Changes: ${SITE}/compare/${from}...${to}

### What the import tool would change

${check}

### Taking the update

1. Run the import tool without \`--check\` (see \`vendor/SOURCES.md\`, "Taking a newer upstream"), then compare each file it kept because of a \`PASEO:\` note, and add any export a stand-in lacks.
2. Run \`npm run build:world\`, then \`npm test\`.
3. Look at the office in a browser: a module upstream added to its start-up list may need a stand-in or a place in \`DENY\`.
`;
    // What the body costs without the tool's output, with a margin for the notes and the fence.
    const room = MAX_BODY_CHARS - around("").length - 1000;
    return around(checkSection(room));
  }

  const moved = from !== to;
  console.log(JSON.stringify({ moved, from, to, version, body: moved ? issueBody() : "" }));
}

// Importing the module (for MARKER) must not run the report.
// Real paths on both sides: run through a symlink, argv[1] is the link and import.meta.url is not.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
