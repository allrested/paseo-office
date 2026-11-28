import { expect, test } from "vitest";
import type {
  OfficeAgent,
  OfficeSnapshot,
  OfficeWorkspace,
  Post,
  WorkspacePullRequest,
} from "../shared/contracts.js";
import { buildOfficeModel } from "../shared/model.js";
import {
  reviewAsk,
  reviewAskLabel,
  reviewHint,
  reviewNote,
  reviewRows,
  reviewStacks,
  reviewSummary,
  reviewTitle,
  tourAsk,
  tourView,
  type ReviewRow,
} from "./review-text.js";

function agent(id: string, patch: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: id,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-16T00:00:01Z",
    ...patch,
  };
}

function request(patch: Partial<WorkspacePullRequest> = {}): WorkspacePullRequest {
  return {
    number: 12,
    url: "https://forge.example/pull/12",
    title: "Fix checkout",
    base: "main",
    state: "open",
    checks: "none",
    runs: [],
    review: null,
    conflicts: false,
    ...patch,
  };
}

function workspace(id: string, patch: Partial<OfficeWorkspace> = {}): OfficeWorkspace {
  return { id, name: id, projectName: "shop", ...patch };
}

function post(seq: number, patch: Partial<Post>): Post {
  return {
    id: `p${seq}`,
    seq,
    board: "w1",
    kind: "note",
    text: "hello",
    author: "user",
    createdAt: "2026-11-16T08:00:00.000Z",
    updatedAt: "2026-11-16T08:00:00.000Z",
    ...patch,
  };
}

function office(
  agents: OfficeAgent[],
  workspaces: OfficeWorkspace[],
  boards: Record<string, Post[]> = {},
): OfficeSnapshot {
  return { agents, workspaces, activity: {}, boards, wake: { paused: false, queued: {} } };
}

function rowsOf(
  agents: OfficeAgent[],
  workspaces: OfficeWorkspace[],
  boards: Record<string, Post[]> = {},
) {
  return reviewRows(buildOfficeModel(office(agents, workspaces, boards)));
}

test("a pull request is named by its number and title, or by its title alone", () => {
  expect(reviewTitle(request())).toBe("#12 Fix checkout");
  expect(reviewTitle(request({ number: null }))).toBe("Fix checkout");
});

test("the queue has every open or draft pull request with what stands in its way", () => {
  const rows = rowsOf(
    [agent("a")],
    [
      workspace("w1", {
        name: "shop-api",
        branch: "feat/checkout",
        changes: { additions: 120, deletions: 30 },
        pullRequest: request({ checks: "failure", conflicts: true }),
      }),
      workspace("w2", { pullRequest: request({ state: "merged" }) }),
      workspace("w3", { pullRequest: request({ state: "closed" }) }),
      workspace("w4"),
    ],
  );
  expect(rows).toEqual([
    {
      roomId: "w1",
      title: "#12 Fix checkout",
      meta: "shop-api (shop) · feat/checkout into main · +120\u00a0−30",
      url: "https://forge.example/pull/12",
      linkText: "#12",
      stand: "review",
      status: "Waiting for a review, checks fail, has conflicts",
      troubled: true,
      base: "main",
      head: null,
      stack: null,
      asked: null,
      reviewer: { agentId: "a", title: "a" },
      tour: null,
      tourPending: false,
      explainer: { agentId: "a", title: "a" },
    },
  ]);
});

test("a row says no more of its branch than is known", () => {
  const meta = (patch: Partial<OfficeWorkspace>, base: string | null = null) =>
    rowsOf([], [workspace("w1", { pullRequest: request({ base }), ...patch })])[0]?.meta;
  expect(meta({})).toBe("w1 (shop)");
  expect(meta({ branch: "fix" })).toBe("w1 (shop) · fix");
  expect(meta({ branch: "fix" }, "main")).toBe("w1 (shop) · fix into main");
});

test("the queue starts with what waits for a review, then sent back, approved and drafts", () => {
  const rows = rowsOf(
    [],
    [
      workspace("draft", { pullRequest: request({ state: "draft", review: "approved" }) }),
      workspace("approved", { pullRequest: request({ review: "approved", checks: "success" }) }),
      workspace("changes", { pullRequest: request({ review: "changes_requested" }) }),
      workspace("pending", { pullRequest: request({ review: "pending", checks: "pending" }) }),
      workspace("fresh", { pullRequest: request() }),
    ],
  );
  expect(rows.map((row) => [row.roomId, row.status, row.troubled])).toEqual([
    ["pending", "Waiting for a review, checks running", false],
    ["fresh", "Waiting for a review", false],
    ["changes", "Changes requested", true],
    ["approved", "Approved, checks pass", false],
    ["draft", "Draft", false],
  ]);
});

test("a request goes to the team's newest idle agent", () => {
  const reviewer = (agents: OfficeAgent[]) =>
    rowsOf(agents, [workspace("w1", { pullRequest: request() })])[0]?.reviewer;
  expect(reviewer([])).toBeNull();
  expect(reviewer([agent("busy", { status: "running" })])).toBeNull();
  expect(reviewer([agent("broken", { status: "error" })])).toBeNull();
  expect(
    reviewer([agent("asks", { permissions: [{ id: "p", kind: "tool", title: "Bash" }] })]),
  ).toBeNull();
  expect(reviewer([agent("elsewhere", { workspaceId: "w2" })])).toBeNull();
  expect(
    reviewer([
      agent("author", { createdAt: "2026-11-16T00:00:01Z" }),
      agent("second", { createdAt: "2026-11-16T00:00:09Z" }),
      agent("third", { createdAt: "2026-11-16T00:00:05Z" }),
    ]),
  ).toEqual({ agentId: "second", title: "second" });
});

test("what an agent is asked names the pull request, its address and its base", () => {
  expect(reviewAsk(request())).toBe(
    [
      "Review request: #12 Fix checkout",
      "https://forge.example/pull/12",
      "Read the diff of this branch against main, then post one note on this board with what you found, the worst first, each with its file and line. Change no files.",
    ].join("\n"),
  );
  expect(reviewAsk(request({ base: null })).split("\n")[2]).toBe(
    "Read the diff of this branch, then post one note on this board with what you found, the worst first, each with its file and line. Change no files.",
  );
});

test("the newest request and the asked agent's first note after it are the review", () => {
  const ask = reviewAsk(request());
  const board = (posts: Post[]) =>
    rowsOf(
      [agent("a"), agent("b", { createdAt: "2026-11-16T00:00:02Z" })],
      [workspace("w1", { pullRequest: request() })],
      { w1: posts },
    )[0];

  // Asked and not answered: the request is with its agent, and nobody else is asked.
  const pending = board([
    post(1, { author: "b", text: "An older note." }),
    post(2, { text: ask, to: "b" }),
  ]);
  expect(pending?.asked).toEqual({ agentId: "b", title: "b", text: null, cut: false });
  expect(pending?.reviewer).toBeNull();

  // Answered: the first note after the request, not a later one, and not another agent's.
  const answered = board([
    post(1, { text: ask, to: "b" }),
    post(2, { author: "a", text: "Not the reviewer." }),
    post(3, { author: "b", text: "  One defect: cart.ts:40 rounds twice.  " }),
    post(4, { author: "b", text: "Stand-up: reviewed #12." }),
  ]);
  expect(answered?.asked).toEqual({
    agentId: "b",
    title: "b",
    text: "One defect: cart.ts:40 rounds twice.",
    cut: false,
  });
  expect(answered?.reviewer).toEqual({ agentId: "b", title: "b" });

  // A second request starts over.
  const again = board([
    post(1, { text: ask, to: "b" }),
    post(2, { author: "b", text: "First review." }),
    post(3, { text: ask, to: "a" }),
  ]);
  expect(again?.asked).toEqual({ agentId: "a", title: "a", text: null, cut: false });
});

test("a request for another pull request, a task and an agent's own post are not requests", () => {
  const ask = reviewAsk(request());
  const asked = (posts: Post[]) =>
    rowsOf([agent("a")], [workspace("w1", { pullRequest: request() })], { w1: posts })[0]?.asked;
  expect(
    asked([post(1, { text: reviewAsk(request({ url: "https://other" })), to: "a" })]),
  ).toBeNull();
  expect(asked([post(1, { text: ask })])).toBeNull();
  expect(asked([post(1, { text: ask, to: "a", author: "a" })])).toBeNull();
  expect(asked([post(1, { text: ask, to: "a", kind: "task", state: "open" })])).toBeNull();
  expect(asked([post(1, { text: "Review request: something else", to: "a" })])).toBeNull();
});

test("a request whose agent left can go to another, and a long review is cut", () => {
  const ask = reviewAsk(request());
  const row = rowsOf([agent("a")], [workspace("w1", { pullRequest: request() })], {
    w1: [post(1, { text: ask, to: "gone" })],
  })[0];
  expect(row?.asked).toEqual({
    agentId: "gone",
    title: "An agent that left",
    text: null,
    cut: false,
  });
  expect(row?.reviewer).toEqual({ agentId: "a", title: "a" });

  const long = rowsOf([agent("a")], [workspace("w1", { pullRequest: request() })], {
    w1: [post(1, { text: ask, to: "a" }), post(2, { author: "a", text: "x".repeat(700) })],
  })[0]?.asked;
  expect(long?.cut).toBe(true);
  expect(long?.text).toBe(`${"x".repeat(599)}…`);
});

test("the strip counts what waits for a review, else the open pull requests", () => {
  const note = (requests: WorkspacePullRequest[]) =>
    reviewNote(
      rowsOf(
        [],
        requests.map((pullRequest, index) => workspace(`w${index}`, { pullRequest })),
      ),
    );
  expect(note([])).toBeNull();
  expect(note([request({ state: "merged" })])).toBeNull();
  expect(
    note([request(), request({ review: "pending" }), request({ review: "approved" })]),
  ).toEqual({ text: "2 to review", tone: "warning" });
  expect(note([request({ review: "approved" })])).toEqual({
    text: "1 pull request",
    tone: "muted",
  });
  expect(note([request({ state: "draft" }), request({ review: "changes_requested" })])).toEqual({
    text: "2 pull requests",
    tone: "muted",
  });
});

test("the card's first line counts the open pull requests and the ones to review", () => {
  const summary = (requests: WorkspacePullRequest[]) =>
    reviewSummary(
      rowsOf(
        [],
        requests.map((pullRequest, index) => workspace(`w${index}`, { pullRequest })),
      ),
    );
  expect(summary([])).toBe("No open pull requests.");
  expect(summary([request()])).toBe("1 open pull request, 1 to review");
  expect(summary([request(), request({ state: "draft" })])).toBe(
    "2 open pull requests, 1 to review",
  );
  expect(summary([request({ review: "approved" })])).toBe(
    "1 open pull request, none waiting for a review",
  );
});

test("the button asks again once a review came in, and the line under it says who is asked", () => {
  const reviewer = { agentId: "a", title: "Tester" };
  const pending = { agentId: "a", title: "Tester", text: null, cut: false };
  const done = { ...pending, text: "Fine." };
  expect(reviewAskLabel({ asked: null })).toBe("Ask for a review");
  expect(reviewAskLabel({ asked: pending })).toBe("Ask for a review");
  expect(reviewAskLabel({ asked: done })).toBe("Ask for another review");

  expect(reviewHint({ asked: null, reviewer }, false)).toBe(
    "Tester is idle and gets the request on the team's board.",
  );
  expect(reviewHint({ asked: null, reviewer }, true)).toBe(
    "Wake agents is off, so a request would wait. Turn it on to ask.",
  );
  expect(reviewHint({ asked: null, reviewer: null }, false)).toBe(
    "No agent of this team is idle, so nobody can be asked.",
  );
  expect(reviewHint({ asked: done, reviewer: null }, false)).toBe(
    "No agent of this team is idle, so nobody can be asked.",
  );
  // The line about the request itself says that it waits.
  expect(reviewHint({ asked: pending, reviewer: null }, false)).toBeNull();
});

test("a tour request names the pull request, its address and what to list", () => {
  const lines = (patch: Partial<WorkspacePullRequest>) => tourAsk(request(patch)).split("\n");
  expect(lines({})).toEqual([
    "Tour request: #12 Fix checkout",
    "https://forge.example/pull/12",
    "List the changed files in the order to read them, one line each with why it changed. Do not review the change.",
  ]);
  expect(lines({ number: null })[0]).toBe("Tour request: Fix checkout");
});

const tourBoard = (posts: Post[], agents = [agent("a"), agent("b")]) =>
  rowsOf(agents, [workspace("w1", { pullRequest: request() })], { w1: posts })[0];

test("the tour is the asked agent's first note after the request, not a reply and not another's", () => {
  const ask = tourAsk(request());
  const answered = tourBoard([
    post(1, { text: ask, to: "b" }),
    post(2, { author: "a", text: "Not the one asked." }),
    post(3, { author: "b", text: "Reply under a task.", replyTo: "t1" }),
    post(4, { author: "b", text: "  cart.ts: the rounding  " }),
    post(5, { author: "b", text: "Later." }),
  ]);
  expect(answered?.tour).toEqual({
    agentId: "b",
    title: "b",
    text: "cart.ts: the rounding",
    cut: false,
  });
  expect(answered?.tourPending).toBe(false);
  expect(answered?.asked).toBeNull();
  expect(answered?.explainer).not.toBeNull();
});

test("a reply under a task is not taken for the review either", () => {
  const answered = tourBoard([
    post(1, { text: reviewAsk(request()), to: "b" }),
    post(2, { author: "b", text: "Reply under a task.", replyTo: "t1" }),
  ]);
  expect(answered?.asked?.text).toBeNull();
});

test("Explain is off while a tour is asked and its agent is in the room, and on when it left", () => {
  const ask = tourAsk(request());
  const asked = tourBoard([post(1, { text: ask, to: "b" })]);
  expect(asked?.tour).toEqual({ agentId: "b", title: "b", text: null, cut: false });
  expect(asked?.tourPending).toBe(true);
  expect(asked?.explainer).toBeNull();
  // (a review is a separate request: it is still open to be asked)
  expect(asked?.reviewer).not.toBeNull();

  const left = tourBoard([post(1, { text: ask, to: "gone" })]);
  expect(left?.tourPending).toBe(false);
  expect(left?.explainer).not.toBeNull();
});

test("a pending review does not block Explain, and the answer to one is not the other's", () => {
  const review = tourBoard([post(1, { text: reviewAsk(request()), to: "b" })]);
  expect(review?.reviewer).toBeNull();
  expect(review?.explainer).not.toBeNull();
  expect(review?.tour).toBeNull();
  const tour = tourBoard([
    post(1, { text: tourAsk(request()), to: "b" }),
    post(2, { author: "b", text: "tour answer" }),
  ]);
  expect(tour?.asked).toBeNull();
  expect(tour?.tour?.text).toBe("tour answer");
});

test("with a review and a tour both asked of one agent, the first note answers the older one", () => {
  const both = (first: string, second: string) =>
    tourBoard([
      post(1, { text: first, to: "b" }),
      post(2, { text: second, to: "b" }),
      post(3, { author: "b", text: "first note" }),
    ]);
  const review = reviewAsk(request());
  const tour = tourAsk(request());
  // review asked first: it gets "first note", the tour is still waiting
  const reviewFirst = both(review, tour);
  expect(reviewFirst?.asked?.text).toBe("first note");
  expect(reviewFirst?.tour?.text).toBeNull();
  // tour asked first: the other way round
  const tourFirst = both(tour, review);
  expect(tourFirst?.tour?.text).toBe("first note");
  expect(tourFirst?.asked?.text).toBeNull();
  // the next note answers the newer one
  const answered = tourBoard([
    post(1, { text: review, to: "b" }),
    post(2, { text: tour, to: "b" }),
    post(3, { author: "b", text: "first note" }),
    post(4, { author: "b", text: "second note" }),
  ]);
  expect(answered?.asked?.text).toBe("first note");
  expect(answered?.tour?.text).toBe("second note");
});

test("a tour shows its first 30 lines and counts the rest", () => {
  const long = Array.from({ length: 34 }, (_, index) => `file-${index + 1}.ts: why`).join("\n");
  const view = tourView(long);
  expect(view.shown.split("\n")).toHaveLength(30);
  expect(view.shown.endsWith("file-30.ts: why")).toBe(true);
  expect(view.rest).toBe("file-31.ts: why\nfile-32.ts: why\nfile-33.ts: why\nfile-34.ts: why");
  expect(view.more).toBe(4);
  expect(tourView("one\ntwo")).toEqual({ shown: "one\ntwo", rest: "", more: 0 });
});

test("a long tour is not cut at the review's length", () => {
  const long = "x".repeat(2000);
  const row = tourBoard([
    post(1, { text: tourAsk(request()), to: "b" }),
    post(2, { author: "b", text: long }),
  ]);
  expect(row?.tour?.text).toBe(long);
});

function stackRow(
  id: string,
  base: string | null,
  head: string | null,
): Pick<ReviewRow, "roomId" | "base" | "head" | "stack"> {
  return { roomId: id, base, head, stack: null };
}
const stacked = (rows: ReturnType<typeof stackRow>[]) =>
  reviewStacks(rows).map((row) =>
    row.stack === null ? row.roomId : `${row.roomId} ${row.stack.position}/${row.stack.depth}`,
  );

test("pull requests that are not on each other make no stack", () => {
  expect(stacked([stackRow("a", "main", "a"), stackRow("b", "main", "b")])).toEqual(["a", "b"]);
  expect(stacked([])).toEqual([]);
});

test("a pull request based on another's branch stands above it, in a stack of two", () => {
  // listed top first: the card puts the bottom first
  expect(stacked([stackRow("top", "mid", "top"), stackRow("mid", "main", "mid")])).toEqual([
    "mid 1/2",
    "top 2/2",
  ]);
});

test("a stack of three is kept together, bottom first, where its bottom stood in the queue", () => {
  expect(
    stacked([
      stackRow("x", "main", "x"),
      stackRow("c", "b", "c"),
      stackRow("y", "main", "y"),
      stackRow("a", "main", "a"),
      stackRow("b", "a", "b"),
    ]),
  ).toEqual(["x", "y", "a 1/3", "b 2/3", "c 3/3"]);
});

test("a fork is a stack that shares its bottom: each row is labelled by its depth", () => {
  expect(
    stacked([
      stackRow("root", "main", "root"),
      stackRow("one", "root", "one"),
      stackRow("two", "root", "two"),
      stackRow("two-up", "two", "two-up"),
    ]),
  ).toEqual(["root 1/3", "one 2/2", "two 2/3", "two-up 3/3"]);
});

test("a cycle is not a stack: its rows stay where they are with no label", () => {
  expect(
    stacked([stackRow("a", "b", "a"), stackRow("b", "a", "b"), stackRow("c", "main", "c")]),
  ).toEqual(["a", "b", "c"]);
  expect(stacked([stackRow("self", "self", "self")])).toEqual(["self"]);
});

test("a null head or base joins no stack, even with another null", () => {
  expect(stacked([stackRow("a", null, null), stackRow("b", null, null)])).toEqual(["a", "b"]);
  expect(stacked([stackRow("a", "main", null), stackRow("b", "x", "b")])).toEqual(["a", "b"]);
});

test("a merged pull request in the middle breaks the stack: the card lists none of it", () => {
  const rows = rowsOf(
    [],
    [
      workspace("w1", { pullRequest: request({ url: "u1", base: "main", head: "a" }) }),
      workspace("w2", {
        pullRequest: request({ url: "u2", base: "a", head: "b", state: "merged" }),
      }),
      workspace("w3", { pullRequest: request({ url: "u3", base: "b", head: "c" }) }),
    ],
  );
  expect(rows.map((row) => [row.roomId, row.stack])).toEqual([
    ["w1", null],
    ["w3", null],
  ]);
});

test("the queue keeps a stack together and labels its rows", () => {
  const rows = rowsOf(
    [],
    [
      workspace("top", { pullRequest: request({ url: "u1", base: "mid", head: "top" }) }),
      workspace("draft", { pullRequest: request({ url: "u2", state: "draft", head: "d" }) }),
      workspace("mid", { pullRequest: request({ url: "u3", base: "main", head: "mid" }) }),
    ],
  );
  expect(rows.map((row) => [row.roomId, row.stack])).toEqual([
    ["mid", { position: 1, depth: 2 }],
    ["top", { position: 2, depth: 2 }],
    ["draft", null],
  ]);
});
