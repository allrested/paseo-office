import { copyFile, lstat, mkdtemp, realpath, rm, stat, unlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { UndoSkip } from "../shared/contracts.js";
import type { Exec } from "./repo-age.js";

/** The longest each git call may take; a snapshot that needs more is no snapshot. */
export const UNDO_GIT_TIMEOUT_MS = 15_000;

/** A file as a tree holds it, `<mode> <blob>`; null where the tree has none. */
type Entry = string | null;

/** What a turn's undo is made of: the files its edit calls named, as the two trees held them. */
interface Turn {
  top: string;
  /** The tree before the turn, to restore from. */
  before: string;
  /** Each file git can restore, with what it was before and at the turn's end. */
  files: { path: string; before: Entry; end: Entry }[];
  /** The files the turn's edit calls named that git cannot restore, and why. */
  refused: UndoSkip[];
}

export interface UndoResult {
  restored: number;
  skipped: { reason: UndoSkip; count: number }[];
}

export interface Undo {
  /** A turn starts: the work tree is snapshotted when the setting is on, else the last snapshot is dropped. */
  begin(agentId: string, folder: string): Promise<void>;
  /** The turn ended: the files its edit calls named (a relative one is of the agent's folder), as the work tree holds them now. */
  end(agentId: string, folder: string, files: readonly string[]): Promise<void>;
  /** How many files an undo would put back; 0 for a turn with no undo, and while it runs. */
  available(agentId: string): number;
  /** Puts the last turn's edits back, and forgets the turn; null when there is nothing to undo. */
  undo(agentId: string): Promise<UndoResult | null>;
  forget(agentId: string): void;
}

export interface UndoPorts {
  exec: Exec;
  /** Whether the owner has the setting on. */
  enabled(): boolean;
  log(line: string): void;
}

interface Taken {
  top: string;
  tree: string;
}

/** The agent's turn: still being snapshotted, running, or ended with what it can undo. */
interface Slot {
  taking: Promise<Taken | null>;
  turn: Turn | null;
}

function baseEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Reading must not take a lock an agent's own git is waiting for; a path is a path, not a pattern.
    GIT_OPTIONAL_LOCKS: "0",
    GIT_LITERAL_PATHSPECS: "1",
    ...extra,
  };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
    if (!(name in extra)) delete env[name];
  }
  return env;
}

async function git(
  exec: Exec,
  cwd: string,
  args: string[],
  extra: Record<string, string> = {},
): Promise<string> {
  const { stdout } = await exec("git", args, {
    cwd,
    timeout: UNDO_GIT_TIMEOUT_MS,
    maxBuffer: 1 << 24,
    env: baseEnv(extra),
  });
  return stdout;
}

/** A temporary index file in a folder of its own, gone after `work`. The repository's index is never touched. */
async function withIndex<T>(work: (index: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "office-undo-"));
  try {
    return await work(join(dir, "index"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The tree of the work tree as it is now: tracked and untracked files, but for what git ignores.
 * It is made in a copy of the index (so git need read only the files that changed, the copy
 * keeping the index's own time) with `git add -A`, and written with `git write-tree`: the index,
 * HEAD, the stash and the files are not touched, and only objects are added.
 */
async function snapshot(exec: Exec, top: string): Promise<string> {
  return withIndex(async (index) => {
    const env = { GIT_INDEX_FILE: index };
    const real = (
      await git(exec, top, ["rev-parse", "--path-format=absolute", "--git-path", "index"])
    ).trim();
    try {
      await copyFile(real, index);
      const { atime, mtime } = await stat(real);
      await utimes(index, atime, mtime);
    } catch {
      const head = await git(exec, top, ["rev-parse", "--verify", "--quiet", "HEAD"]).catch(
        () => null,
      );
      if (head !== null) await git(exec, top, ["read-tree", "HEAD"], env);
    }
    await git(exec, top, ["add", "-A"], env);
    return (await git(exec, top, ["write-tree"], env)).trim();
  });
}

/** The work tree's folder when `folder` is inside one; null for any other folder. */
async function workTree(exec: Exec, folder: string): Promise<string | null> {
  try {
    const top = (await git(exec, folder, ["rev-parse", "--show-toplevel"])).trim();
    return top === "" ? null : await realpath(top);
  } catch {
    return null;
  }
}

/** The entries of a tree for these paths, by path. */
async function entries(
  exec: Exec,
  top: string,
  tree: string,
  paths: readonly string[],
): Promise<Map<string, Entry>> {
  const found = new Map<string, Entry>();
  if (paths.length === 0) return found;
  const out = await git(exec, top, ["ls-tree", "-r", "-z", tree, "--", ...paths]);
  for (const record of out.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode, , blob] = record.slice(0, tab).split(" ");
    found.set(record.slice(tab + 1), `${mode} ${blob}`);
  }
  return found;
}

/**
 * Where a file is in the work tree, as git names it (relative, with `/`); null when it is not in
 * it. The folder it is in is resolved first, so a `..` or a link out of the tree cannot reach a
 * file beyond it; `.git` is never a place to restore to.
 */
async function placeIn(top: string, folder: string, file: string): Promise<string | null> {
  const absolute = resolve(folder, file);
  let dir = dirname(absolute);
  const rest = [basename(absolute)];
  for (;;) {
    try {
      dir = await realpath(dir);
      break;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return null;
      rest.unshift(basename(dir));
      dir = parent;
    }
  }
  const place = relative(top, join(dir, ...rest));
  if (place === "" || isAbsolute(place) || place === ".." || place.startsWith(`..${sep}`)) {
    return null;
  }
  const parts = place.split(sep);
  return parts[0] === ".git" ? null : parts.join("/");
}

/** Whether git ignores a path: for it a snapshot has no file, so an absence there proves nothing. */
async function ignores(exec: Exec, top: string, path: string): Promise<boolean> {
  try {
    // It takes a path as a path, and refuses the literal-pathspec setting the other calls have.
    await git(exec, top, ["check-ignore", "-q", "--", path], { GIT_LITERAL_PATHSPECS: "0" });
    return true;
  } catch (error) {
    // Exit status 1 is "not ignored"; any other failure is a git that cannot say.
    if ((error as { code?: unknown }).code === 1) return false;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function isLink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

/** The turn's undo: its files placed, sorted into what git can restore and what it cannot. */
async function readTurn(
  exec: Exec,
  taken: Taken,
  folder: string,
  files: readonly string[],
): Promise<Turn> {
  const { top } = taken;
  const refused: UndoSkip[] = [];
  const places = new Set<string>();
  for (const file of files) {
    const place = await placeIn(top, folder, file);
    if (place === null) refused.push("outside");
    else places.add(place);
  }
  const wanted: string[] = [];
  for (const place of places) {
    if (await ignores(exec, top, place)) refused.push("ignored");
    else if (await isLink(join(top, place))) refused.push("link");
    else wanted.push(place);
  }
  const end = await snapshot(exec, top);
  const before = await entries(exec, top, taken.tree, wanted);
  const after = await entries(exec, top, end, wanted);
  return {
    top,
    before: taken.tree,
    files: wanted.map((path) => ({
      path,
      before: before.get(path) ?? null,
      end: after.get(path) ?? null,
    })),
    refused,
  };
}

/** Puts back the files whose work tree entry is still what the turn left, and says what it did not. */
async function restore(exec: Exec, turn: Turn): Promise<UndoResult> {
  const { top } = turn;
  const skips: UndoSkip[] = [...turn.refused];
  const paths = turn.files.map((file) => file.path);
  const present = new Set<string>();
  for (const path of paths) {
    if (await exists(join(top, path))) present.add(path);
  }
  // The work tree as it is now, for the files in question: a file changed since is not ours to put back.
  const now = await withIndex(async (index) => {
    const env = { GIT_INDEX_FILE: index };
    await git(exec, top, ["read-tree", turn.before], env);
    // `git add` refuses a path that is nowhere: neither in the tree nor in the work tree.
    const known = turn.files.filter((file) => file.before !== null || present.has(file.path));
    if (known.length > 0) {
      await git(exec, top, ["add", "-A", "--", ...known.map((file) => file.path)], env);
    }
    return (await git(exec, top, ["write-tree"], env)).trim();
  });
  const current = await entries(exec, top, now, paths);
  const back: string[] = [];
  const gone: string[] = [];
  for (const file of turn.files) {
    const here = current.get(file.path) ?? null;
    if (await isLink(join(top, file.path))) skips.push("link");
    else if (here !== file.end && here !== file.before) skips.push("changed");
    else if (here === file.before) skips.push("same");
    else if (file.before === null) gone.push(file.path);
    else back.push(file.path);
  }
  let restored = 0;
  for (const path of gone) {
    try {
      await unlink(join(top, path));
      restored += 1;
    } catch {
      skips.push("write");
    }
  }
  if (back.length > 0) {
    await withIndex(async (index) => {
      const env = { GIT_INDEX_FILE: index };
      await git(exec, top, ["read-tree", turn.before], env);
      for (const path of back) {
        try {
          await git(exec, top, ["checkout-index", "-f", "--", path], env);
          restored += 1;
        } catch {
          skips.push("write");
        }
      }
    });
  }
  const counts = new Map<UndoSkip, number>();
  for (const reason of skips) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return { restored, skipped: [...counts].map(([reason, count]) => ({ reason, count })) };
}

/** The files a turn's edit and write calls named, once each, in the order they were first named. */
export function editedFiles(
  items: readonly { type: string; status?: unknown; detail?: unknown }[],
): string[] {
  const files = new Set<string>();
  for (const item of items) {
    if (item.type !== "tool_call" || item.status === "failed" || item.status === "canceled") {
      continue;
    }
    const { detail } = item;
    if (typeof detail !== "object" || detail === null) continue;
    const kind: unknown = Reflect.get(detail, "type");
    const path: unknown = Reflect.get(detail, "filePath");
    if ((kind === "edit" || kind === "write") && typeof path === "string" && path !== "") {
      files.add(path);
    }
  }
  return [...files];
}

/**
 * Undo for the last turn of each agent, from git: a snapshot of the work tree when the turn
 * starts, another when it ends, and the files the turn's edit and write calls named. Only those
 * files are put back, so what another agent or the owner changed elsewhere stays. Whatever goes
 * wrong, the turn has no undo; nothing here fails or waits a turn.
 */
export function createUndo(ports: UndoPorts): Undo {
  const slots = new Map<string, Slot>();
  const { exec } = ports;
  async function take(folder: string): Promise<Taken | null> {
    try {
      const top = await workTree(exec, folder);
      return top === null ? null : { top, tree: await snapshot(exec, top) };
    } catch (error) {
      ports.log(`[office] undo snapshot failed: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }
  return {
    async begin(agentId, folder) {
      slots.delete(agentId);
      if (!ports.enabled()) return;
      const slot: Slot = { taking: take(folder), turn: null };
      slots.set(agentId, slot);
      await slot.taking;
    },
    async end(agentId, folder, files) {
      const slot = slots.get(agentId);
      if (slot === undefined) return;
      const taken = await slot.taking;
      if (taken === null || slots.get(agentId) !== slot || files.length === 0) return;
      try {
        const turn = await readTurn(exec, taken, folder, files);
        if (slots.get(agentId) === slot && turn.files.length > 0) slot.turn = turn;
      } catch (error) {
        ports.log(`[office] undo read failed: ${error instanceof Error ? error.message : error}`);
      }
    },
    available(agentId) {
      return slots.get(agentId)?.turn?.files.length ?? 0;
    },
    async undo(agentId) {
      const turn = slots.get(agentId)?.turn;
      if (turn === undefined || turn === null) return null;
      slots.delete(agentId);
      return restore(exec, turn);
    },
    forget(agentId) {
      slots.delete(agentId);
    },
  };
}
