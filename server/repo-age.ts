export interface ExecResult {
  stdout: string;
  stderr: string;
}
export type Exec = (
  command: string,
  args: string[],
  options: { cwd: string; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv },
) => Promise<ExecResult>;

/** The day of a repository's first commit, "YYYY-MM-DD"; null when git cannot say. */
export async function readRepoAge(folder: string, exec: Exec): Promise<string | null> {
  if (folder === "") return null;
  try {
    const { stdout } = await exec("git", ["log", "--max-parents=0", "--reverse", "--format=%as"], {
      cwd: folder,
      timeout: 10_000,
      maxBuffer: 1 << 20,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    const first = stdout.trim().split("\n")[0] ?? "";
    return /^\d{4}-\d{2}-\d{2}$/.test(first) ? first : null;
  } catch {
    return null;
  }
}
