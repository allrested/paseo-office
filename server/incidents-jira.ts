import { z } from "zod";
import {
  type FoundIssue,
  getJson,
  RESOLVED_MAX,
  type Tracker,
  TrackerProblem,
  type TrackerReader,
} from "./incidents-http.js";

/** The most issues one read returns; the check opens fewer than this at a time. */
const READ_MAX = 100;

export interface JiraEnv {
  baseUrl: string;
  email: string;
  token: string;
  /** What a refused token's message names; the environment's variable when absent. */
  tokenVariable?: string;
}

/** Jira's site and sign-in from the daemon's environment; null unless all three are set. */
export function jiraEnv(env: NodeJS.ProcessEnv): JiraEnv | null {
  const baseUrl = (env.ATLASSIAN_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const email = (env.ATLASSIAN_EMAIL ?? "").trim();
  const token = (env.ATLASSIAN_API_TOKEN ?? "").trim();
  if (baseUrl === "" || email === "" || token === "") return null;
  return { baseUrl, email, token };
}

// Jira gives the instance's zone when the user's is hidden or unset, so it is rarely absent.
const MyselfSchema = z.object({ timeZone: z.string().nullish() });

const ProjectsSchema = z.object({ values: z.array(z.object({ key: z.string() })) });
const KeysSchema = z.object({ issues: z.array(z.object({ key: z.string() })) });

const SearchSchema = z.object({
  issues: z.array(
    z.object({
      key: z.string(),
      // `created` as Jira writes it, `2026-11-17T08:03:12.000+0300`.
      fields: z.object({
        summary: z.string(),
        created: z.string().transform(Date.parse).pipe(z.number()),
      }),
    }),
  ),
  nextPageToken: z.string().nullish(),
  isLast: z.boolean().nullish(),
});

/**
 * `since` as JQL writes a time, `yyyy-MM-dd HH:mm`, in `timeZone`: Jira reads a JQL time in the
 * zone of the token user's profile. The seconds are dropped, so the minute `since` is in counts.
 */
function jqlTime(since: number, timeZone: string): string {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new TrackerProblem(`Jira's time zone ${timeZone} is not known on this host`);
    }
    throw error;
  }
  const parts = new Map(format.formatToParts(since).map((part) => [part.type, part.value]));
  const day = `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
  return `${day} ${parts.get("hour")}:${parts.get("minute")}`;
}

function jiraTracker(env: JiraEnv, fetchFn: typeof fetch): Tracker {
  const basic = Buffer.from(`${env.email}:${env.token}`).toString("base64");
  return {
    name: "Jira",
    tokenVariable: env.tokenVariable ?? "ATLASSIAN_API_TOKEN",
    headers: { Authorization: `Basic ${basic}` },
    fetchFn,
  };
}

/** One signed-in request, to tell whether Jira takes the sign-in. Rejects with a `TrackerProblem`. */
export async function probeJira(env: JiraEnv, fetchFn: typeof fetch = fetch): Promise<void> {
  const tracker = jiraTracker(env, fetchFn);
  await getJson({ tracker, url: `${env.baseUrl}/rest/api/3/myself`, schema: MyselfSchema });
}

/**
 * New issues of `types` (Bug when none are named) in `projects`, both already checked against the
 * settings' patterns.
 */
export function createJiraReader(
  env: JiraEnv,
  projects: string[],
  fetchFn: typeof fetch = fetch,
  types: string[] = ["Bug"],
): TrackerReader {
  const tracker = jiraTracker(env, fetchFn);
  const api = `${env.baseUrl}/rest/api/3`;
  const quoted = (words: readonly string[]) => words.map((word) => `"${word}"`).join(", ");

  /**
   * The search answers a project it does not know with no issues and no error, so a mistyped key
   * would ring nothing and say nothing. The projects are asked for by key first.
   */
  async function refuseUnknownProjects(): Promise<void> {
    const query = new URLSearchParams({ maxResults: String(projects.length) });
    for (const key of projects) query.append("keys", key);
    const listed = await getJson({
      tracker,
      url: `${api}/project/search?${query}`,
      schema: ProjectsSchema,
    });
    const known = new Set(listed.values.map((project) => project.key.toUpperCase()));
    const missing = projects.filter((key) => !known.has(key.toUpperCase()));
    if (missing.length > 0) {
      throw new TrackerProblem(
        `Jira has no project ${missing.join(", ")}, or the token's user cannot see it`,
      );
    }
  }

  async function resolved(open: readonly { key: string }[]): Promise<string[]> {
    const keys = open.slice(0, RESOLVED_MAX).map((incident) => incident.key);
    if (keys.length === 0) return [];
    const query = new URLSearchParams({
      jql: `key in (${quoted(keys)}) AND statusCategory = Done`,
      fields: "summary",
      maxResults: String(keys.length),
    });
    const done = await getJson({ tracker, url: `${api}/search/jql?${query}`, schema: KeysSchema });
    return done.issues.map((issue) => issue.key);
  }

  async function read(since: number): Promise<FoundIssue[]> {
    await refuseUnknownProjects();
    const myself = await getJson({ tracker, url: `${api}/myself`, schema: MyselfSchema });
    // Without a zone from Jira, UTC: the instance's own zone is not known here.
    const time = jqlTime(since, myself.timeZone ?? "UTC");
    // Quoted, since a key such as USER or IN is a word JQL reserves. A key holds no `"`.
    const jql = `project in (${quoted(projects)}) AND issuetype in (${quoted(types)}) AND created >= "${time}" ORDER BY created ASC`;
    const found: FoundIssue[] = [];
    const tokensSeen = new Set<string>();
    let pageToken: string | null = null;
    do {
      const query = new URLSearchParams({
        jql,
        fields: "summary,created",
        maxResults: String(READ_MAX - found.length),
      });
      if (pageToken !== null) query.set("nextPageToken", pageToken);
      const page = await getJson({
        tracker,
        url: `${api}/search/jql?${query}`,
        schema: SearchSchema,
      });
      for (const issue of page.issues) {
        found.push({
          key: issue.key,
          title: issue.fields.summary,
          url: `${env.baseUrl}/browse/${issue.key}`,
          createdAt: issue.fields.created,
        });
      }
      // Jira can hand out a token with an empty page, or the same token again: following it would
      // never end, and the run would hold up every later run and dismiss.
      const next = page.nextPageToken ?? null;
      const more = page.isLast !== true && page.issues.length > 0 && next !== null;
      pageToken = more && !tokensSeen.has(next) ? next : null;
      if (next !== null) tokensSeen.add(next);
    } while (pageToken !== null && found.length < READ_MAX);
    return found.slice(0, READ_MAX);
  }

  return { read, resolved };
}
