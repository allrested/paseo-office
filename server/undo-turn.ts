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

export interface UndoStatus {
  /** The turns kept, newest first. */
  turns: Checkpoint[];
  /** Why the list was emptied, when a turn could not be snapshotted; null since the last good one. */
  gap: string | null;
}

export interface Undo {
  /** A turn starts: the work tree is snapshotted when the setting is on, else the checkpoints are dropped. */
  begin(agentId: string, folder: string): Promise<void>;
  /** The turn ended: kept with a second snapshot when it changed something. */
  end(agentId: string, turnId: string | null): Promise<void>;
  status(agentId: string): Promise<UndoStatus>;
  /**
   * Puts back the turn the owner was shown, which must still be the newest. Refused while this
   * agent, or another in the same work tree, is in a turn, or when git pruned its snapshot.
   */
  undo(agentId: string, turnId: string): Promise<UndoResult>;
  forget(agentId: string): void;
}

/** What an undo may be told from outside: whether to stop before its next act, and a folder's times. */
export interface UndoOptions {
  /** Why the undo must stop before its next act (an agent began a turn); null to go on. */
  halt?: () => UndoSkip | null;
  /** A folder's birth and change time (ms); the file system's by default. */
  times?: (path: string) => Promise<{ birth: number; change: number }>;
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

/**
 * An agent's checkpoints, the snapshot of the turn it is in, the folder it works in (and that
 * folder's work tree once known), whether a gap emptied its list, and the queue its git work waits in.
 */
interface Agent {
  kept: Kept[];
  taken: Taken | null;
  working: boolean;
  folder: string | null;
  place: { folder: string; top: string | null } | null;
  gap: boolean;
  queue: Promise<unknown>;
}

const GONE = "this checkpoint's snapshot is gone";
const WORKING = "the agent is working: undo when its turn has ended";
const NOT_NEWEST = "that turn is no longer the newest: look again";
const OTHERS = "another agent is working in this folder: undo when it has stopped";
const GAP = "the last turn could not be snapshotted: earlier checkpoints were dropped";

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
 * quoted, and `-z` needs a standard input the calls here do not have. The path goes as `./<path>`,
 * so a name such as `:!x` or `:(top)x` is a name and not pathspec magic.
 */
async function ignores(exec: Exec, top: string, path: string): Promise<boolean> {
  try {
    // It refuses the literal-pathspec setting the other calls have; the `./` keeps the path a path.
    await git(exec, top, ["check-ignore", "-q", "--", `./${path}`], { GIT_LITERAL_PATHSPECS: "0" });
    return true;
  } catch (error) {
    // Exit status 1 is "not ignored"; any other failure is a git that cannot say.
    if ((error as { code?: unknown }).code === 1) return false;
    throw error;
  }
}

/** Whether git records the executable bit in this repository. */
async function keepsModes(exec: Exec, top: string): Promise<boolean> {
  return git(exec, top, ["config", "--type=bool", "core.fileMode"])
    .then((out) => out.trim() !== "false")
    .catch(() => true);
}

/**
 * A path's entry in the work tree now, as the snapshots write one (`<mode> <blob>`, hashed by git
 * with its filters, `*` for the mode where git keeps none); null where there is no file, "other"
 * where there is something that is not a plain file.
 */
async function entryNow(
  exec: Exec,
  top: string,
  path: string,
  modes: boolean,
): Promise<string | null> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(join(top, path));
  } catch {
    return null;
  }
  if (!info.isFile()) return "other";
  const blob = (await git(exec, top, ["hash-object", "--", path])).trim();
  const mode = info.mode & 0o111 ? "100755" : "100644";
  return `${modes ? mode : "*"} ${blob}`;
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
function same(now: string | null, entry: string | null): boolean {
  if (now === "other") return false;
  if (now === null || entry === null) return now === entry;
  return now.startsWith("* ") ? now.slice(2) === entry.split(" ")[1] : now === entry;
}

/**
 * What to do with one path, looked at right before the act: "act" when the file is what the turn
 * left, else why it stays.
 */
async function verdict(
  exec: Exec,
  top: string,
  change: Change,
  modes: boolean,
): Promise<UndoSkip | "act"> {
  const why = await refusal(top, change);
  if (why !== null) return why;
  if (await ignores(exec, top, change.path)) return "ignored";
  const here = await entryNow(exec, top, change.path, modes);
  if (same(here, change.end)) return "act";
  return same(here, change.before) ? "same" : "changed";
}

/** Whether something the undo deleted was on this path's way: its folder, a file in it, or its case twin. */
function inTheWay(path: string, deleted: readonly string[]): boolean {
  const mine = path.toLowerCase();
  return deleted.some((gone) => {
    const theirs = gone.toLowerCase();
    return theirs === mine || theirs.startsWith(`${mine}/`) || mine.startsWith(`${theirs}/`);
  });
}

async function folderTimes(path: string): Promise<{ birth: number; change: number }> {
  const { birthtimeMs, ctimeMs } = await stat(path);
  return { birth: birthtimeMs, change: ctimeMs };
}

/**
 * Puts a turn back over every path its diff lists, in two steps. First the files the turn added
 * are deleted, with the folders it made that are left empty; then each file to write back is
 * looked at afresh, so a folder the turn swapped for a file (or a file renamed by case alone) comes
 * back once the turn's file is gone. Each path is looked at right before its act: a file that is
 * not what the turn left is somebody's later work and is skipped. Writes go through a temporary
 * index read from the before tree; it never runs checkout, reset, stash or clean, and the real
 * index and HEAD are not touched. `stopped` is set when the undo did not finish and an undo again
 * may do more: git failed or ran out of time, an agent began a turn, or a file to write back was
 * left where the undo had just deleted something on its way.
 */
export async function undoCheckpoint(
  exec: Exec,
  snapshots: Snapshots,
  options: UndoOptions = {},
): Promise<UndoResult & { stopped: boolean }> {
  const { top, before } = snapshots;
  const halt = options.halt ?? (() => null);
  const times = options.times ?? folderTimes;
  const all = await changes(exec, snapshots);
  for (const change of all) {
    if (change.before !== null && modeOf(change.before)?.startsWith("100")) {
      await present(exec, top, change.before);
    }
  }
  const modes = await keepsModes(exec, top);
  const first = await deleteAdded(
    exec,
    snapshots,
    all.filter((one) => one.before === null),
    { modes, halt, times },
  );
  const { skips, deleted } = first;
  let { restored, stop } = first;
  let again = false;
  const back = all.filter((one) => one.before !== null);
  let at = 0;
  try {
    if (back.length > 0 && stop === null) {
      await withIndex(async (index) => {
        const env = { GIT_INDEX_FILE: index };
        // Read when the first file is due: a path git refuses is said under its own reason first.
        let read = false;
        for (; at < back.length; at += 1) {
          const change = back[at] as Change;
          const what = await verdict(exec, top, change, modes);
          if (what !== "act") {
            // Left where the undo itself just removed something: an undo again may put it back.
            const later = what !== "same" && inTheWay(change.path, deleted);
            again ||= later;
            skips.push(later ? "retry" : what);
            continue;
          }
          stop = halt();
          if (stop !== null) return;
          if (!read) {
            await git(exec, top, ["read-tree", before], env);
            read = true;
          }
          try {
            await git(exec, top, ["checkout-index", "-f", "--", change.path], env);
            restored += 1;
          } catch (error) {
            if (killed(error)) throw error;
            skips.push("write");
          }
        }
      });
    }
  } catch {
    stop = "stopped";
  }
  const left = stop;
  if (left !== null) for (; at < back.length; at += 1) skips.push(left);
  const counts = new Map<UndoSkip, number>();
  for (const reason of skips) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return {
    turnId: snapshots.turnId,
    restored,
    skipped: [...counts].map(([reason, count]) => ({ reason, count })),
    stopped: stop !== null || again,
  };
}

/**
 * The undo's first step: each file the turn added that is still what the turn left is deleted,
 * looked at right before, with the folders the turn made that are left empty.
 */
async function deleteAdded(
  exec: Exec,
  snapshots: Snapshots,
  added: readonly Change[],
  how: {
    modes: boolean;
    halt: () => UndoSkip | null;
    times: (path: string) => Promise<{ birth: number; change: number }>;
  },
): Promise<{ restored: number; deleted: string[]; skips: UndoSkip[]; stop: UndoSkip | null }> {
  const { top } = snapshots;
  const skips: UndoSkip[] = [];
  const deleted: string[] = [];
  let stop: UndoSkip | null = null;
  for (const change of added) {
    if (stop !== null) {
      skips.push(stop);
      continue;
    }
    let what: UndoSkip | "act";
    try {
      what = await verdict(exec, top, change, how.modes);
    } catch {
      stop = "stopped";
      skips.push(stop);
      continue;
    }
    if (what === "act") stop = how.halt();
    if (what !== "act" || stop !== null) {
      skips.push(stop ?? (what as UndoSkip));
      continue;
    }
    try {
      await unlink(join(top, change.path));
    } catch {
      skips.push("write");
      continue;
    }
    deleted.push(change.path);
    await prune(exec, snapshots, dirname(change.path), how.halt, how.times);
  }
  return { restored: deleted.length, deleted, skips, stop };
}

/**
 * Removes the folders above a deleted file that are now empty and the turn made: not a folder in
 * the before tree, and born after the turn began. A tree has no empty folder, so the birth time is
 * what tells an empty folder of the owner's from the turn's; where the file system keeps none (no
 * birth time, or one that reads as the change time) the folder stays.
 */
async function prune(
  exec: Exec,
  snapshots: Snapshots,
  folder: string,
  halt: () => UndoSkip | null,
  times: (path: string) => Promise<{ birth: number; change: number }>,
): Promise<void> {
  const { top, before, beganAt } = snapshots;
  if (beganAt === undefined) return;
  for (let dir = folder; dir !== "." && dir !== "" && dir !== "/"; dir = dirname(dir)) {
    const kind = await git(exec, top, ["cat-file", "-t", `${before}:${dir}`])
      .then((out) => out.trim())
      .catch(() => null);
    if (kind === "tree") return;
    try {
      const place = join(top, dir);
      if ((await lstat(place)).isSymbolicLink()) return;
      const { birth, change } = await times(place);
      if (!(birth > 0) || birth === change || !(birth > beganAt) || halt() !== null) return;
      // Refused when the folder holds anything: then it is not only the turn's.
      await rmdir(place);
    } catch {
      return;
    }
  }
}

/**
 * Checkpoints for the last ten turns of each agent, from git: a snapshot of the work tree when a
 * turn starts and another when it ends, kept when they differ. The list shows what each turn
 * changed, shell commands too; undo puts back the newest, then the one before. Each agent's turns
 * and undos wait for each other, and an undo stops when any agent in its work tree begins a turn.
 * Whatever goes wrong in a snapshot, the turn is not kept; nothing here fails or waits a turn.
 */
export function createUndo(ports: UndoPorts): Undo {
  const agents = new Map<string, Agent>();
  const { exec } = ports;
  function agentOf(agentId: string): Agent {
    let agent = agents.get(agentId);
    if (agent === undefined) {
      agent = {
        kept: [],
        taken: null,
        working: false,
        folder: null,
        place: null,
        gap: false,
        queue: Promise.resolve(),
      };
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
  /** A turn not kept is a gap: the turns before it are no longer one step back each. */
  function drop(agent: Agent): void {
    if (agent.kept.length > 0) agent.gap = true;
    agent.kept = [];
  }
  /** The work tree an agent's folder is in, as last read for that folder; undefined when not read yet. */
  function knownTop(agent: Agent): string | null | undefined {
    return agent.place !== null && agent.place.folder === agent.folder
      ? agent.place.top
      : undefined;
  }
  /** The other agents in a turn whose work tree is `top`, or may be (theirs not read yet). */
  function othersIn(agent: Agent, top: string): boolean {
    for (const other of agents.values()) {
      if (other === agent || !other.working) continue;
      const theirs = knownTop(other);
      if (theirs === undefined || theirs === top) return true;
    }
    return false;
  }
  const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
  return {
    begin(agentId, folder) {
      const agent = agentOf(agentId);
      agent.working = true;
      agent.folder = folder;
      const beganAt = Date.now();
      return serial(agent, async () => {
        agent.taken = null;
        if (!ports.enabled()) {
          drop(agent);
          return;
        }
        try {
          const top = await workTree(exec, folder);
          agent.place = { folder, top };
          if (top !== null) agent.taken = { top, tree: await snapshot(exec, top), beganAt };
        } catch (error) {
          ports.log(`[office] undo snapshot failed: ${errorText(error)}`);
        }
        if (agent.taken === null) drop(agent);
        else agent.gap = false;
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
        if (taken === null) return;
        if (!ports.enabled()) {
          drop(agent);
          return;
        }
        try {
          const end = await snapshot(exec, taken.top);
          if (end === taken.tree) return;
          if (turnId === null) {
            drop(agent);
            return;
          }
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
          drop(agent);
        }
      });
    },
    async status(agentId) {
      const agent = agents.get(agentId);
      const turns: Checkpoint[] = [];
      for (const one of (agent?.kept ?? []).toReversed()) {
        turns.push({
          turnId: one.turnId,
          endedAt: one.endedAt,
          files: one.files,
          more: one.more,
          usable: await usable(exec, one),
        });
      }
      return { turns, gap: agent?.gap ? GAP : null };
    },
    async undo(agentId, turnId) {
      const agent = agents.get(agentId);
      if (agent === undefined) throw new Error(NOT_NEWEST);
      if (agent.working) throw new Error(WORKING);
      return serial(agent, async () => {
        if (agent.working) throw new Error(WORKING);
        const newest = agent.kept.at(-1);
        if (newest === undefined || newest.turnId !== turnId) throw new Error(NOT_NEWEST);
        // The tops not read yet are read now, so an agent at work elsewhere is no reason.
        for (const other of agents.values()) {
          if (
            other !== agent &&
            other.working &&
            other.folder !== null &&
            knownTop(other) === undefined
          ) {
            other.place = { folder: other.folder, top: await workTree(exec, other.folder) };
          }
        }
        if (othersIn(agent, newest.top)) throw new Error(OTHERS);
        if (!(await usable(exec, newest))) throw new Error(GONE);
        // Looked at before each act: a turn that begins meanwhile, here or in the same tree, stops it.
        const halt = (): UndoSkip | null =>
          agent.working || othersIn(agent, newest.top) ? "began" : null;
        let result: Awaited<ReturnType<typeof undoCheckpoint>>;
        try {
          result = await undoCheckpoint(exec, newest, { halt });
        } catch (error) {
          if (errorText(error) === GONE) throw error;
          ports.log(`[office] undo failed: ${errorText(error)}`);
          throw new Error("git could not read this checkpoint, so nothing was put back", {
            cause: error,
          });
        }
        // Not finished, it stays: an undo again puts back the rest.
        if (!result.stopped) agent.kept = agent.kept.filter((one) => one !== newest);
        return { turnId: result.turnId, restored: result.restored, skipped: result.skipped };
      });
    },
    forget(agentId) {
      agents.delete(agentId);
    },
  };
}
