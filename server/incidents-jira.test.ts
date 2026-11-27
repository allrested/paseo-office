import { createServer, type Server, type ServerResponse } from "node:http";
import { afterEach, expect, test } from "vitest";
import { TrackerProblem } from "./incidents-http.js";
import { createJiraReader, jiraEnv } from "./incidents-jira.js";

interface Request {
  path: string;
  query: URLSearchParams;
  authorization: string | undefined;
}

interface StandIn {
  base: string;
  /** Every request but the look at the projects, which each read makes first. */
  requests: Request[];
  /** The project keys each read asked Jira for. */
  projectChecks: string[][];
  /** The keys Jira knows; every key asked for while null. */
  projects: string[] | null;
}

type Answer = (request: Request, res: ServerResponse) => void;

const servers: Server[] = [];

afterEach(async () => {
  const closing = servers.splice(0).map(
    (server) =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  await Promise.all(closing);
});

/** A local server standing in for Jira; it records each request and answers through `answer`. */
async function standIn(answer: Answer): Promise<StandIn> {
  const requests: Request[] = [];
  const projectChecks: string[][] = [];
  const stand: StandIn = { base: "", requests, projectChecks, projects: null };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/rest/api/3/project/search" && stand.projects !== undefined) {
      const asked = url.searchParams.getAll("keys");
      projectChecks.push(asked);
      const known = stand.projects ?? asked;
      json(res, { values: asked.filter((key) => known.includes(key)).map((key) => ({ key })) });
      return;
    }
    const request = {
      path: url.pathname,
      query: url.searchParams,
      authorization: req.headers.authorization,
    };
    requests.push(request);
    answer(request, res);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  stand.base = `http://127.0.0.1:${address.port}`;
  return stand;
}

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Answers `/myself` with `timeZone` and each search with the next of `pages`. */
function jira(timeZone: string, pages: unknown[]): Answer {
  let page = 0;
  return (request, res) => {
    if (request.path === "/rest/api/3/myself") return json(res, { timeZone });
    json(res, pages[page++]);
  };
}

const EMAIL = "me@team.test";
const TOKEN = "jira-test-token";

function env(base: string) {
  return { baseUrl: base, email: EMAIL, token: TOKEN };
}

const BUG = {
  key: "SHOP-12",
  fields: { summary: "Checkout fails on a split bill", created: "2026-11-17T08:03:12.000+0300" },
};

test("builds the JQL with the keys, Bug and the time in the user's zone", async () => {
  const server = await standIn(jira("Asia/Riyadh", [{ issues: [], isLast: true }]));
  await createJiraReader(env(server.base), ["SHOP", "QA"]).read(Date.UTC(2026, 10, 17, 5, 0, 42));
  expect(server.requests.map((request) => request.path)).toEqual([
    "/rest/api/3/myself",
    "/rest/api/3/search/jql",
  ]);
  expect(Object.fromEntries(server.requests[1].query)).toEqual({
    jql: 'project in ("SHOP", "QA") AND issuetype in ("Bug") AND created >= "2026-11-17 08:00" ORDER BY created ASC',
    fields: "summary,created",
    maxResults: "100",
  });
});

test("a key JQL reserves, such as USER, is quoted", async () => {
  const server = await standIn(jira("UTC", [{ issues: [], isLast: true }]));
  await createJiraReader(env(server.base), ["USER", "IN"]).read(0);
  expect(server.requests[1].query.get("jql")).toMatch(/^project in \("USER", "IN"\) AND /);
});

test("a user without a zone is read in UTC; a zone this host does not know is a problem", async () => {
  const unzoned = await standIn((request, res) => {
    if (request.path === "/rest/api/3/myself") return json(res, {});
    json(res, { issues: [] });
  });
  await createJiraReader(env(unzoned.base), ["SHOP"]).read(Date.UTC(2026, 10, 17, 5, 0));
  expect(unzoned.requests[1].query.get("jql")).toContain('created >= "2026-11-17 05:00"');
  const unknown = await standIn(jira("Mars/Olympus", []));
  await expect(createJiraReader(env(unknown.base), ["SHOP"]).read(0)).rejects.toThrow(
    new TrackerProblem("Jira's time zone Mars/Olympus is not known on this host"),
  );
});

test("sends basic auth and maps issues to links", async () => {
  const server = await standIn(jira("UTC", [{ issues: [BUG], isLast: true }]));
  const found = await createJiraReader(env(server.base), ["SHOP"]).read(Date.UTC(2026, 10, 17));
  const basic = `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64")}`;
  expect(server.requests.map((request) => request.authorization)).toEqual([basic, basic]);
  expect(found).toEqual([
    {
      key: "SHOP-12",
      title: "Checkout fails on a split bill",
      url: `${server.base}/browse/SHOP-12`,
      createdAt: Date.parse("2026-11-17T05:03:12.000Z"),
    },
  ]);
});

test("follows nextPageToken, asking only for what is left of 100", async () => {
  const first = Array.from({ length: 60 }, (_, i) => ({ ...BUG, key: `SHOP-${i + 1}` }));
  const second = Array.from({ length: 40 }, (_, i) => ({ ...BUG, key: `SHOP-${i + 61}` }));
  const pages = [
    { issues: first, nextPageToken: "page-2", isLast: false },
    { issues: second, nextPageToken: "page-3", isLast: false },
  ];
  const server = await standIn(jira("UTC", pages));
  const found = await createJiraReader(env(server.base), ["SHOP"]).read(0);
  const searches = server.requests.slice(1).map((request) => ({
    token: request.query.get("nextPageToken"),
    maxResults: request.query.get("maxResults"),
  }));
  expect(searches).toEqual([
    { token: null, maxResults: "100" },
    { token: "page-2", maxResults: "40" },
  ]);
  expect(found.map((issue) => issue.key)).toEqual([...first, ...second].map((bug) => bug.key));
});

test("a page holding a token and no issues ends the read", async () => {
  const server = await standIn((request, res) => {
    if (request.path === "/rest/api/3/myself") return json(res, { timeZone: "UTC" });
    json(res, { issues: [], nextPageToken: "again" });
  });
  expect(await createJiraReader(env(server.base), ["SHOP"]).read(0)).toEqual([]);
  expect(server.requests).toHaveLength(2);
});

test("isLast ends the read, and so does a token Jira handed out before", async () => {
  const last = await standIn(
    jira("UTC", [{ issues: [BUG], nextPageToken: "page-2", isLast: true }]),
  );
  await createJiraReader(env(last.base), ["SHOP"]).read(0);
  expect(last.requests).toHaveLength(2);

  const repeating = await standIn((request, res) => {
    if (request.path === "/rest/api/3/myself") return json(res, { timeZone: "UTC" });
    json(res, { issues: [BUG], nextPageToken: "same", isLast: false });
  });
  await createJiraReader(env(repeating.base), ["SHOP"]).read(0);
  const tokens = repeating.requests.slice(1).map((request) => request.query.get("nextPageToken"));
  expect(tokens).toEqual([null, "same"]);
});

test("a 401 is a problem naming ATLASSIAN_API_TOKEN, without the header", async () => {
  const server = await standIn((_request, res) => json(res, { errorMessages: [] }, 401));
  const read = createJiraReader(env(server.base), ["SHOP"]).read(0);
  await expect(read).rejects.toBeInstanceOf(TrackerProblem);
  const problem = await read.catch((error: unknown) => error);
  expect(problem).toHaveProperty("message", "Jira refused the token: check ATLASSIAN_API_TOKEN");
  expect(String(problem)).not.toContain("Basic");
  expect(String(problem)).not.toContain(TOKEN);
});

test("any other refusal carries the status and Jira's own message, cut at 200", async () => {
  const said = `The value 'NOPE' does not exist for the field 'project'. ${"x".repeat(300)}`;
  const server = await standIn((request, res) => {
    if (request.path === "/rest/api/3/myself") return json(res, { timeZone: "UTC" });
    json(res, { errorMessages: [said], errors: {} }, 400);
  });
  await expect(createJiraReader(env(server.base), ["NOPE"]).read(0)).rejects.toThrow(
    `Jira answered HTTP 400: ${said.slice(0, 200)}`,
  );
});

test("a redirect is refused and not followed", async () => {
  const elsewhere = await standIn((_request, res) => json(res, { timeZone: "UTC" }));
  const server = await standIn((request, res) => {
    res.writeHead(302, { location: `${elsewhere.base}${request.path}` });
    res.end();
  });
  await expect(createJiraReader(env(server.base), ["SHOP"]).read(0)).rejects.toThrow(
    "Jira answered with a redirect (HTTP 302)",
  );
  expect(elsewhere.requests).toEqual([]);
});

test("jiraEnv is null when one variable is missing", () => {
  const all = {
    ATLASSIAN_BASE_URL: " https://team.atlassian.net// ",
    ATLASSIAN_EMAIL: " me@team.test ",
    ATLASSIAN_API_TOKEN: " jira-test-token ",
  };
  expect(jiraEnv(all)).toEqual({
    baseUrl: "https://team.atlassian.net",
    email: "me@team.test",
    token: "jira-test-token",
  });
  for (const name of Object.keys(all)) {
    expect(jiraEnv({ ...all, [name]: undefined })).toBeNull();
    expect(jiraEnv({ ...all, [name]: "   " })).toBeNull();
  }
});

test("a project Jira does not know is a problem, not a quiet read", async () => {
  const server = await standIn(jira("UTC", [{ issues: [], isLast: true }]));
  server.projects = ["SHOP"];
  await expect(createJiraReader(env(server.base), ["SHOP", "SHPO", "QA"]).read(0)).rejects.toThrow(
    new TrackerProblem("Jira has no project SHPO, QA, or the token's user cannot see it"),
  );
  expect(server.projectChecks).toEqual([["SHOP", "SHPO", "QA"]]);
  expect(server.requests).toEqual([]);
});

test("the issue types named in the settings ring in place of Bug", async () => {
  const server = await standIn(jira("UTC", [{ issues: [], isLast: true }]));
  await createJiraReader(env(server.base), ["SHOP"], fetch, ["Bug", "Production Incident"]).read(0);
  expect(server.requests[1].query.get("jql")).toContain(
    'issuetype in ("Bug", "Production Incident") AND',
  );
});

test("the open incidents Jira holds as done are asked for by key", async () => {
  const server = await standIn((_request, res) => json(res, { issues: [{ key: "SHOP-12" }] }));
  const reader = createJiraReader(env(server.base), ["SHOP"]);
  const open = ["SHOP-12", "SHOP-13"].map((key) => ({ key, url: `${server.base}/browse/${key}` }));
  expect(await reader.resolved?.(open)).toEqual(["SHOP-12"]);
  expect(Object.fromEntries(server.requests[0].query)).toEqual({
    jql: 'key in ("SHOP-12", "SHOP-13") AND statusCategory = Done',
    fields: "summary",
    maxResults: "2",
  });
  expect(await reader.resolved?.([])).toEqual([]);
  expect(server.requests).toHaveLength(1);
});
