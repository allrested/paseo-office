import { expect, test } from "vitest";
import { TrackerProblem } from "./incidents-http.js";
import {
  commentOnGithub,
  createGithubSource,
  readGithubIssues,
  type GhRun,
  type RunGh,
} from "./intake-github.js";

const SEARCH = "label:agent is:open";

/** A fake `gh`: answers each call from `answer`, and keeps the argument arrays it was given. */
function fakeGh(answer: (args: string[]) => GhRun | Promise<GhRun>) {
  const calls: string[][] = [];
  const run: RunGh = async (args) => {
    calls.push(args);
    return answer(args);
  };
  return { run, calls };
}

const ok = (body: unknown): GhRun => ({ code: 0, stdout: JSON.stringify(body), stderr: "" });
const failed = (stderr: string, code: GhRun["code"] = 1): GhRun => ({ code, stdout: "", stderr });

function found(number: unknown, title: unknown = "A title", body: unknown = "A body") {
  return { number, title, body, url: "https://evil.example/phish" };
}

async function problemOf(promise: Promise<unknown>): Promise<TrackerProblem> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TrackerProblem) return error;
    throw error;
  }
  throw new Error("did not reject");
}

/** The problem sentences of a read that did not reject. */
async function problemsOf(repos: string[], answer: (args: string[]) => GhRun) {
  const { run } = fakeGh(answer);
  return (await readGithubIssues(repos, SEARCH, run)).problems;
}

test("a read runs exactly gh issue list for each repository, the search as one argument", async () => {
  const { run, calls } = fakeGh(() => ok([]));
  expect(await readGithubIssues(["acme/web", "acme/api"], SEARCH, run)).toEqual({
    issues: [],
    skipped: 0,
    problems: [],
  });
  expect(calls).toEqual([
    [
      "issue",
      "list",
      "--repo",
      "acme/web",
      "--search",
      SEARCH,
      "--limit",
      "20",
      "--json",
      "number,title,body,url",
    ],
    [
      "issue",
      "list",
      "--repo",
      "acme/api",
      "--search",
      SEARCH,
      "--limit",
      "20",
      "--json",
      "number,title,body,url",
    ],
  ]);
});

test("the key uses the repository as configured and the number, the link is built, never taken from the output", async () => {
  const { run } = fakeGh(() => ok([found(12, "Fix it", "Steps")]));
  const read = await readGithubIssues(["Acme/Web.app"], SEARCH, run);
  expect(read.issues).toEqual([
    {
      key: "Acme/Web.app#12",
      url: "https://github.com/Acme/Web.app/issues/12",
      title: "Fix it",
      body: "Steps",
    },
  ]);
});

test("an issue whose number is not a positive integer is skipped and counted", async () => {
  const numbers = [0, -3, 1.5, "7", null, 1e21, Number.NaN, undefined, { n: 1 }];
  const { run } = fakeGh(() => ok([...numbers.map((n) => found(n)), found(5), "junk", null]));
  const read = await readGithubIssues(["acme/web"], SEARCH, run);
  expect(read.issues.map((issue) => issue.key)).toEqual(["acme/web#5"]);
  expect(read.skipped).toBe(numbers.length + 2);
});

test("hostile text is cleaned like Jira's: one line, no control characters, cut", async () => {
  const hostile = found(
    3,
    `Evil\u0000\n\u202e title ${"x".repeat(5_000)}`,
    `a\r\nb\u0007c${"y".repeat(5_000)}`,
  );
  const { run } = fakeGh(() => ok([{ ...hostile, extra: { deep: [1] }, labels: ["x"] }]));
  const [issue] = (await readGithubIssues(["acme/web"], SEARCH, run)).issues;
  expect(issue?.title).not.toMatch(/[\p{Cc}\u202e]/u);
  expect(issue?.title.length).toBe(300);
  expect(issue?.body).toMatch(/^a\nbcy+…$/);
  expect(issue?.body.length).toBe(1_000);
  expect(Object.keys(issue ?? {}).sort()).toEqual(["body", "key", "title", "url"]);
});

test("a missing or null title and body read as empty, other types skip the issue", async () => {
  const { run } = fakeGh(() =>
    ok([{ number: 1, title: null, body: null }, { number: 2, title: 5, body: "x" }, { number: 3 }]),
  );
  const read = await readGithubIssues(["acme/web"], SEARCH, run);
  expect(read.issues.map((issue) => [issue.key, issue.title, issue.body])).toEqual([
    ["acme/web#1", "", ""],
    ["acme/web#3", "", ""],
  ]);
  expect(read.skipped).toBe(1);
});

test("at most 20 issues are read from a repository, whatever gh prints", async () => {
  const many = Array.from({ length: 60 }, (_, index) => found(index + 1));
  const { run } = fakeGh(() => ok(many));
  const read = await readGithubIssues(["acme/web"], SEARCH, run);
  expect(read.issues).toHaveLength(20);
});

test("each problem is a short sentence from the exit and the stderr, and never quotes stderr", async () => {
  const cases: [GhRun, string][] = [
    [{ code: "ENOENT", stdout: "", stderr: "" }, "the gh CLI is not installed on the host"],
    [
      failed("To get started with GitHub CLI, please run:  gh auth login", 4),
      "gh is not signed in on the host",
    ],
    [failed("You are not logged into any GitHub hosts."), "gh is not signed in on the host"],
    [
      failed("GraphQL: Could not resolve to a Repository with the name 'acme/web'. (secret-token)"),
      "acme/web: not found, or gh's account cannot read it",
    ],
    [
      failed("HTTP 404: Not Found (https://api.github.com/x)"),
      "acme/web: not found, or gh's account cannot read it",
    ],
    [{ code: null, stdout: "", stderr: "partial" }, "acme/web: gh did not answer in 30 seconds"],
    [
      { code: 0, stdout: "not json <html>", stderr: "" },
      "acme/web: gh answered with something unexpected",
    ],
    [{ code: 0, stdout: '{"a":1}', stderr: "" }, "acme/web: gh answered with something unexpected"],
    [failed("boom ghp_SECRET", 2), "acme/web: gh failed"],
  ];
  for (const [run, sentence] of cases) {
    expect(await problemsOf(["acme/web"], () => run)).toEqual([sentence]);
  }
});

test("a repository that fails does not stop the others, and the problems are told", async () => {
  const { run, calls } = fakeGh((args) =>
    args[3] === "acme/gone" ? failed("HTTP 404") : ok([found(args[3] === "acme/web" ? 1 : 2)]),
  );
  const read = await readGithubIssues(["acme/web", "acme/gone", "acme/api"], SEARCH, run);
  expect(read.issues.map((issue) => issue.key)).toEqual(["acme/web#1", "acme/api#2"]);
  expect(read.problems).toEqual(["acme/gone: not found, or gh's account cannot read it"]);
  expect(calls).toHaveLength(3);
});

test("the source joins its problems when nothing could be read", async () => {
  const source = createGithubSource({
    repos: () => ["acme/web", "acme/gone"],
    search: () => SEARCH,
    run: async () => failed("HTTP 404"),
  });
  const error = await problemOf(source.read(() => false));
  expect(error.message).toBe(
    "acme/web: not found, or gh's account cannot read it; acme/gone: not found, or gh's account cannot read it",
  );
});

test("gh missing or signed out is told once, and the other repositories are not tried", async () => {
  const { run, calls } = fakeGh(() => ({ code: "ENOENT", stdout: "", stderr: "" }));
  const read = await readGithubIssues(["acme/web", "acme/api"], SEARCH, run);
  expect(read.problems).toEqual(["the gh CLI is not installed on the host"]);
  expect(calls).toHaveLength(1);
});

test("the source returns what was read, with a failed repository's problem beside it", async () => {
  const source = createGithubSource({
    repos: () => ["acme/web", "acme/gone"],
    search: () => SEARCH,
    run: async (args) => (args[3] === "acme/gone" ? failed("HTTP 404") : ok([found(1)])),
  });
  const read = await source.read(() => false);
  expect(read.issues).toHaveLength(1);
  expect(read.problems).toEqual(["acme/gone: not found, or gh's account cannot read it"]);
});

test("the source is set up with a repository and a search that is not blank", () => {
  let repos: string[] = [];
  let search = SEARCH;
  const source = createGithubSource({
    repos: () => repos,
    search: () => search,
    run: async () => ok([]),
  });
  expect(source.kind).toBe("github");
  expect(source.configured()).toBe(false);
  repos = ["acme/web"];
  expect(source.configured()).toBe(true);
  search = "   ";
  expect(source.configured()).toBe(false);
});

test("a comment runs exactly gh issue comment, the text one argument after --body", async () => {
  const { run, calls } = fakeGh(() => ok({}));
  await commentOnGithub("acme/web#12", "Done in the office by Rani: fixed", run);
  expect(calls).toEqual([
    ["issue", "comment", "12", "--repo", "acme/web", "--body", "Done in the office by Rani: fixed"],
  ]);
});

test("a comment text that starts with dashes stays the one argument after --body", async () => {
  const { run, calls } = fakeGh(() => ok({}));
  await commentOnGithub("acme/web#12", "--repo evil/x --web", run);
  expect(calls[0]?.at(-2)).toBe("--body");
  expect(calls[0]?.at(-1)).toBe("--repo evil/x --web");
  expect(calls[0]).toHaveLength(7);
});

test("a key that is not a repository and a number is refused before gh runs", async () => {
  const { run, calls } = fakeGh(() => ok({}));
  for (const key of ["-evil/x#1", "acme/web#0", "acme/web#1 --web", "acme/web", "a/b#c"]) {
    await problemOf(commentOnGithub(key, "text", run));
  }
  expect(calls).toEqual([]);
});

test("a comment that gh refused is a problem, a timeout is marked as one", async () => {
  const refused = await problemOf(
    commentOnGithub("acme/web#12", "t", async () => failed("HTTP 404 secret")),
  );
  expect(refused.message).toBe("acme/web: not found, or gh's account cannot read it");
  expect(refused.timedOut).toBe(false);
  const slow = await problemOf(
    commentOnGithub("acme/web#12", "t", async () => ({ code: null, stdout: "", stderr: "" })),
  );
  expect(slow.timedOut).toBe(true);
  expect(slow.message).toBe("acme/web: gh did not answer in 30 seconds");
});

test("the source's comment goes through the same runner", async () => {
  const { run, calls } = fakeGh(() => ok({}));
  const source = createGithubSource({ repos: () => [], search: () => SEARCH, run });
  await source.comment?.("acme/web#2", "hello");
  expect(calls[0]?.slice(0, 3)).toEqual(["issue", "comment", "2"]);
});
