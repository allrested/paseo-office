import { constants } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { basename, delimiter, isAbsolute, join } from "node:path";

interface Launch {
  command: string;
  args: string[];
}

async function usable(file: string, mode: number): Promise<boolean> {
  try {
    await access(file, mode);
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

async function fromPath(command: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const candidates = isAbsolute(command)
    ? [command]
    : (env.PATH ?? "")
        .split(delimiter)
        .filter(isAbsolute)
        .map((dir) => join(dir, command));
  for (const file of candidates) if (await usable(file, constants.X_OK)) return file;
  return null;
}

// Resolve an npx declaration to an existing installation. Launching npx itself can download
// and execute a package just because someone opened the Host card.
async function installedPackage(
  version: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<string | null> {
  if (!version) {
    const binary = await fromPath("ssh-mcp", env);
    if (binary) return binary;
  }
  const cache = env.npm_config_cache ?? (env.HOME && join(env.HOME, ".npm"));
  if (!cache) return null;
  const root = join(cache, "_npx");
  const directories = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const dir of directories) {
    if (!dir.isDirectory()) continue;
    const modules = join(root, dir.name, "node_modules");
    try {
      const pkg = JSON.parse(await readFile(join(modules, "ssh-mcp", "package.json"), "utf8"));
      if (pkg.name !== "ssh-mcp" || (version && pkg.version !== version)) continue;
      const binary = join(modules, ".bin", "ssh-mcp");
      if (await usable(binary, constants.X_OK)) return binary;
    } catch {
      /* A cache entry may hold any package. */
    }
  }
  return null;
}

const packageName = /^ssh-mcp(?:@(\d+\.\d+\.\d+(?:-[\w.-]+)?))?$/;
// Some trusted workspaces use a shell only to expand HOME in the config path. Recognise that
// declaration without executing shell code, redirects, substitutions, or other commands.
const shellDeclaration =
  /^(?:exec )?npx (?:-y |--yes )?(ssh-mcp(?:@[\w.-]+)?) --config="\$HOME(\/[\w./ -]+)"$/;

async function npxLaunch(args: string[], env: NodeJS.ProcessEnv): Promise<Launch | null> {
  const offset = args[0] === "-y" || args[0] === "--yes" ? 1 : 0;
  const match = packageName.exec(args[offset] ?? "");
  if (!match) return null;
  const binary = await installedPackage(match[1], env);
  if (!binary) return null;
  const start = offset + 1;
  return { command: binary, args: args.slice(args[start] === "--" ? start + 1 : start) };
}

export async function installedLaunch(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<Launch | null> {
  const name = basename(command);
  if (name === "ssh-mcp") {
    const binary = await fromPath(command, env);
    return binary ? { command: binary, args } : null;
  }
  if (
    name === "node" &&
    args[0] &&
    isAbsolute(args[0]) &&
    /[/\\]ssh-mcp[/\\](build|dist)[/\\]index\.js$/.test(args[0])
  ) {
    return (await usable(args[0], constants.R_OK)) ? { command: process.execPath, args } : null;
  }
  if (
    (name === "sh" || name === "bash") &&
    (args[0] === "-c" || args[0] === "-lc") &&
    args.length === 2
  ) {
    const match = shellDeclaration.exec(args[1]);
    if (!match || !env.HOME) return null;
    return installedLaunch("npx", [match[1], "--config=" + join(env.HOME, match[2])], env);
  }
  if (name !== "npx") return null;
  return npxLaunch(args, env);
}
