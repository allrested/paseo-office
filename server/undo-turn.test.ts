import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Exec } from "./repo-age.js";
import { createUndo, editedFiles, type Undo } from "./undo-turn.js";

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

async function write(path: string, text: string, folder = repo): Promise<void> {
  await mkdir(join(folder, path, ".."), { recursive: true });
  await writeFile(join(folder, path), text);
}

const read = (path: string) => readFile(join(repo, path), "utf8");

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

test("an edited file is put back, and nothing else in the work tree is touched", async () => {
  await undo.begin("a1", repo);
  await write("a.txt", "A1\n");
  await write("other.txt", "someone else's work\n");
  await undo.end("a1", repo, [join(repo, "a.txt")]);
  expect(undo.available("a1")).toBe(1);
  expect(await undo.undo("a1")).toEqual({ restored: 1, skipped: [] });
  expect(await read("a.txt")).toBe("A0\n");
  expect(await read("other.txt")).toBe("someone else's work\n");
  expect(undo.available("a1")).toBe(0);
  expect(await undo.undo("a1")).toBeNull();
});

test("a file the turn created is deleted, and one it deleted comes back", async () => {
  await undo.begin("a1", repo);
  await write("new.txt", "N\n");
  await rm(join(repo, "gone.txt"));
  await undo.end("a1", repo, ["new.txt", "gone.txt"]);
  expect(await undo.undo("a1")).toEqual({ restored: 2, skipped: [] });
  await expect(stat(join(repo, "new.txt"))).rejects.toThrow();
  expect(await read("gone.txt")).toBe("G0\n");
});

test("an untracked file the turn edited is put back from the snapshot", async () => {
  await write("notes.txt", "U0\n");
  await undo.begin("a1", repo);
  await write("notes.txt", "U1\n");
  await undo.end("a1", repo, ["notes.txt"]);
  expect(await undo.undo("a1")).toEqual({ restored: 1, skipped: [] });
  expect(await read("notes.txt")).toBe("U0\n");
});

test("a mode, a folder that is gone and a relative path of the agent's folder are put back", async () => {
  await write("src/run.sh", "#!/bin/sh\n");
  await chmod(join(repo, "src/run.sh"), 0o755);
  await git("add", "-A");
  await git("commit", "-q", "-m", "script");
  await undo.begin("a1", join(repo, "src"));
  await write("src/run.sh", "#!/bin/sh\necho hi\n");
  await rm(join(repo, "src/b.txt"));
  await undo.end("a1", join(repo, "src"), ["run.sh", "b.txt"]);
  expect((await undo.undo("a1"))?.restored).toBe(2);
  expect(await read("src/run.sh")).toBe("#!/bin/sh\n");
  expect((await stat(join(repo, "src/run.sh"))).mode & 0o111).not.toBe(0);
  expect(await read("src/b.txt")).toBe("B0\n");
});

test("a file changed after the turn is skipped, the others are put back", async () => {
  await undo.begin("a1", repo);
  await write("a.txt", "A1\n");
  await write("src/b.txt", "B1\n");
  await undo.end("a1", repo, ["a.txt", "src/b.txt"]);
  await write("a.txt", "A2, by the owner\n");
  expect(await undo.undo("a1")).toEqual({
    restored: 1,
    skipped: [{ reason: "changed", count: 1 }],
  });
  expect(await read("a.txt")).toBe("A2, by the owner\n");
  expect(await read("src/b.txt")).toBe("B0\n");
});

test("a file made again after the turn deleted it is not overwritten", async () => {
  await undo.begin("a1", repo);
  await rm(join(repo, "gone.txt"));
  await undo.end("a1", repo, ["gone.txt"]);
  await write("gone.txt", "somebody's new one\n");
  expect((await undo.undo("a1"))?.skipped).toEqual([{ reason: "changed", count: 1 }]);
  expect(await read("gone.txt")).toBe("somebody's new one\n");
});

test("a path git ignores is not restored, and is said not to be", async () => {
  await write("build/out.js", "O0\n");
  await undo.begin("a1", repo);
  await write("build/out.js", "O1\n");
  await write("build/new.js", "N\n");
  await undo.end("a1", repo, ["build/out.js", "build/new.js", "a.txt"]);
  await write("a.txt", "A1\n");
  // a.txt did not change in the turn but is named: it is the same as it was.
  const result = await undo.undo("a1");
  expect(result?.restored).toBe(0);
  expect(result?.skipped).toEqual(
    expect.arrayContaining([
      { reason: "ignored", count: 2 },
      { reason: "changed", count: 1 },
    ]),
  );
  expect(await read("build/out.js")).toBe("O1\n");
  expect(await read("build/new.js")).toBe("N\n");
});

test("a path outside the work tree, by a .. or by a link, or in .git, is refused", async () => {
  await write("secret.txt", "S0\n", outside);
  await symlink(outside, join(repo, "link"));
  await undo.begin("a1", repo);
  await write("secret.txt", "S1\n", outside);
  await write("a.txt", "A1\n");
  await undo.end("a1", repo, [
    join(outside, "secret.txt"),
    "../outside/secret.txt",
    "link/secret.txt",
    ".git/HEAD",
    "a.txt",
  ]);
  expect(await undo.undo("a1")).toEqual({
    restored: 1,
    skipped: [{ reason: "outside", count: 4 }],
  });
  expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("S1\n");
  expect(await read("a.txt")).toBe("A0\n");
});

test("a file that is a link is left alone", async () => {
  await symlink("a.txt", join(repo, "ln"));
  await git("add", "-A");
  await git("commit", "-q", "-m", "link");
  await undo.begin("a1", repo);
  await rm(join(repo, "ln"));
  await symlink("src/b.txt", join(repo, "ln"));
  await undo.end("a1", repo, ["ln"]);
  expect(await undo.undo("a1")).toBeNull();
  expect(undo.available("a1")).toBe(0);
});

test("a path that is a pattern is a path", async () => {
  await undo.begin("a1", repo);
  await write("a.txt", "A1\n");
  await write("src/b.txt", "B1\n");
  await undo.end("a1", repo, ["*.txt", ":(top)a.txt"]);
  expect(await undo.undo("a1")).toEqual({ restored: 0, skipped: [{ reason: "same", count: 2 }] });
  expect(await read("a.txt")).toBe("A1\n");
  expect(await read("src/b.txt")).toBe("B1\n");
});

test("a folder that is no repository has no undo", async () => {
  await undo.begin("a1", outside);
  await write("x.txt", "1\n", outside);
  await undo.end("a1", outside, ["x.txt"]);
  expect(undo.available("a1")).toBe(0);
  expect(await undo.undo("a1")).toBeNull();
});

test("with the setting off nothing is snapshotted, and a turn after one that could be undone drops it", async () => {
  await undo.begin("a1", repo);
  await write("a.txt", "A1\n");
  await undo.end("a1", repo, ["a.txt"]);
  expect(undo.available("a1")).toBe(1);
  on = false;
  const before = await git("count-objects", "-v");
  await undo.begin("a1", repo);
  expect(undo.available("a1")).toBe(0);
  await write("a.txt", "A2\n");
  await undo.end("a1", repo, ["a.txt"]);
  expect(undo.available("a1")).toBe(0);
  expect(await git("count-objects", "-v")).toBe(before);
});

test("the next turn replaces the snapshot, and a turn still running has no undo", async () => {
  await undo.begin("a1", repo);
  await write("a.txt", "A1\n");
  await undo.end("a1", repo, ["a.txt"]);
  await undo.begin("a1", repo);
  expect(undo.available("a1")).toBe(0);
  await write("a.txt", "A2\n");
  await undo.end("a1", repo, ["a.txt"]);
  await undo.undo("a1");
  expect(await read("a.txt")).toBe("A1\n");
});

test("a turn that names no file has no undo", async () => {
  await undo.begin("a1", repo);
  await undo.end("a1", repo, []);
  expect(undo.available("a1")).toBe(0);
});

test("the index, HEAD, stash and refs are byte for byte the same after a snapshot and after an undo", async () => {
  await write("a.txt", "staged\n");
  await git("add", "a.txt");
  await write("a.txt", "staged, then edited\n");
  await write("src/b.txt", "B stashed\n");
  await git("stash", "push", "-q", "src/b.txt");
  await write("loose.txt", "untracked\n");
  const first = await state();
  await undo.begin("a1", repo);
  expect(await state()).toBe(first);
  await write("a.txt", "the turn's\n");
  await write("loose.txt", "the turn's loose\n");
  await undo.end("a1", repo, ["a.txt", "loose.txt"]);
  const during = await state();
  expect(during).toBe(first);
  expect((await undo.undo("a1"))?.restored).toBe(2);
  expect(await state()).toBe(first);
  expect(await read("a.txt")).toBe("staged, then edited\n");
  expect(await read("loose.txt")).toBe("untracked\n");
  expect(await git("status", "--porcelain")).toBe("MM a.txt\n?? loose.txt\n");
});

test("a repository with no commit yet can be undone", async () => {
  const fresh = join(root, "fresh");
  await mkdir(fresh);
  await run("git", ["init", "-q"], { cwd: fresh });
  await write("one.txt", "1\n", fresh);
  await undo.begin("a1", fresh);
  await write("one.txt", "2\n", fresh);
  await write("two.txt", "2\n", fresh);
  await undo.end("a1", fresh, ["one.txt", "two.txt"]);
  expect((await undo.undo("a1"))?.restored).toBe(2);
  expect(await readFile(join(fresh, "one.txt"), "utf8")).toBe("1\n");
  await expect(stat(join(fresh, "two.txt"))).rejects.toThrow();
});

test("a git that fails gives no undo and no error", async () => {
  const broken = createUndo({
    exec: async () => {
      throw new Error("git is not here");
    },
    enabled: () => true,
    log: (line) => logged.push(line),
  });
  await broken.begin("a1", repo);
  await broken.end("a1", repo, ["a.txt"]);
  expect(broken.available("a1")).toBe(0);
});

test("forgetting an agent drops its turn", async () => {
  await undo.begin("a1", repo);
  await write("a.txt", "A1\n");
  await undo.end("a1", repo, ["a.txt"]);
  undo.forget("a1");
  expect(await undo.undo("a1")).toBeNull();
});

test("the files of a turn are those its edit and write calls named, once, but for calls that failed", () => {
  const call = (type: string, filePath: string, status = "completed") => ({
    type: "tool_call",
    status,
    detail: { type, filePath },
  });
  expect(
    editedFiles([
      call("edit", "/r/a.txt"),
      call("write", "/r/b.txt"),
      call("edit", "/r/a.txt"),
      call("edit", "/r/c.txt", "failed"),
      call("read", "/r/d.txt"),
      { type: "tool_call", status: "completed", detail: { type: "shell", command: "rm e" } },
      { type: "assistant_message" },
    ]),
  ).toEqual(["/r/a.txt", "/r/b.txt"]);
});
