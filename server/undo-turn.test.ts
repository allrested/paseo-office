import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Exec } from "./repo-age.js";
import {
  CHECKPOINT_FILES,
  CHECKPOINTS_KEPT,
  createUndo,
  undoCheckpoint,
  type Undo,
} from "./undo-turn.js";

const run = promisify(execFile);
const exec: Exec = (command, args, options) => run(command, args, options);

let root = "";
let repo = "";
let outside = "";
let on = true;
let undo: Undo;
const logged: string[] = [];

async function git(...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd: repo,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  return stdout;
}

async function write(path: string, text: string | Buffer, folder = repo): Promise<void> {
  await mkdir(join(folder, path, ".."), { recursive: true });
  await writeFile(join(folder, path), text);
}

const read = (path: string) => readFile(join(repo, path), "utf8");

async function missing(path: string): Promise<boolean> {
  return stat(join(repo, path)).then(
    () => false,
    () => true,
  );
}

const NOT_NEWEST = "that turn is no longer the newest: look again";

/** The turns agent a1 has kept, newest first. */
async function kept(agentId = "a1") {
  return (await undo.status(agentId)).turns;
}

/** One turn of agent a1: begun, the work done in it, ended. */
async function turn(turnId: string, work: () => Promise<void>, agentId = "a1"): Promise<void> {
  await undo.begin(agentId, repo);
  await work();
  await undo.end(agentId, turnId);
}

/** Everything of the repository's state that an undo must leave alone. */
async function state(): Promise<string> {
  const index = await readFile(join(repo, ".git", "index"));
  return [
    index.toString("hex"),
    await git("rev-parse", "HEAD"),
    await git("stash", "list"),
    await git("for-each-ref"),
  ].join("\n");
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "office-undo-test-"));
  repo = join(root, "repo");
  outside = join(root, "outside");
  await mkdir(repo);
  await mkdir(outside);
  await git("init", "-q", "-b", "main");
  await git("config", "user.email", "a@example.test");
  await git("config", "user.name", "A");
  await git("config", "commit.gpgsign", "false");
  await write(".gitignore", "build/\n");
  await write("a.txt", "A0\n");
  await write("src/b.txt", "B0\n");
  await write("gone.txt", "G0\n");
  await git("add", "-A");
  await git("commit", "-q", "-m", "first");
  on = true;
  logged.length = 0;
  undo = createUndo({ exec, enabled: () => on, log: (line) => logged.push(line) });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("ten turns are kept, newest first, and the eleventh drops the first", async () => {
  expect(CHECKPOINTS_KEPT).toBe(10);
  for (let n = 1; n <= 11; n += 1) {
    await turn(`t${n}`, () => write("a.txt", `A${n}\n`));
  }
  const turns = await kept();
  expect(turns.map((one) => one.turnId)).toEqual([
    "t11",
    "t10",
    "t9",
    "t8",
    "t7",
    "t6",
    "t5",
    "t4",
    "t3",
    "t2",
  ]);
  expect(turns[0]).toMatchObject({
    files: [{ path: "a.txt", kind: "modified", added: 1, removed: 1 }],
    more: 0,
    usable: true,
  });
  expect(Number.isNaN(Date.parse(turns[0]?.endedAt ?? ""))).toBe(false);
});

test("a turn that changed nothing is not kept", async () => {
  await turn("t1", () => write("a.txt", "A1\n"));
  await turn("t2", async () => {});
  expect((await kept()).map((one) => one.turnId)).toEqual(["t1"]);
});

test("the diff lists an edit, a new file, a deletion and what a shell command changed", async () => {
  await turn("t1", async () => {
    await write("a.txt", "A0\nA1\nA2\n");
    await write("new.txt", "N1\nN2\n");
    await rm(join(repo, "gone.txt"));
    // As `sed -i` would: no tool call names it.
    await run("sh", ["-c", "printf 'B1\\n' > src/b.txt"], { cwd: repo });
  });
  const [only] = await kept();
  expect(only?.files).toEqual([
    { path: "a.txt", kind: "modified", added: 2, removed: 0 },
    { path: "gone.txt", kind: "deleted", added: 0, removed: 1 },
    { path: "new.txt", kind: "added", added: 2, removed: 0 },
    { path: "src/b.txt", kind: "modified", added: 1, removed: 1 },
  ]);
});

test("a binary file has no counts, and an odd name is read whole", async () => {
  const odd = 'my "odd"\tfile\nname.txt';
  await turn("t1", async () => {
    await write("blob.bin", Buffer.from([0, 1, 2, 0, 255]));
    await write(odd, "x\n");
  });
  const [only] = await kept();
  expect(only?.files).toEqual([
    { path: "blob.bin", kind: "added", added: null, removed: null },
    { path: odd, kind: "added", added: 1, removed: 0 },
  ]);
  expect(await undo.undo("a1", "t1")).toEqual({ turnId: "t1", restored: 2, skipped: [] });
  expect(await missing(odd)).toBe(true);
});

test("a turn lists 200 files at most and counts the rest", async () => {
  expect(CHECKPOINT_FILES).toBe(200);
  await turn("t1", async () => {
    for (let n = 0; n < 201; n += 1) await write(`many/f${String(n).padStart(3, "0")}.txt`, "x\n");
  });
  const [only] = await kept();
  expect(only?.files).toHaveLength(200);
  expect(only?.more).toBe(1);
  expect((await undo.undo("a1", "t1"))?.restored).toBe(201);
  expect(await missing("many")).toBe(true);
});

test("undo puts back the newest turn, then the one before, down to the original", async () => {
  await turn("t1", async () => {
    await write("a.txt", "A1\n");
    await write("new.txt", "N\n");
  });
  await turn("t2", async () => {
    await write("a.txt", "A2\n");
    await rm(join(repo, "gone.txt"));
  });
  expect(await undo.undo("a1", "t2")).toEqual({ turnId: "t2", restored: 2, skipped: [] });
  expect(await read("a.txt")).toBe("A1\n");
  expect(await read("gone.txt")).toBe("G0\n");
  expect((await kept()).map((one) => one.turnId)).toEqual(["t1"]);
  expect(await undo.undo("a1", "t1")).toEqual({ turnId: "t1", restored: 2, skipped: [] });
  expect(await read("a.txt")).toBe("A0\n");
  expect(await missing("new.txt")).toBe(true);
  expect(await kept()).toEqual([]);
  await expect(undo.undo("a1", "t1")).rejects.toThrow(NOT_NEWEST);
  // The undo happened outside a turn, so it is no checkpoint of its own.
  expect(await git("status", "--porcelain")).toBe("");
});

test("a file edited, deleted or made again after the turn is skipped; the rest is put back", async () => {
  await turn("t1", async () => {
    await write("a.txt", "A1\n");
    await write("src/b.txt", "B1\n");
    await write("new.txt", "N1\n");
    await write("other.txt", "O1\n");
    await rm(join(repo, "gone.txt"));
  });
  await write("a.txt", "A2, by the owner\n");
  await rm(join(repo, "src/b.txt"));
  await write("new.txt", "N2, by the owner\n");
  await write("gone.txt", "somebody's new one\n");
  expect(await undo.undo("a1", "t1")).toEqual({
    turnId: "t1",
    restored: 1,
    skipped: [{ reason: "changed", count: 4 }],
  });
  expect(await read("a.txt")).toBe("A2, by the owner\n");
  expect(await missing("src/b.txt")).toBe(true);
  expect(await read("new.txt")).toBe("N2, by the owner\n");
  expect(await read("gone.txt")).toBe("somebody's new one\n");
  expect(await missing("other.txt")).toBe(true);
  // Every path was dealt with, so the checkpoint is gone.
  expect(await kept()).toEqual([]);
});

test("the executable bit is put back, and a folder the turn made goes with its file", async () => {
  await write("src/run.sh", "#!/bin/sh\n");
  await chmod(join(repo, "src/run.sh"), 0o755);
  await mkdir(join(repo, "kept"));
  await git("add", "-A");
  await git("commit", "-q", "-m", "script");
  await turn("t1", async () => {
    await chmod(join(repo, "src/run.sh"), 0o644);
    await write("deep/er/new.txt", "N\n");
    await write("kept/new.txt", "N\n");
    await write("src/c.txt", "C\n");
  });
  expect((await undo.undo("a1", "t1"))?.restored).toBe(4);
  expect((await stat(join(repo, "src/run.sh"))).mode & 0o111).not.toBe(0);
  expect(await missing("deep")).toBe(true);
  // An empty folder that was there before the turn stays; so does one the tree had.
  expect((await stat(join(repo, "kept"))).isDirectory()).toBe(true);
  expect(await read("src/b.txt")).toBe("B0\n");
});

test("an ignored path, a link, a path under a linked folder and a submodule are refused", async () => {
  const sub = join(repo, "sub");
  await mkdir(sub);
  await run("git", ["init", "-q"], { cwd: sub });
  await write("s.txt", "S0\n", sub);
  await run("git", ["-c", "user.email=a@x", "-c", "user.name=A", "add", "-A"], { cwd: sub });
  await run("git", ["-c", "user.email=a@x", "-c", "user.name=A", "commit", "-q", "-m", "s"], {
    cwd: sub,
  });
  await write("d/f.txt", "F0\n");
  await symlink("a.txt", join(repo, "ln"));
  await git("add", "-A");
  await git("commit", "-q", "-m", "more");
  await turn("t1", async () => {
    await write("notes.log", "L1\n");
    await rm(join(repo, "ln"));
    await symlink("src/b.txt", join(repo, "ln"));
    await write("d/f.txt", "F1\n");
    await write("s.txt", "S1\n", sub);
    await run("git", ["-c", "user.email=a@x", "-c", "user.name=A", "commit", "-qam", "s1"], {
      cwd: sub,
    });
    await write("a.txt", "A1\n");
  });
  // After the turn: the owner ignores *.log, and moves d out of the tree behind a link.
  await write(".gitignore", "build/\n*.log\n");
  await rename(join(repo, "d"), join(outside, "d"));
  await symlink(join(outside, "d"), join(repo, "d"));
  const result = await undo.undo("a1", "t1");
  expect(result?.restored).toBe(1);
  expect(result?.skipped).toEqual(
    expect.arrayContaining([
      { reason: "ignored", count: 1 },
      { reason: "link", count: 1 },
      { reason: "linkedFolder", count: 1 },
      { reason: "submodule", count: 1 },
    ]),
  );
  expect(result?.skipped).toHaveLength(4);
  expect(await read("a.txt")).toBe("A0\n");
  expect(await read("notes.log")).toBe("L1\n");
  expect(await readFile(join(outside, "d", "f.txt"), "utf8")).toBe("F1\n");
  expect(await run("readlink", [join(repo, "ln")]).then((out) => out.stdout)).toBe("src/b.txt\n");
});

test("a file made where a deleted file's folder was is not removed to put the folder back", async () => {
  await turn("t1", () => rm(join(repo, "src"), { recursive: true }));
  await write("src", "the owner's file\n");
  expect(await undo.undo("a1", "t1")).toEqual({
    turnId: "t1",
    restored: 0,
    skipped: [{ reason: "changed", count: 1 }],
  });
  expect(await read("src")).toBe("the owner's file\n");
});

test("a file that became a link after the turn is left alone", async () => {
  await turn("t1", () => write("a.txt", "A1\n"));
  await write("target.txt", "A1\n", outside);
  await rm(join(repo, "a.txt"));
  await symlink(join(outside, "target.txt"), join(repo, "a.txt"));
  expect(await undo.undo("a1", "t1")).toEqual({
    turnId: "t1",
    restored: 0,
    skipped: [{ reason: "link", count: 1 }],
  });
  expect(await readFile(join(outside, "target.txt"), "utf8")).toBe("A1\n");
});

/** A tree holding `text` at a path of folders, made by hand: git's own commands refuse such names. */
async function craft(parts: string[], text: string): Promise<string> {
  const hashed = await piped(["hash-object", "-w", "--stdin"], text);
  let entry = `100644 blob ${hashed}\t${parts.at(-1)}\n`;
  for (const part of parts.slice(0, -1).toReversed()) {
    const tree = await piped(["mktree"], entry);
    entry = `040000 tree ${tree}\t${part}\n`;
  }
  return piped(["mktree"], entry);
}

/** A git command in the repository that reads `input`, and its output trimmed. */
function piped(args: string[], input: string): Promise<string> {
  return new Promise((done, fail) => {
    const child = execFile("git", args, { cwd: repo }, (error, out) => {
      if (error) fail(error);
      else done(out.trim());
    });
    child.stdin?.end(input);
  });
}

test("a path out of the tree by .. and a path in .git are refused, never touched", async () => {
  await write("secret.txt", "S1\n", outside);
  const config = await readFile(join(repo, ".git", "config"), "utf8");
  const up = {
    top: repo,
    turnId: "t1",
    before: await craft(["..", "outside", "secret.txt"], "S0\n"),
    end: await craft(["..", "outside", "secret.txt"], "S1\n"),
  };
  expect(await undoCheckpoint(exec, up)).toMatchObject({
    restored: 0,
    skipped: [{ reason: "outside", count: 1 }],
  });
  const inGit = {
    top: repo,
    turnId: "t2",
    before: await craft([".git", "config"], "[core]\n\thooksPath = /tmp/evil\n"),
    end: await craft([".git", "config"], config),
  };
  expect(await undoCheckpoint(exec, inGit)).toMatchObject({
    restored: 0,
    skipped: [{ reason: "git", count: 1 }],
  });
  expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("S1\n");
  expect(await readFile(join(repo, ".git", "config"), "utf8")).toBe(config);
});

test("a snapshot git pruned makes its checkpoint unusable, and its undo touches nothing", async () => {
  await turn("t1", () => write("a.txt", "A1\n"));
  await turn("t2", () => write("a.txt", "A2, the turn's\n"));
  // The end tree of t2 is a loose object no ref holds: delete it as `git prune` would.
  const tree = await treeNow();
  await rm(join(repo, ".git", "objects", tree.slice(0, 2), tree.slice(2)));
  const [newest, older] = await kept();
  expect(newest).toMatchObject({ turnId: "t2", usable: false });
  expect(older).toMatchObject({ turnId: "t1", usable: true });
  await expect(undo.undo("a1", "t2")).rejects.toThrow("this checkpoint's snapshot is gone");
  expect(await read("a.txt")).toBe("A2, the turn's\n");
  expect((await kept()).map((one) => one.turnId)).toEqual(["t2", "t1"]);
});

/** The tree of the work tree as it is now, as a snapshot makes it (the same objects, by content). */
async function treeNow(): Promise<string> {
  const env = { ...process.env, GIT_INDEX_FILE: join(root, "probe-index") };
  await run("git", ["read-tree", "HEAD"], { cwd: repo, env });
  await run("git", ["add", "-A"], { cwd: repo, env });
  return (await run("git", ["write-tree"], { cwd: repo, env })).stdout.trim();
}

test("undo is refused while the agent is at work, and touches nothing", async () => {
  await turn("t1", () => write("a.txt", "A1\n"));
  await undo.begin("a1", repo);
  await write("a.txt", "A2\n");
  await expect(undo.undo("a1", "t1")).rejects.toThrow(
    "the agent is working: undo when its turn has ended",
  );
  expect(await read("a.txt")).toBe("A2\n");
  await undo.end("a1", "t2");
  expect((await undo.undo("a1", "t2"))?.turnId).toBe("t2");
  expect(await read("a.txt")).toBe("A1\n");
});

test("the index, HEAD, stash and refs are byte for byte the same after a snapshot and after an undo", async () => {
  await write("a.txt", "staged\n");
  await git("add", "a.txt");
  await write("a.txt", "staged, then edited\n");
  await write("src/b.txt", "B stashed\n");
  await git("stash", "push", "-q", "src/b.txt");
  await write("loose.txt", "untracked\n");
  const porcelain = await git("status", "--porcelain=v2");
  const head = await git("rev-parse", "HEAD");
  const settled = await state();
  await undo.begin("a1", repo);
  expect(await state()).toBe(settled);
  await write("a.txt", "the turn's\n");
  await write("loose.txt", "the turn's loose\n");
  await undo.end("a1", "t1");
  expect(await state()).toBe(settled);
  expect((await undo.undo("a1", "t1"))?.restored).toBe(2);
  expect(await state()).toBe(settled);
  expect(await read("a.txt")).toBe("staged, then edited\n");
  expect(await read("loose.txt")).toBe("untracked\n");
  expect(await git("status", "--porcelain=v2")).toBe(porcelain);
  expect(await git("rev-parse", "HEAD")).toBe(head);
});

test("git timing out part-way keeps the checkpoint and says it stopped", async () => {
  let slow = true;
  let writes = 0;
  const flaky: Exec = async (command, args, options) => {
    if (slow && args[0] === "checkout-index") {
      writes += 1;
      if (writes === 2) {
        throw Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM" });
      }
    }
    return exec(command, args, options);
  };
  undo = createUndo({ exec: flaky, enabled: () => true, log: (line) => logged.push(line) });
  await turn("t1", async () => {
    await write("a.txt", "A1\n");
    await write("gone.txt", "G1\n");
    await write("src/b.txt", "B1\n");
  });
  expect(await undo.undo("a1", "t1")).toEqual({
    turnId: "t1",
    restored: 1,
    skipped: [{ reason: "stopped", count: 2 }],
  });
  expect((await kept()).map((one) => one.turnId)).toEqual(["t1"]);
  slow = false;
  // Again: what the first undo put back is already as before the turn, and the rest follows.
  expect(await undo.undo("a1", "t1")).toEqual({
    turnId: "t1",
    restored: 2,
    skipped: [{ reason: "same", count: 1 }],
  });
  expect(await read("a.txt")).toBe("A0\n");
  expect(await read("gone.txt")).toBe("G0\n");
  expect(await read("src/b.txt")).toBe("B0\n");
});

test("a folder that is no repository keeps no checkpoint", async () => {
  await undo.begin("a1", outside);
  await write("x.txt", "1\n", outside);
  await undo.end("a1", "t1");
  expect(await kept()).toEqual([]);
  await expect(undo.undo("a1", "t1")).rejects.toThrow(NOT_NEWEST);
});

test("with the setting off nothing is snapshotted, and the checkpoints kept are dropped", async () => {
  await turn("t1", () => write("a.txt", "A1\n"));
  expect(await kept()).toHaveLength(1);
  on = false;
  const before = await git("count-objects", "-v");
  await turn("t2", () => write("a.txt", "A2\n"));
  expect(await kept()).toEqual([]);
  expect(await git("count-objects", "-v")).toBe(before);
});

test("a repository with no commit yet can be undone", async () => {
  const fresh = join(root, "fresh");
  await mkdir(fresh);
  await run("git", ["init", "-q"], { cwd: fresh });
  await write("one.txt", "1\n", fresh);
  await undo.begin("a1", fresh);
  await write("one.txt", "2\n", fresh);
  await write("two.txt", "2\n", fresh);
  await undo.end("a1", "t1");
  expect((await undo.undo("a1", "t1"))?.restored).toBe(2);
  expect(await readFile(join(fresh, "one.txt"), "utf8")).toBe("1\n");
  await expect(stat(join(fresh, "two.txt"))).rejects.toThrow();
});

test("a git that fails keeps no checkpoint and gives no error", async () => {
  const broken = createUndo({
    exec: async () => {
      throw new Error("git is not here");
    },
    enabled: () => true,
    log: (line) => logged.push(line),
  });
  await broken.begin("a1", repo);
  await broken.end("a1", "t1");
  expect(await broken.status("a1")).toEqual({ turns: [], gap: null });
});

test("forgetting an agent drops its checkpoints", async () => {
  await turn("t1", () => write("a.txt", "A1\n"));
  undo.forget("a1");
  await expect(undo.undo("a1", "t1")).rejects.toThrow(NOT_NEWEST);
});

// The review's findings: each test fails on the first version of checkpoints.

test("a folder the turn swapped for a file comes back whole", async () => {
  await write("d/a", "DA\n");
  await write("d/b", "DB\n");
  await git("add", "-A");
  await git("commit", "-q", "-m", "d");
  await turn("t1", async () => {
    await rm(join(repo, "d"), { recursive: true });
    await write("d", "a file now\n");
  });
  expect(await undo.undo("a1", "t1")).toEqual({ turnId: "t1", restored: 3, skipped: [] });
  expect(await read("d/a")).toBe("DA\n");
  expect(await read("d/b")).toBe("DB\n");
  expect(await git("status", "--porcelain")).toBe("");
  expect(await kept()).toEqual([]);
});

test("a file the turn swapped for a folder comes back whole", async () => {
  await turn("t1", async () => {
    await rm(join(repo, "gone.txt"));
    await write("gone.txt/x", "X\n");
    await write("gone.txt/y", "Y\n");
  });
  expect(await undo.undo("a1", "t1")).toEqual({ turnId: "t1", restored: 3, skipped: [] });
  expect(await read("gone.txt")).toBe("G0\n");
  expect(await git("status", "--porcelain")).toBe("");
});

test("a file the turn renamed by case alone comes back, whatever the file system", async () => {
  await write("probe", "p\n");
  const folded = !(await missing("PROBE"));
  await rm(join(repo, "probe"));
  await turn("t1", () => rename(join(repo, "a.txt"), join(repo, "A.TXT")));
  await undo.undo("a1", "t1").catch(() => null);
  expect(await read("a.txt")).toBe("A0\n");
  if (!folded) expect(await missing("A.TXT")).toBe(true);
});

test("a write-back left because of what is in the way of a removed file keeps the checkpoint", async () => {
  await turn("t1", async () => {
    await rm(join(repo, "gone.txt"));
    await write("gone.txt/x", "X\n");
  });
  // The owner's new file in the turn's folder: the folder cannot go, so the file cannot come back yet.
  await write("gone.txt/mine", "mine\n");
  expect(await undo.undo("a1", "t1")).toEqual({
    turnId: "t1",
    restored: 1,
    skipped: [{ reason: "retry", count: 1 }],
  });
  expect(await read("gone.txt/mine")).toBe("mine\n");
  expect((await kept()).map((one) => one.turnId)).toEqual(["t1"]);
  // Again, nothing the undo does is in the way: what is left is the owner's, and the turn goes.
  expect(await undo.undo("a1", "t1")).toEqual({
    turnId: "t1",
    restored: 0,
    skipped: [
      { reason: "same", count: 1 },
      { reason: "changed", count: 1 },
    ],
  });
  expect(await kept()).toEqual([]);
});

test("undo takes the turn it was shown: the same id twice undoes one turn", async () => {
  await turn("t1", () => write("a.txt", "A1\n"));
  await turn("t2", () => write("a.txt", "A2\n"));
  const both = await Promise.allSettled([undo.undo("a1", "t2"), undo.undo("a1", "t2")]);
  expect(both.map((one) => one.status)).toEqual(["fulfilled", "rejected"]);
  expect(String((both[1] as PromiseRejectedResult).reason)).toContain(NOT_NEWEST);
  expect(await read("a.txt")).toBe("A1\n");
  await expect(undo.undo("a1", "t9")).rejects.toThrow(NOT_NEWEST);
  expect((await kept()).map((one) => one.turnId)).toEqual(["t1"]);
});

test("a turn that begins while undo is writing stops it, and the checkpoint stays", async () => {
  let writes = 0;
  const watching: Exec = async (command, args, options) => {
    if (args[0] === "checkout-index") {
      writes += 1;
      // The agent is prompted while the first file is being written.
      if (writes === 1) void undo.begin("a1", repo);
    }
    return exec(command, args, options);
  };
  undo = createUndo({ exec: watching, enabled: () => true, log: (line) => logged.push(line) });
  await turn("t1", async () => {
    await write("a.txt", "A1\n");
    await write("gone.txt", "G1\n");
    await write("src/b.txt", "B1\n");
  });
  expect(await undo.undo("a1", "t1")).toEqual({
    turnId: "t1",
    restored: 1,
    skipped: [{ reason: "began", count: 2 }],
  });
  expect(writes).toBe(1);
  expect(await read("gone.txt")).toBe("G1\n");
  expect(await read("src/b.txt")).toBe("B1\n");
  await undo.end("a1", "t2");
  expect((await kept()).map((one) => one.turnId)).toEqual(["t1"]);
});

test("undo is refused while another agent works in the same work tree", async () => {
  await turn("t1", () => write("a.txt", "A1\n"));
  await undo.begin("a2", join(repo, "src"));
  await expect(undo.undo("a1", "t1")).rejects.toThrow(
    "another agent is working in this folder: undo when it has stopped",
  );
  expect(await read("a.txt")).toBe("A1\n");
  // One at work in another folder is no reason.
  await undo.begin("a3", outside);
  await undo.end("a2", "u1");
  expect((await undo.undo("a1", "t1")).restored).toBe(1);
});

test("each file is looked at again right before it is written", async () => {
  let writes = 0;
  const meddling: Exec = async (command, args, options) => {
    if (args[0] === "checkout-index") {
      writes += 1;
      if (writes === 1) await write("src/b.txt", "B2, by the owner meanwhile\n");
    }
    return exec(command, args, options);
  };
  undo = createUndo({ exec: meddling, enabled: () => true, log: (line) => logged.push(line) });
  await turn("t1", async () => {
    await write("a.txt", "A1\n");
    await write("src/b.txt", "B1\n");
  });
  expect(await undo.undo("a1", "t1")).toEqual({
    turnId: "t1",
    restored: 1,
    skipped: [{ reason: "changed", count: 1 }],
  });
  expect(await read("src/b.txt")).toBe("B2, by the owner meanwhile\n");
});

test("a file the turn added under a folder that is now a link is not deleted", async () => {
  await turn("t1", () => write("made/new.txt", "N\n"));
  await rename(join(repo, "made"), join(outside, "made"));
  await symlink(join(outside, "made"), join(repo, "made"));
  expect(await undo.undo("a1", "t1")).toEqual({
    turnId: "t1",
    restored: 0,
    skipped: [{ reason: "linkedFolder", count: 1 }],
  });
  expect(await readFile(join(outside, "made", "new.txt"), "utf8")).toBe("N\n");
});

test("names that look like pathspec magic are paths", async () => {
  await write(":(top)xa", "T0\n");
  await git("add", "-A");
  await git("commit", "-q", "-m", "magic");
  await turn("t1", async () => {
    await write(":(top)xa", "T1\n");
    await write(":!x", "N\n");
    await write("*.txt", "S\n");
  });
  expect((await kept())[0]?.files.map((file) => file.path)).toEqual(["*.txt", ":!x", ":(top)xa"]);
  expect(await undo.undo("a1", "t1")).toEqual({ turnId: "t1", restored: 3, skipped: [] });
  expect(await read(":(top)xa")).toBe("T0\n");
  expect(await missing(":!x")).toBe(true);
  expect(await read("a.txt")).toBe("A0\n");
});

test("a turn that could not be snapshotted says the checkpoints before it were dropped", async () => {
  await turn("t1", () => write("a.txt", "A1\n"));
  expect((await undo.status("a1")).gap).toBeNull();
  on = false;
  await turn("t2", () => write("a.txt", "A2\n"));
  expect(await undo.status("a1")).toEqual({
    turns: [],
    gap: "the last turn could not be snapshotted: earlier checkpoints were dropped",
  });
  on = true;
  await undo.begin("a1", repo);
  expect((await undo.status("a1")).gap).toBeNull();
});

test("a folder whose birth time is unknown, or not after the turn began, stays", async () => {
  await turn("t1", async () => {
    await write("one/new.txt", "N\n");
    await write("two/new.txt", "N\n");
  });
  const [only] = await kept();
  expect(only).toBeDefined();
  const tree = await treeNow();
  const before = (await git("rev-parse", "HEAD^{tree}")).trim();
  const result = await undoCheckpoint(
    exec,
    { top: repo, turnId: "t1", before, end: tree, beganAt: 1_000 },
    {
      // `one` has no birth time of its own (it reads as its change time); `two` was born before.
      times: async (path) =>
        path.endsWith("one") ? { birth: 5_000, change: 5_000 } : { birth: 500, change: 5_000 },
    },
  );
  expect(result.restored).toBe(2);
  expect((await stat(join(repo, "one"))).isDirectory()).toBe(true);
  expect((await stat(join(repo, "two"))).isDirectory()).toBe(true);
});
