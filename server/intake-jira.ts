import { z } from "zod";
import { SOURCE_KEYS } from "../shared/contracts.js";
import { getJson, postJson, TrackerProblem } from "./incidents-http.js";
import { jiraTracker, type JiraEnv } from "./incidents-jira.js";
import {
  INTAKE_PAGES_MAX,
  INTAKE_READ_MAX,
  ticketBody,
  ticketTitle,
  type IntakeIssue,
  type IntakeRead,
  type IntakeSource,
} from "./intake-service.js";

// Each issue is read on its own, so one of an odd shape is skipped and the rest still come.
const SearchSchema = z.object({
  issues: z.array(z.unknown()),
  nextPageToken: z.string().nullish(),
  isLast: z.boolean().nullish(),
});
const IssueSchema = z.object({
  key: z.string(),
  fields: z.object({ summary: z.string().nullish(), description: z.unknown().optional() }),
});

/** Inline nodes of Atlassian's document format: joined on their line. Any other node is a block. */
const INLINE = new Set(["text", "hardBreak", "mention", "emoji", "inlineCard", "date", "status"]);
/** Deeper than this a document is not read: a hand-made one could nest without end. */
const DEPTH_MAX = 40;

interface DocNode {
  type?: unknown;
  text?: unknown;
  attrs?: unknown;
  content?: unknown;
}

function isInline(node: unknown): boolean {
  return typeof node === "object" && node !== null && INLINE.has(String((node as DocNode).type));
}

/** A document's text: text nodes joined, each block on its own line. */
function documentText(node: unknown, depth = 0): string {
  if (typeof node !== "object" || node === null || depth > DEPTH_MAX) return "";
  const { type, text, attrs, content } = node as DocNode;
  if (type === "text") return typeof text === "string" ? text : "";
  if (type === "hardBreak") return "\n";
  if (type === "mention" || type === "emoji" || type === "status") {
    const label = typeof attrs === "object" && attrs !== null ? (attrs as DocNode).text : undefined;
    return typeof label === "string" ? label : "";
  }
  if (!Array.isArray(content)) return "";
  const parts = content.map((child) => documentText(child, depth + 1));
  return parts.join(content.every(isInline) ? "" : "\n");
}

/** A description as plain text: Jira's API 3 gives a document, an older field a string. */
function descriptionText(description: unknown): string {
  if (typeof description === "string") return description;
  return documentText(description);
}

/**
 * The tickets the owner's JQL matches, read 20 a page until 20 are not `seen` or 5 pages were
 * read: tickets already imported do not use up a run. The JQL is sent as written: the office adds
 * nothing to it. The link is built from the saved address and the key, never taken from the
 * answer, and a ticket whose key is not a Jira key is skipped and counted. Seen tickets are
 * returned too, so the intake can record one it finds only on the board.
 */
export async function readJiraIssues(
  env: JiraEnv,
  jql: string,
  fetchFn: typeof fetch = fetch,
  seen: (key: string) => boolean = () => false,
): Promise<IntakeRead> {
  const tracker = jiraTracker(env, fetchFn);
  const issues: IntakeIssue[] = [];
  let skipped = 0;
  let unseen = 0;
  let pages = 0;
  const tokensSeen = new Set<string>();
  let pageToken: string | null = null;
  do {
    const query = new URLSearchParams({
      jql,
      fields: "summary,description",
      maxResults: String(INTAKE_READ_MAX),
    });
    if (pageToken !== null) query.set("nextPageToken", pageToken);
    const answer = await getJson({
      tracker,
      url: `${env.baseUrl}/rest/api/3/search/jql?${query}`,
      schema: SearchSchema,
    });
    pages += 1;
    for (const found of answer.issues.slice(0, INTAKE_READ_MAX)) {
      const parsed = IssueSchema.safeParse(found);
      if (!parsed.success || !SOURCE_KEYS.jira.test(parsed.data.key)) {
        skipped += 1;
        continue;
      }
      const { key, fields } = parsed.data;
      issues.push({
        key,
        url: `${env.baseUrl}/browse/${key}`,
        title: ticketTitle(fields.summary ?? ""),
        body: ticketBody(descriptionText(fields.description)),
      });
      if (!seen(key)) unseen += 1;
      if (unseen >= INTAKE_READ_MAX) break;
    }
    // Jira can hand out a token with an empty page, or the same token again: following it would
    // never end.
    const next = answer.nextPageToken ?? null;
    const more = answer.isLast !== true && answer.issues.length > 0 && next !== null;
    pageToken = more && !tokensSeen.has(next) ? next : null;
    if (next !== null) tokensSeen.add(next);
  } while (pageToken !== null && unseen < INTAKE_READ_MAX && pages < INTAKE_PAGES_MAX);
  return { issues, skipped, crowded: pages >= INTAKE_PAGES_MAX && unseen === 0 };
}

/** One comment on a ticket, as a document of one paragraph. Rejects with a `TrackerProblem`. */
export async function commentOnJira(
  env: JiraEnv,
  key: string,
  text: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  if (!SOURCE_KEYS.jira.test(key)) throw new TrackerProblem("Jira has no ticket of that key");
  // A document's text holds no line break: each is a break node in the one paragraph.
  const content: object[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (index > 0) content.push({ type: "hardBreak" });
    if (line !== "") content.push({ type: "text", text: line });
  }
  await postJson({
    tracker: jiraTracker(env, fetchFn),
    url: `${env.baseUrl}/rest/api/3/issue/${key}/comment`,
    body: { body: { type: "doc", version: 1, content: [{ type: "paragraph", content }] } },
  });
}

/** Jira as the intake's source: set up with a sign-in and a JQL that is not blank. */
export function createJiraSource(ports: {
  env(): JiraEnv | null;
  jql(): string;
  fetchFn?: typeof fetch;
}): IntakeSource {
  const fetchFn = ports.fetchFn ?? fetch;
  function signIn(): JiraEnv {
    const env = ports.env();
    if (env === null) throw new TrackerProblem("Jira has no sign-in");
    return env;
  }
  return {
    kind: "jira",
    configured: () => ports.env() !== null && ports.jql().trim() !== "",
    read: async (seen) => readJiraIssues(signIn(), ports.jql(), fetchFn, seen),
    comment: async (key, text) => commentOnJira(signIn(), key, text, fetchFn),
  };
}
