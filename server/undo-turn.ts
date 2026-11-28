import {
  copyFile,
  lstat,
  mkdtemp,
  realpath,
  rm,
  rmdir,
  stat,
  unlink,
  utimes,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Checkpoint, CheckpointFile, UndoSkip } from "../shared/contracts.js";
import type { Exec } from "./repo-age.js";

/** The longest each git call may take; a snapshot that needs more is no snapshot. */
export const UNDO_GIT_TIMEOUT_MS = 15_000;
/** The turns kept for each agent; the oldest is dropped. */
export const CHECKPOINTS_KEPT = 10;
/** The files a checkpoint lists; the rest are counted. */
export const CHECKPOINT_FILES = 200;
/** Paths per git call, so a turn that touched thousands of files stays under the argument limit. */
const CHUNK = 100;

/** A kept turn as git holds it: two trees of the work tree, no ref. */
export interface Snapshots {
  top: string;
  turnId: string;
  before: string;
  end: string;
  /** When the turn began (ms): a folder born after it is the turn's. Without it no folder is removed. */
  beganAt?: number;
}

interface Kept extends Snapshots {
  endedAt: string;
  files: CheckpointFile[];
  more: number;
}

export interface UndoResult {
  turnId: string;
  restored: number;
  skipped: { reason: UndoSkip; count: number }[];
}

export interface Undo {
  /** A turn starts: the work tree is snapshotted when the setting is on, else the checkpoints are dropped. */
  begin(agentId: string, folder: string): Promise<void>;
  /** The turn ended: kept with a second snapshot when it changed something (no id, not kept). */
  end(agentId: string, turnId: string | null): Promise<void>;
  /** The turns kept, newest first. */
  status(agentId: string): Promise<Checkpoint[]>;
  /** Puts the newest turn back; null when none is kept. Refused while a turn runs, or when git pruned its snapshot. */
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
  beganAt: number;
}

/** An agent's checkpoints, the snapshot of the turn it is in, and the queue its git work waits in. */
interface Agent {
  kept: Kept[];
  taken: Taken | null;
  working: boolean;
  queue: Promise<unknown>;
}

const GONE = "this checkpoint's snapshot is gone";
const WORKING = "the agent is working: undo when its turn has ended";

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

/** Whether a git call was killed (its time ran out) rather than refusing. */
function killed(error: unknown): boolean {
  const { killed: was, signal } = error as { killed?: unknown; signal?: unknown };
  return was === true || (typeof signal === "string" && signal !== "");
}

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += CHUNK) out.push(items.slice(at, at + CHUNK));
  return out;
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

/** Whether git still has both trees: loose objects with no ref, which `git gc` may prune. */
async function usable(exec: Exec, snapshots: Snapshots): Promise<boolean> {
  try {
    for (const tree of [snapshots.before, snapshots.end]) {
      await git(exec, snapshots.top, ["cat-file", "-e", `${tree}^{tree}`]);
    }
    return true;
  } catch {
    return false;
  }
}

/** One path of a turn's diff, with its entry in each tree (`<mode> <blob>`, null where none). */
interface Change {
  path: string;
  before: string | null;
  end: string | null;
}

/** Every path that differs between the two trees, read NUL-separated so any name comes through whole. */
async function changes(exec: Exec, snapshots: Snapshots): Promise<Change[]> {
  const out = await git(exec, snapshots.top, [
    "diff-tree",
    "-r",
    "--no-renames",
    "--no-abbrev",
    "-z",
    "--raw",
    snapshots.before,
    snapshots.end,
    "--",
  ]);
  const fields = out.split("\0");
  const found: Change[] = [];
  for (let at = 0; at + 1 < fields.length; at += 2) {
    const meta = fields[at] ?? "";
    const path = fields[at + 1] ?? "";
    // `:<mode> <mode> <blob> <blob> <status>`
    const [srcMode, dstMode, srcBlob, dstBlob] = meta.replace(/^:/, "").split(" ");
    if (srcMode === undefined || dstMode === undefined || path === "") continue;
    found.push({
      path,
      before: /^0+$/.test(srcMode) ? null : `${srcMode} ${srcBlob}`,
      end: /^0+$/.test(dstMode) ? null : `${dstMode} ${dstBlob}`,
    });
  }
  return found;
}

/** What a turn changed, for the list: the first files with their added and removed lines, and how many more. */
async function listed(
  exec: Exec,
  snapshots: Snapshots,
  all: readonly Change[],
): Promise<{ files: CheckpointFile[]; more: number }> {
  const out = await git(exec, snapshots.top, [
    "diff-tree",
    "-r",
    "--no-renames",
    "-z",
    "--numstat",
    snapshots.before,
    snapshots.end,
    "--",
  ]);
  const counts = new Map<string, { added: number | null; removed: number | null }>();
  for (const record of out.split("\0")) {
    // `<added>\t<removed>\t<path>`, a binary file's counts `-`; the path may hold a tab itself.
    const first = record.indexOf("\t");
    const second = record.indexOf("\t", first + 1);
    if (first < 0 || second < 0) continue;
    const count = (text: string) => (/^\d+$/.test(text) ? Number(text) : null);
    counts.set(record.slice(second + 1), {
      added: count(record.slice(0, first)),
      removed: count(record.slice(first + 1, second)),
    });
  }
  const files = all.slice(0, CHECKPOINT_FILES).map((change): CheckpointFile => {
    const lines = counts.get(change.path);
    return {
      path: change.path,
      kind: kindOf(change),
      added: lines?.added ?? null,
      removed: lines?.removed ?? null,
    };
  });
  return { files, more: Math.max(0, all.length - CHECKPOINT_FILES) };
}

function kindOf(change: Change): CheckpointFile["kind"] {
  if (change.before === null) return "added";
  return change.end === null ? "deleted" : "modified";
}

const modeOf = (entry: string | null) => entry?.split(" ")[0] ?? null;

/**
 * Why a path of the diff is not the undo's to touch, read from the path and the folders above it
 * alone; null when it may be. Resolved first, so a `..` or a link above cannot lead out of the tree.
 */
async function refusal(top: string, change: Change): Promise<UndoSkip | null> {
  const absolute = resolve(top, change.path);
  const place = relative(top, absolute);
  if (place === "" || isAbsolute(place) || place === ".." || place.startsWith(`..${sep}`)) {
    return "outside";
  }
  const parts = place.split(sep);
  if (parts.some((part) => part.toLowerCase() === ".git")) return "git";
  let dir = top;
  for (const part of parts.slice(0, -1)) {
    dir = join(dir, part);
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(dir);
    } catch {
      break;
    }
    if (info.isSymbolicLink()) return "linkedFolder";
    // Something made since where a folder was: `checkout-index -f` would delete it to put the folder back.
    if (!info.isDirectory()) return "changed";
  }
  // The folder that exists, resolved: whatever sits above it, it must still be in the tree.
  let existing = dirname(absolute);
  for (;;) {
    try {
      existing = await realpath(existing);
      break;
    } catch {
      existing = dirname(existing);
    }
  }
  const resolved = relative(top, existing);
  if (isAbsolute(resolved) || resolved === ".." || resolved.startsWith(`..${sep}`)) {
    return "outside";
  }
  const modes = new Set([modeOf(change.before), modeOf(change.end)]);
  if (modes.has("160000")) return "submodule";
  if (modes.has("120000")) return "link";
  try {
    if ((await lstat(absolute)).isSymbolicLink()) return "link";
  } catch {
    // Not there: nothing to be a link.
  }
  return null;
}

/**
 * Whether git ignores a path. One call a path, read by its exit status: the paths it prints are
 * quoted, and `-z` needs a standard input the calls here do not have.
 */
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

/**
 * Each path's entry in the work tree now, as the snapshots write one (`<mode> <blob>`, hashed by
 * git with its filters); null where there is no file, "other" where there is something that is
 * not a plain file.
 */
async function entriesNow(
  exec: Exec,
  top: string,
  paths: readonly string[],
): Promise<Map<string, string | null>> {
  const found = new Map<string, string | null>();
  const fileMode = await git(exec, top, ["config", "--type=bool", "core.fileMode"])
    .then((out) => out.trim() !== "false")
    .catch(() => true);
  const files: { path: string; mode: string }[] = [];
  for (const path of paths) {
    try {
      const info = await lstat(join(top, path));
      if (!info.isFile()) {
        found.set(path, "other");
        continue;
      }
      files.push({ path, mode: info.mode & 0o111 ? "100755" : "100644" });
    } catch {
      found.set(path, null);
    }
  }
  for (const part of chunks(files)) {
    const out = await git(exec, top, ["hash-object", "--", ...part.map((file) => file.path)]);
    const blobs = out.trim().split("\n");
    part.forEach((file, at) => found.set(file.path, `${fileMode ? file.mode : "*"} ${blobs[at]}`));
  }
  return found;
}

/** Every blob to write back must still be there, or nothing is touched: a missing one is a snapshot gone. */
async function present(exec: Exec, top: string, entry: string): Promise<void> {
  try {
    await git(exec, top, ["cat-file", "-e", entry.split(" ")[1] ?? ""]);
  } catch (error) {
    if (killed(error)) throw error;
    throw new Error(GONE, { cause: error });
  }
}

/** Whether the work tree's entry is the tree's; with git not keeping modes, by content alone. */
function same(now: string | null | undefined, entry: string | null): boolean {
  if (now === undefined || now === "other") return false;
  if (now === null || entry === null) return now === entry;
  return now.startsWith("* ") ? now.slice(2) === entry.split(" ")[1] : now === entry;
}

/**
 * Puts a turn back over every path its diff lists. A path whose file is not what the turn left is
 * somebody's later work and is skipped; one the turn added is deleted, with the folders it made
 * that are left empty; the others are written from the before tree through a temporary index. It
 * never runs checkout, reset, stash or clean, and the real index and HEAD are not touched.
 * `stopped` is set when git ran out of time part-way.
 */
export async function undoCheckpoint(
  exec: Exec,
  snapshots: Snapshots,
): Promise<UndoResult & { stopped: boolean }> {
  const { top, before } = snapshots;
  const all = await changes(exec, snapshots);
  const skips: UndoSkip[] = [];
  const candidates: Change[] = [];
  for (const change of all) {
    const why = await refusal(top, change);
    if (why !== null) skips.push(why);
    else if (await ignores(exec, top, change.path)) skips.push("ignored");
    else candidates.push(change);
  }
  const now = await entriesNow(
    exec,
    top,
    candidates.map((change) => change.path),
  );
  const added: string[] = [];
  const back: string[] = [];
  for (const change of candidates) {
    const here = now.get(change.path);
    if (!same(here, change.end)) skips.push(same(here, change.before) ? "same" : "changed");
    else if (change.before === null) added.push(change.path);
    else {
      await present(exec, top, change.before);
      back.push(change.path);
    }
  }
  let restored = 0;
  for (const path of added) {
    try {
      await unlink(join(top, path));
      restored += 1;
      await prune(exec, snapshots, dirname(path));
    } catch {
      skips.push("write");
    }
  }
  let stopped = false;
  let at = 0;
  try {
    if (back.length > 0) {
      await withIndex(async (index) => {
        const env = { GIT_INDEX_FILE: index };
        await git(exec, top, ["read-tree", before], env);
        for (; at < back.length; at += 1) {
          try {
            await git(exec, top, ["checkout-index", "-f", "--", back[at] ?? ""], env);
            restored += 1;
          } catch (error) {
            if (killed(error)) throw error;
            skips.push("write");
          }
        }
      });
    }
  } catch {
    // Part of the turn may be back already: what is left is said, and the checkpoint stays.
    stopped = true;
    for (; at < back.length; at += 1) skips.push("stopped");
  }
  const counts = new Map<UndoSkip, number>();
  for (const reason of skips) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return {
    turnId: snapshots.turnId,
    restored,
    skipped: [...counts].map(([reason, count]) => ({ reason, count })),
    stopped,
  };
}

/**
 * Removes the folders above a deleted file that are now empty and the turn made: not in the before
 * tree, and born after the turn began. A tree has no empty folder, so the birth time is what tells
 * an empty folder of the owner's from the turn's; where the file system has none, the folder stays.
 */
async function prune(exec: Exec, snapshots: Snapshots, folder: string): Promise<void> {
  const { top, before, beganAt } = snapshots;
  if (beganAt === undefined) return;
  for (let dir = folder; dir !== "." && dir !== "" && dir !== "/"; dir = dirname(dir)) {
    const kind = await git(exec, top, ["cat-file", "-t", `${before}:${dir}`])
      .then((out) => out.trim())
      .catch(() => null);
    if (kind !== null) return;
    try {
      const { birthtimeMs } = await stat(join(top, dir));
      if (!(birthtimeMs > beganAt)) return;
      // Refused when the folder holds anything: then it is not only the turn's.
      await rmdir(join(top, dir));
    } catch {
      return;
    }
  }
}

/**
 * Checkpoints for the last ten turns of each agent, from git: a snapshot of the work tree when a
 * turn starts and another when it ends, kept when they differ. The list shows what each turn
 * changed, shell commands too; undo puts back the newest, then the one before. Each agent's turns
 * and undos wait for each other. Whatever goes wrong in a snapshot, the turn is not kept; nothing
 * here fails or waits a turn.
 */
export function createUndo(ports: UndoPorts): Undo {
  const agents = new Map<string, Agent>();
  const { exec } = ports;
  function agentOf(agentId: string): Agent {
    let agent = agents.get(agentId);
    if (agent === undefined) {
      agent = { kept: [], taken: null, working: false, queue: Promise.resolve() };
      agents.set(agentId, agent);
    }
    return agent;
  }
  /** Runs `work` after the agent's earlier git work, and before its later. */
  function serial<T>(agent: Agent, work: () => Promise<T>): Promise<T> {
    const next = agent.queue.then(work);
    agent.queue = next.catch(() => undefined);
    return next;
  }
  const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
  return {
    begin(agentId, folder) {
      const agent = agentOf(agentId);
      agent.working = true;
      const beganAt = Date.now();
      return serial(agent, async () => {
        agent.taken = null;
        if (!ports.enabled()) {
          agent.kept = [];
          return;
        }
        try {
          const top = await workTree(exec, folder);
          if (top !== null) agent.taken = { top, tree: await snapshot(exec, top), beganAt };
        } catch (error) {
          ports.log(`[office] undo snapshot failed: ${errorText(error)}`);
        }
        // A turn not snapshotted would be a gap: the turns before it are no longer one step back.
        if (agent.taken === null) agent.kept = [];
      });
    },
    end(agentId, turnId) {
      const agent = agents.get(agentId);
      if (agent === undefined) return Promise.resolve();
      agent.working = false;
      const endedAt = new Date().toISOString();
      return serial(agent, async () => {
        const taken = agent.taken;
        agent.taken = null;
        if (taken === null || turnId === null || !ports.enabled()) return;
        try {
          const end = await snapshot(exec, taken.top);
          if (end === taken.tree) return;
          const snapshots = {
            top: taken.top,
            turnId,
            before: taken.tree,
            end,
            beganAt: taken.beganAt,
          };
          const all = await changes(exec, snapshots);
          if (all.length === 0) return;
          const kept = { ...snapshots, endedAt, ...(await listed(exec, snapshots, all)) };
          if (agents.get(agentId) !== agent) return;
          agent.kept = [...agent.kept, kept].slice(-CHECKPOINTS_KEPT);
        } catch (error) {
          ports.log(`[office] undo read failed: ${errorText(error)}`);
        }
      });
    },
    async status(agentId) {
      const kept = agents.get(agentId)?.kept ?? [];
      const turns: Checkpoint[] = [];
      for (const one of kept.toReversed()) {
        turns.push({
          turnId: one.turnId,
          endedAt: one.endedAt,
          files: one.files,
          more: one.more,
          usable: await usable(exec, one),
        });
      }
      return turns;
    },
    async undo(agentId) {
      const agent = agents.get(agentId);
      if (agent === undefined) return null;
      if (agent.working) throw new Error(WORKING);
      return serial(agent, async () => {
        if (agent.working) throw new Error(WORKING);
        const newest = agent.kept.at(-1);
        if (newest === undefined) return null;
        if (!(await usable(exec, newest))) throw new Error(GONE);
        let result: Awaited<ReturnType<typeof undoCheckpoint>>;
        try {
          result = await undoCheckpoint(exec, newest);
        } catch (error) {
          if (errorText(error) === GONE) throw error;
          ports.log(`[office] undo failed: ${errorText(error)}`);
          throw new Error("git could not read this checkpoint, so nothing was put back", {
            cause: error,
          });
        }
        // Stopped part-way, it stays: an undo again puts back the rest.
        if (!result.stopped) agent.kept = agent.kept.filter((one) => one !== newest);
        return { turnId: result.turnId, restored: result.restored, skipped: result.skipped };
      });
    },
    forget(agentId) {
      agents.delete(agentId);
    },
  };
}
