import { expect, test, vi } from "vitest";
import { readRepoAge } from "./repo-age.js";

test("the first commit's day, from git", async () => {
  const exec = vi.fn(async () => ({ stdout: "2024-03-05\n2025-01-01\n", stderr: "" }));
  expect(await readRepoAge("/some/folder", exec)).toBe("2024-03-05");
  expect(exec).toHaveBeenCalledWith(
    "git",
    ["log", "--max-parents=0", "--reverse", "--format=%as"],
    expect.objectContaining({ cwd: "/some/folder", timeout: 10_000, maxBuffer: 1 << 20 }),
  );
});

test("nothing when git fails, says nothing sensible, or there is no folder", async () => {
  expect(
    await readRepoAge("/x", async () => {
      throw new Error("not a repository");
    }),
  ).toBeNull();
  expect(await readRepoAge("/x", async () => ({ stdout: "garbage\n", stderr: "" }))).toBeNull();
  const exec = vi.fn(async () => ({ stdout: "2024-01-01\n", stderr: "" }));
  expect(await readRepoAge("", exec)).toBeNull();
  expect(exec).not.toHaveBeenCalled();
});
