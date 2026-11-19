// A Git install has no node_modules: the host builds the plugin with only what it supplies.
// That is `@getpaseo/plugin` through its entry points, react, react-native and zod, and
// `@getpaseo/protocol/*` types that are erased. Any other package fails the build ("Could not
// resolve type dependency", or a missing module). The lists below are the ones the stock
// server's plugin build (`compiler-build.js`, `plugin-sdk-specifiers.js`) exempts; the host-only
// `@getpaseo/plugin/client/host` is not one of them.
import { readdirSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

type Side = "client" | "server" | "shared";

const CLIENT_SDK = new Set([
  "@getpaseo/plugin/client",
  "@getpaseo/plugin/client/ui",
  "@getpaseo/plugin/client/react-native",
]);
const SERVER_SDK = new Set([
  "@getpaseo/plugin/server",
  "@getpaseo/plugin/server/provider",
  "@getpaseo/plugin/server/usage",
  "@getpaseo/plugin/server/acp",
]);

const REACT_PACKAGES = /^(react|react-native)(\/|$)/;

interface Import {
  specifier: string;
  typeOnly: boolean;
}

function importsOf(source: string): Import[] {
  const found: Import[] = [];
  const statement = /\b(?:import|export)\s+(type\s+)?[^;"']*?\bfrom\s+"([^"]+)"/g;
  for (const match of source.matchAll(statement)) {
    found.push({ specifier: match[2], typeOnly: match[1] !== undefined });
  }
  for (const match of source.matchAll(/\bimport\s*\(?\s*"([^"]+)"/g)) {
    found.push({ specifier: match[1], typeOnly: false });
  }
  return found;
}

/** Why a plugin file may not import this, or null when the host's build supplies it. */
function importProblem(side: Side, { specifier, typeOnly }: Import): string | null {
  if (specifier.startsWith(".")) return null;
  if (specifier.startsWith("@getpaseo/protocol/")) {
    return typeOnly
      ? null
      : "a protocol import must be `import type`: the host supplies no runtime";
  }
  if (specifier === "@getpaseo/plugin" || /^zod(\/|$)/.test(specifier)) return null;
  if (CLIENT_SDK.has(specifier)) {
    return side === "client" ? null : "a client-only entry point outside client/";
  }
  if (SERVER_SDK.has(specifier)) {
    return side === "server" ? null : "a server-only entry point outside server/";
  }
  if (isBuiltin(specifier)) return side === "server" ? null : "a Node built-in on the app's side";
  if (REACT_PACKAGES.test(specifier)) {
    return side === "client" ? null : "react is client-only";
  }
  return "a package the host's build does not supply";
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (rel !== path.join("shared", "upstream")) walk(rel, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(rel);
    }
  }
}

function pluginFiles(): { file: string; side: Side }[] {
  const out: { file: string; side: Side }[] = [];
  const add = (dir: string, side: Side) => {
    const files: string[] = [];
    walk(dir, files);
    for (const file of files) out.push({ file, side });
  };
  add("client", "client");
  add("server", "server");
  add("shared", "shared");
  out.push({ file: "index.client.tsx", side: "client" });
  out.push({ file: "index.server.ts", side: "server" });
  return out;
}

describe("what the plugin imports", () => {
  it("is only what the host's build supplies", () => {
    const hits: string[] = [];
    for (const { file, side } of pluginFiles()) {
      for (const found of importsOf(readFileSync(path.join(root, file), "utf8"))) {
        const problem = importProblem(side, found);
        if (problem !== null) hits.push(`${file} imports "${found.specifier}": ${problem}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("names the packages a Git install lacks", () => {
    const client = { specifier: "@getpaseo/client", typeOnly: true };
    expect(importProblem("client", client)).not.toBeNull();
    expect(importProblem("client", { specifier: "react-native", typeOnly: false })).toBeNull();
    expect(importProblem("shared", { specifier: "react", typeOnly: false })).not.toBeNull();
    expect(importProblem("client", { specifier: "node:fs", typeOnly: false })).not.toBeNull();
    expect(importProblem("server", { specifier: "node:fs", typeOnly: false })).toBeNull();
    expect(
      importProblem("server", { specifier: "@getpaseo/plugin/server", typeOnly: false }),
    ).toBeNull();
    const host = { specifier: "@getpaseo/plugin/client/host", typeOnly: false };
    expect(importProblem("client", host)).not.toBeNull();
    const runtime = { specifier: "@getpaseo/protocol/agent-types", typeOnly: false };
    expect(importProblem("client", runtime)).not.toBeNull();
    expect(importProblem("client", { ...runtime, typeOnly: true })).toBeNull();
  });
});
