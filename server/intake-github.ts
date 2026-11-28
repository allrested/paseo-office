import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { z } from "zod";
import { GITHUB_REPO } from "../shared/settings.js";
import { TrackerProblem } from "./incidents-http.js";
import {
  INTAKE_READ_MAX,
  ticketBody,
  ticketTitle,
  type IntakeIssue,
  type IntakeRead,
  type IntakeSource,
} from "./intake-service.js";

const TIMEOUT_MS = 30_000;
const TOO_MUCH = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";

/** What one run of the GitHub CLI gave back. `code` is null when it was stopped for its time. */
export interface GhRun {
  code: number | string | null;
  stdout: string;
  stderr: string;
}

/** Runs the host's `gh` with these arguments. Never rejects. */
export type RunGh = (args: string[]) => Promise<GhRun>;

/**
 * The host's GitHub CLI, found on the daemon's PATH or in `~/.local/bin`, with its own sign-in:
 * the office keeps no token. No shell: the arguments go to the CLI as they are.
 */
export const runGh: RunGh = (args) =>
  new Promise((resolve) => {
    const path = [process.env.PATH ?? "", join(homedir(), ".local", "bin")].join(delimiter);
    try {
      execFile(
        "gh",
        args,
        {
          // github.com whatever the daemon's environment says (the links are built for it), no
          // prompt, and the home directory, so a config in the working directory is not read.
          env: {
            ...process.env,
            PATH: path,
            GH_HOST: "github.com",
            GH_PROMPT_DISABLED: "1",
            GH_NO_UPDATE_NOTIFIER: "1",
          },
          cwd: homedir(),
          timeout: TIMEOUT_MS,
          maxBuffer: 8_000_000,
        },
        (error, stdout, stderr) => {
          if (error === null) return resolve({ code: 0, stdout, stderr });
          const code = error.code === TOO_MUCH || !error.killed ? (error.code ?? null) : null;
          return resolve({ code, stdout, stderr });
        },
      );
    } catch {
      // An argument the system refuses (a NUL in a comment): the CLI never ran.
      resolve({ code: "EINVAL", stdout: "", stderr: "" });
    }
  });

// Each issue is read on its own, so one of an odd shape is skipped and the rest still come.
const ListSchema = z.array(z.unknown());
const IssueSchema = z.object({
  number: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  title: z.string().nullish(),
  body: z.string().nullish(),
  url: z.string(),
});

const NOT_INSTALLED = "the gh CLI is not installed on the host";
const NOT_SIGNED_IN = "gh is not signed in on the host";

/**
 * Why the CLI failed, from its exit and its own words. The words are matched and never shown or
 * logged: they can hold an address or a token.
 */
function problemOf(run: GhRun, repo: string): TrackerProblem {
  const said = run.stderr;
  if (run.code === "ENOENT") return new TrackerProblem(NOT_INSTALLED);
  if (run.code === null) {
    return new TrackerProblem(`${repo}: gh did not answer in ${TIMEOUT_MS / 1000} seconds`, {
      timedOut: true,
    });
  }
  if (/gh auth login|not logged/i.test(said)) return new TrackerProblem(NOT_SIGNED_IN);
  if (/Could not resolve to a Repository|HTTP 404/i.test(said)) {
    return new TrackerProblem(`${repo}: not found, or gh's account cannot read it`);
  }
  if (run.code === 0 || run.code === TOO_MUCH) return unexpected(repo);
  return new TrackerProblem(`${repo}: gh failed`);
}

function unexpected(repo: string): TrackerProblem {
  return new TrackerProblem(`${repo}: gh answered with something unexpected`);
}

/** What is global to the host's gh: told once, and no other repository is then tried. */
function isHostWide(problem: TrackerProblem): boolean {
  return problem.message === NOT_INSTALLED || problem.message === NOT_SIGNED_IN;
}

/**
 * The issues the owner's search matches in each repository, 20 at most from each: `gh issue list`
 * with the repository and the search each one argument after its flag, so neither can be read as
 * an option (the settings refuse a repository or a search that starts with a dash). The key is
 * the repository as configured and the number; the link is built from them, never taken from the
 * output. An issue whose number is not a positive integer is skipped and counted. A repository
 * that fails does not stop the others: its problem comes back beside what the rest gave.
 */
export async function readGithubIssues(
  repos: readonly string[],
  search: string,
  run: RunGh,
  seen: (key: string) => boolean = () => false,
): Promise<IntakeRead & { problems: string[] }> {
  const issues: IntakeIssue[] = [];
  const problems: string[] = [];
  let skipped = 0;
  for (const repo of repos) {
    const done = await run([
      "issue",
      "list",
      "--repo",
      repo,
      "--search",
      search,
      "--limit",
      String(INTAKE_READ_MAX),
      "--json",
      "number,title,body,url",
    ]);
    let list: unknown[] | null = null;
    if (done.code === 0) {
      try {
        const parsed = ListSchema.safeParse(JSON.parse(done.stdout));
        list = parsed.success ? parsed.data : null;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    if (list === null) {
      const problem = problemOf(done, repo);
      if (!problems.includes(problem.message)) problems.push(problem.message);
      if (isHostWide(problem)) break;
      continue;
    }
    const mine: IntakeIssue[] = [];
    for (const found of list.slice(0, INTAKE_READ_MAX)) {
      const parsed = IssueSchema.safeParse(found);
      const url = `https://github.com/${repo}/issues/${parsed.data?.number}`;
      // A search that names another repository brings its issues into this read: one whose own
      // address is not this repository's is not this repository's issue. The address is only
      // compared, never used.
      if (!parsed.success || parsed.data.url.toLowerCase() !== url.toLowerCase()) {
        skipped += 1;
        continue;
      }
      const { number, title, body } = parsed.data;
      mine.push({
        // Lower case, so a setting edited only in case does not bring the issue again.
        key: `${repo.toLowerCase()}#${number}`,
        url,
        title: ticketTitle(title ?? ""),
        body: ticketBody(body ?? ""),
      });
    }
    issues.push(...mine);
    // No paging: when the 20 it reads are all imported, nothing newer is ever reached.
    if (mine.length === INTAKE_READ_MAX && mine.every((issue) => seen(issue.key))) {
      problems.push(
        `${repo}: the first ${INTAKE_READ_MAX} matches are already imported: narrow the search`,
      );
    }
  }
  return { issues, skipped, problems };
}

/**
 * One comment on an issue. The text is the one argument after `--body`, so it is never read as an
 * option, even when it starts with a dash. Rejects with a `TrackerProblem`.
 */
export async function commentOnGithub(key: string, text: string, run: RunGh): Promise<void> {
  const match = /^([^#]+)#(\d+)$/.exec(key);
  const number = Number(match?.[2]);
  const repo = match?.[1] ?? "";
  if (!GITHUB_REPO.test(repo) || !Number.isSafeInteger(number) || number < 1) {
    throw new TrackerProblem("GitHub has no issue of that key");
  }
  const done = await run(["issue", "comment", String(number), "--repo", repo, "--body", text]);
  if (done.code !== 0) throw problemOf(done, repo);
}

/** GitHub as the intake's source: set up with a repository and a search that is not blank. */
export function createGithubSource(ports: {
  repos(): readonly string[];
  search(): string;
  run?: RunGh;
}): IntakeSource {
  const run = ports.run ?? runGh;
  return {
    kind: "github",
    configured: () => ports.repos().length > 0 && ports.search().trim() !== "",
    read: async (seen) => {
      const read = await readGithubIssues(ports.repos(), ports.search().trim(), run, seen);
      // Nothing came and something failed: the run says why, as a failed read does.
      if (read.issues.length === 0 && read.skipped === 0 && read.problems.length > 0) {
        throw new TrackerProblem(read.problems.join("; "));
      }
      return read;
    },
    comment: async (key, text) => {
      const [repo = "", number = ""] = key.split("#");
      // The repository as the settings spell it, and only while they still list it: one the owner
      // removed is not written to.
      const listed = ports.repos().find((entry) => entry.toLowerCase() === repo.toLowerCase());
      if (listed === undefined) {
        throw new TrackerProblem(`${repo} is no longer read: not commented`, { final: true });
      }
      await commentOnGithub(`${listed}#${number}`, text, run);
    },
  };
}
