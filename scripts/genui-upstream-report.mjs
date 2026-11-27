#!/usr/bin/env node
// Looks at whether the Generative UI plugin has moved past the commit vendored in vendor/genui.
//
//   node scripts/genui-upstream-report.mjs --upstream <paseo-plugin-genui checkout> [--manifest <MANIFEST.json>]
//
// Prints one JSON line: { moved, from, to, version, changed, removed, body }. `changed` and
// `removed` name the vendored files whose upstream text at the checkout's HEAD differs from the
// sha256 in the manifest, or is gone. `body` is an issue's Markdown when upstream has moved, and
// empty when it has not. It changes no file.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://github.com/anh-chu/paseo-plugin-genui";
/** The first line of the body, so a job can find its own issue by it. */
export const MARKER = "<!-- paseo-office-genui-upstream -->";

function main() {
  const args = process.argv.slice(2);
  const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const upstream = option("--upstream");
  const manifestPath = option("--manifest") ?? path.join(ROOT, "vendor/genui/MANIFEST.json");
  if (!upstream) {
    console.error("usage: genui-upstream-report.mjs --upstream <checkout> [--manifest <file>]");
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const git = (...gitArgs) =>
    execFileSync("git", ["-C", upstream, ...gitArgs], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  const from = manifest.upstream.commit;
  const to = git("rev-parse", "HEAD").trim();
  // Upstream's text ends up in an issue title and body: keep only what a version is made of.
  const version = String(JSON.parse(git("show", "HEAD:package.json")).version).replace(
    /[^\w.+-]/g,
    "",
  );

  const changed = [];
  const removed = [];
  for (const [file, sha256] of Object.entries(manifest.files)) {
    let text;
    try {
      text = execFileSync("git", ["-C", upstream, "show", `HEAD:${file}`], {
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      removed.push(file);
      continue;
    }
    if (createHash("sha256").update(text).digest("hex") !== sha256) changed.push(file);
  }

  const moved = from !== to;
  const list = (names) =>
    names.length === 0 ? "none" : names.map((name) => `- \`${name}\``).join("\n");
  const body = `${MARKER}
The Generative UI plugin has moved since the version vendored here.

- Vendored: [\`${from}\`](${SITE}/commit/${from}) (v${manifest.upstream.version})
- Upstream now: [\`${to}\`](${SITE}/commit/${to}) (v${version})
- Changes: ${SITE}/compare/${from}...${to}

### Vendored files that changed upstream

${list(changed)}

### Vendored files upstream no longer has

${list(removed)}

### Taking the update

1. Copy the changed files into \`vendor/genui/\` unchanged, record the new commit and each file's sha256 in \`vendor/genui/MANIFEST.json\`, and add any file the renderer now imports (\`npm run build:genui\` names a missing one).
2. Check that \`vendor/genui/loaders.ts\` still has every export upstream's \`client/loaders.ts\` gives the components, and that \`shared/genui-placeholders.ts\` names every component that calls the plugin's RPCs.
3. Run \`npm run build:genui\`, then \`npm test\`.
`;
  console.log(
    JSON.stringify({ moved, from, to, version, changed, removed, body: moved ? body : "" }),
  );
}

// Importing the module (for MARKER) must not run the report.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
