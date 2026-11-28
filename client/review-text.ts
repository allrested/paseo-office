import type { OfficeAgent, Post, WorkspacePullRequest } from "../shared/contracts.js";
import {
  answerTo,
  askedOf as answerOf,
  idleAgents,
  isUserRequest,
  type AskAgent,
  type Asked,
} from "./ask-text.js";
import type { HostNote } from "../shared/machine-text.js";
import { agentTitle, type OfficeModel, type OfficeRoom } from "../shared/model.js";
import { pullRequestLinkText, teamName } from "../shared/standup-text.js";

/** Where a pull request stands with its review. The order is the queue's. */
export type ReviewStand = "review" | "changes" | "approved" | "draft";

const STAND_ORDER: readonly ReviewStand[] = ["review", "changes", "approved", "draft"];
const STAND_WORDS: Readonly<Record<ReviewStand, string>> = {
  review: "Waiting for a review",
  changes: "Changes requested",
  approved: "Approved",
  draft: "Draft",
};
const CHECK_WORDS: Readonly<Record<WorkspacePullRequest["checks"], string | null>> = {
  none: null,
  pending: "checks running",
  success: "checks pass",
  failure: "checks fail",
};

/** What a review an agent wrote is cut at in the card; the board has all of it. */
const REVIEW_MAX = 600;

/** How a request for a review starts on the board: the office finds its own requests by it. */
export const REVIEW_MARK = "Review request: ";

/** How a request for a tour of a pull request starts; a tour is not a review. */
export const TOUR_MARK = "Tour request: ";

/** What a tour shows before the rest is folded behind a toggle. */
export const TOUR_LINES = 30;

export type ReviewAgent = AskAgent;

/** The newest request for a review of a pull request, and the note that answered it. */
export type ReviewAsked = Asked;

export interface ReviewRow {
  /** The pull request's room: its workspace's id. */
  roomId: string;
  /** "#128 Retry failed card charges". */
  title: string;
  /** The team, the branch and where it goes, and the size of the changes. */
  meta: string;
  url: string;
  linkText: string;
  stand: ReviewStand;
  /** The stand, the checks and conflicts in words. */
  status: string;
  /** Something stands between it and a merge that is not the review itself. */
  troubled: boolean;
  /** The branch it goes into and the one it comes from; null when the forge did not say. */
  base: string | null;
  head: string | null;
  /** Its place in a stack of pull requests; null outside one. */
  stack: StackPlace | null;
  asked: ReviewAsked | null;
  /**
   * Who a request would go to now: the team's newest idle agent. Null when none is idle, and
   * while the agent already asked has not answered.
   */
  reviewer: ReviewAgent | null;
  /** The newest request for a tour of the pull request, and the note that answered it. */
  tour: ReviewAsked | null;
  /** A tour was asked and its agent, still in the room, has not answered. */
  tourPending: boolean;
  /** Who Explain would go to: as `reviewer`, but kept apart from the review's own request. */
  explainer: ReviewAgent | null;
}

/** A row's place in a stack: "2 of 3" is position 2, depth 3. */
export interface StackPlace {
  position: number;
  depth: number;
}

function standOf(request: WorkspacePullRequest): ReviewStand {
  if (request.state === "draft") return "draft";
  if (request.review === "changes_requested") return "changes";
  return request.review === "approved" ? "approved" : "review";
}

/** A pull request by name: its number and its title. */
export function reviewTitle(request: Pick<WorkspacePullRequest, "number" | "title">): string {
  return request.number === null ? request.title : `#${request.number} ${request.title}`;
}

/**
 * What an agent is asked: a note that names it. The first line marks the note as a request and
 * the second is the pull request's address, which is how its answer is found again.
 */
export function reviewAsk(request: WorkspacePullRequest): string {
  const against = request.base === null ? "" : ` against ${request.base}`;
  return [
    `${REVIEW_MARK}${reviewTitle(request)}`,
    request.url,
    `Read the diff of this branch${against}, then post one note on this board with what you found, the worst first, each with its file and line. Change no files.`,
  ].join("\n");
}

/**
 * What an agent is asked for a tour: the same shape as a review request with its own first line.
 * It asks for a reading order and for no verdict; the office fetches no diff, the agent reads it.
 */
export function tourAsk(request: WorkspacePullRequest): string {
  return [
    `${TOUR_MARK}${reviewTitle(request)}`,
    request.url,
    "List the changed files in the order to read them, one line each with why it changed. Do not review the change.",
  ].join("\n");
}

function isRequestFor(post: Post, url: string, mark: string): boolean {
  if (!isUserRequest(post)) return false;
  const [first, second] = post.text.split("\n");
  return first !== undefined && first.startsWith(mark) && second === url;
}

/**
 * The newest request that starts with `mark` for a pull request, and its answer. A review and a
 * tour are separate requests answered by the same kind of note, so the requests of both kinds
 * share the agent's notes: oldest request first, each takes the asked agent's first note not
 * taken yet. With a review and a tour both asked of one agent, its first note answers the OLDER
 * request and the next note the newer one. Replies under a task are no answer.
 */
function askedOf(
  room: OfficeRoom,
  url: string,
  mark: string,
  agents: ReadonlyMap<string, OfficeAgent>,
  max: number,
): ReviewAsked | null {
  const requests = room.posts
    .filter((post) => [REVIEW_MARK, TOUR_MARK].some((kind) => isRequestFor(post, url, kind)))
    .sort((a, b) => a.seq - b.seq);
  const taken = new Set<string>();
  let found: { agentId: string; answer: Post | null } | null = null;
  for (const request of requests) {
    const answer = answerTo(room.posts, request, taken);
    if (answer !== null) taken.add(answer.id);
    if (request.to !== undefined && isRequestFor(request, url, mark)) {
      found = { agentId: request.to, answer };
    }
  }
  return found === null ? null : answerOf(found, agents, max);
}

/** Whether an agent was asked and has not answered, and is still here to. */
function isPending(room: OfficeRoom, asked: ReviewAsked | null): boolean {
  return (
    asked !== null && asked.text === null && room.rows.some((row) => row.agent.id === asked.agentId)
  );
}

function reviewerOf(room: OfficeRoom, asked: ReviewAsked | null): ReviewAgent | null {
  const present = new Set(room.rows.map((row) => row.agent.id));
  // A request without an answer is still with its agent, as long as that agent is here.
  if (asked !== null && asked.text === null && present.has(asked.agentId)) return null;
  const [newest] = idleAgents(room);
  return newest === undefined ? null : { agentId: newest.id, title: agentTitle(newest) };
}

/** The branch and where it goes: "fix into main". Null without a branch. */
function routeOf(branch: string | undefined, base: string | null): string | null {
  if (branch === undefined) return null;
  return base === null ? branch : `${branch} into ${base}`;
}

function metaOf(room: OfficeRoom, request: WorkspacePullRequest): string {
  const { branch, changes } = room.workspace ?? {};
  return [
    teamName({ name: room.name, project: room.subtitle }),
    routeOf(branch, request.base),
    // (a no-break space: the two numbers stay on one line)
    changes === undefined ? null : `+${changes.additions}\u00a0−${changes.deletions}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

/**
 * The review queue: every open or draft pull request of a workspace, the ones that wait for a
 * review first, then the ones sent back, the approved ones and the drafts.
 */
export function reviewRows(model: Pick<OfficeModel, "rooms" | "agents">): ReviewRow[] {
  const rows: ReviewRow[] = [];
  for (const room of model.rooms) {
    const request = room.workspace?.pullRequest;
    if (!request || (request.state !== "open" && request.state !== "draft")) continue;
    const stand = standOf(request);
    const checks = CHECK_WORDS[request.checks];
    const asked = askedOf(room, request.url, REVIEW_MARK, model.agents, REVIEW_MAX);
    const tour = askedOf(room, request.url, TOUR_MARK, model.agents, Number.POSITIVE_INFINITY);
    rows.push({
      roomId: room.id,
      title: reviewTitle(request),
      meta: metaOf(room, request),
      url: request.url,
      linkText: pullRequestLinkText(request),
      stand,
      status: [STAND_WORDS[stand], checks, request.conflicts ? "has conflicts" : null]
        .filter((part) => part !== null)
        .join(", "),
      troubled: stand === "changes" || request.checks === "failure" || request.conflicts,
      base: request.base,
      head: request.head ?? null,
      stack: null,
      asked,
      reviewer: reviewerOf(room, asked),
      tour,
      tourPending: isPending(room, tour),
      explainer: reviewerOf(room, tour),
    });
  }
  return reviewStacks(
    rows.sort((a, b) => STAND_ORDER.indexOf(a.stand) - STAND_ORDER.indexOf(b.stand)),
  );
}

/**
 * Pull requests on each other, in merge order. A row whose base is another row's head (both
 * known, compared exactly) stands on it; a stack runs from the row on a branch outside the set
 * upward, and a row with two children makes two lines that share it, each continuing in the order
 * the rows are listed. A row's depth is the longest line through it. A stack is kept together at
 * the place of its bottom; a cycle is bad data, not a stack, and its rows stay where they are.
 */
export function reviewStacks<T extends Pick<ReviewRow, "base" | "head" | "stack">>(
  rows: readonly T[],
): T[] {
  // A base that two heads match belongs to the first of them listed.
  const parentOf = rows.map((row, index) =>
    row.base === null ? -1 : rows.findIndex((other, at) => at !== index && other.head === row.base),
  );
  const children = rows.map((_, index) =>
    parentOf.flatMap((parent, child) => (parent === index ? [child] : [])),
  );
  const places = new Map<number, StackPlace>();
  const order = new Map<number, number[]>();
  const height = (index: number): number => 1 + Math.max(0, ...(children[index] ?? []).map(height));
  const walk = (index: number, position: number, line: number[]): void => {
    line.push(index);
    places.set(index, { position, depth: position - 1 + height(index) });
    for (const child of children[index] ?? []) walk(child, position + 1, line);
  };
  rows.forEach((_, index) => {
    if (parentOf[index] !== -1 || (children[index] ?? []).length === 0) return;
    const line: number[] = [];
    walk(index, 1, line);
    order.set(index, line);
  });
  const out: T[] = [];
  rows.forEach((row, index) => {
    const line = order.get(index);
    if (line === undefined) {
      if (!places.has(index)) out.push(row);
      return;
    }
    for (const member of line) {
      const base = rows[member];
      const stack = places.get(member);
      if (base !== undefined && stack !== undefined) out.push({ ...base, stack });
    }
  });
  return out;
}

/** A tour for the card: its first lines, the rest to fold away, and how many lines that is. */
export function tourView(text: string): { shown: string; rest: string; more: number } {
  const lines = text.split("\n");
  return {
    shown: lines.slice(0, TOUR_LINES).join("\n"),
    rest: lines.slice(TOUR_LINES).join("\n"),
    more: Math.max(0, lines.length - TOUR_LINES),
  };
}

/** "Stack: 2 of 3": the row's place from the bottom and the stack's depth along its line. */
export function stackLabel(stack: StackPlace): string {
  return `Stack: ${stack.position} of ${stack.depth}`;
}

/** Explain's label: "Asked Builder" while the agent has not answered. */
export function explainLabel(row: Pick<ReviewRow, "tour" | "tourPending">): string {
  return row.tourPending && row.tour !== null ? `Asked ${row.tour.title}` : "Explain";
}

function count(n: number, one: string, many: string): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`;
}

function waiting(rows: readonly ReviewRow[]): number {
  return rows.filter((row) => row.stand === "review").length;
}

/** The queue in a few words, for the strip; null when no pull request is open. */
export function reviewNote(rows: readonly ReviewRow[]): HostNote | null {
  if (rows.length === 0) return null;
  const toReview = waiting(rows);
  if (toReview > 0) return { text: `${toReview} to review`, tone: "warning" };
  return { text: count(rows.length, "pull request", "pull requests"), tone: "muted" };
}

/** What the card says under its first line: where the changes are read and the verdict given. */
export const REVIEW_HELP =
  "Read the changes in the workspace and give your verdict on the pull request's own page. An idle agent of the team can review it too: it answers with a note.";

/** The card's first line: how many pull requests are open and how many wait for a review. */
export function reviewSummary(rows: readonly ReviewRow[]): string {
  if (rows.length === 0) return "No open pull requests.";
  const toReview = waiting(rows);
  const open = count(rows.length, "open pull request", "open pull requests");
  return toReview === 0 ? `${open}, none waiting for a review` : `${open}, ${toReview} to review`;
}

/** The button that asks: "again" once a review of this pull request has come in. */
export function reviewAskLabel(row: Pick<ReviewRow, "asked">): string {
  return row.asked?.text ? "Ask for another review" : "Ask for a review";
}

/**
 * The line under a pull request's buttons: who would be asked, or why nobody can be. Null while
 * the agent already asked has not answered: the line about that request says it.
 */
export function reviewHint(
  row: Pick<ReviewRow, "asked" | "reviewer">,
  wakesPaused: boolean,
): string | null {
  if (row.reviewer === null) {
    return row.asked !== null && row.asked.text === null
      ? null
      : "No agent of this team is idle, so nobody can be asked.";
  }
  if (wakesPaused) return "Wake agents is off, so a request would wait. Turn it on to ask.";
  return `${row.reviewer.title} is idle and gets the request on the team's board.`;
}
