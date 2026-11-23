import type { Forgotten } from "../shared/forgotten.js";
import type { Exec } from "./repo-age.js";

/** The most checkouts looked at in one read. */
export const FORGOTTEN_MAX = 40;

export interface Checkout {
  workspaceId: string | null;
  name: string;
  folder: string;
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim() !== "");
}

/** The lines `git` prints for these arguments in a folder; null when git cannot say. */
async function git(exec: Exec, folder: string, args: string[]): Promise<string[] | null> {
  try {
    const { stdout } = await exec("git", args, {
      cwd: folder,
      timeout: 10_000,
      maxBuffer: 1 << 22,
      // Reading must not take a lock an agent's own git is waiting for.
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    return lines(stdout);
  } catch {
    return null;
  }
}

/** A repository's other worktrees: the folders `git worktree list` names besides the ones given. */
async function otherWorktrees(
  exec: Exec,
  folder: string,
  known: ReadonlySet<string>,
): Promise<string[]> {
  const listed = await git(exec, folder, ["worktree", "list", "--porcelain"]);
  if (listed === null) return [];
  return listed
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .filter((path) => !known.has(path));
}

async function readCheckout(exec: Exec, checkout: Checkout): Promise<Forgotten | null> {
  const changed = await git(exec, checkout.folder, ["status", "--porcelain"]);
  // Not a repository, or one git cannot read: nothing to say of it.
  if (changed === null) return null;
  // Commits no remote has: also the ones of a branch that was never pushed.
  const unpushed = await git(exec, checkout.folder, [
    "log",
    "--oneline",
    "HEAD",
    "--not",
    "--remotes",
  ]);
  const stashes = await git(exec, checkout.folder, ["stash", "list"]);
  const found = {
    name: checkout.name,
    workspaceId: checkout.workspaceId,
    changed: changed.length,
    unpushed: unpushed?.length ?? 0,
    stashes: stashes?.length ?? 0,
  };
  return found.changed + found.unpushed + found.stashes === 0 ? null : found;
}

/**
 * The checkouts with unfinished work: each workspace's folder, and the worktrees of their
 * repositories that no workspace has. Counts only: no file name, branch or message is read out.
 * A stash belongs to the repository, so every worktree of it reports the same stashes; they are
 * counted on the first.
 */
export async function readForgotten(
  workspaces: readonly Checkout[],
  exec: Exec,
): Promise<Forgotten[]> {
  const known = new Set(workspaces.map((workspace) => workspace.folder));
  const checkouts: Checkout[] = workspaces.slice(0, FORGOTTEN_MAX);
  for (const workspace of workspaces) {
    if (checkouts.length >= FORGOTTEN_MAX) break;
    for (const path of await otherWorktrees(exec, workspace.folder, known)) {
      known.add(path);
      const name = path.split(/[\\/]/).at(-1) ?? path;
      checkouts.push({ workspaceId: null, name, folder: path });
    }
  }
  const stashed = new Set<string>();
  const found: Forgotten[] = [];
  for (const checkout of checkouts.slice(0, FORGOTTEN_MAX)) {
    const item = await readCheckout(exec, checkout);
    if (item === null) continue;
    if (item.stashes > 0) {
      const common = await git(exec, checkout.folder, ["rev-parse", "--git-common-dir"]);
      const repo = common?.[0] ?? checkout.folder;
      if (stashed.has(repo)) item.stashes = 0;
      stashed.add(repo);
    }
    if (item.changed + item.unpushed + item.stashes > 0) found.push(item);
  }
  return found;
}
