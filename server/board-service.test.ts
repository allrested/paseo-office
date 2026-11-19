import { expect, test } from "vitest";
import type { Duty, Post } from "../shared/contracts.js";
import { EMPTY_BOARDS, type BoardStore, type BoardsFile } from "./board-store.js";
import {
  createBoardService,
  trimBoard,
  type BoardService,
  type BoardServicePorts,
} from "./board-service.js";
import { createFakeClock, settle, type FakeClock } from "./fake-clock.js";

const T0 = Date.parse("2026-11-11T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const NAMES = new Map([
  ["a", "Alice"],
  ["b", "Bob"],
]);

interface MemoryStore extends BoardStore {
  saved: BoardsFile[];
  failNext: boolean;
  /** A load waits for this. */
  ready: Promise<void>;
}

function memoryStore(initial: BoardsFile = EMPTY_BOARDS): MemoryStore {
  let current = initial;
  const store: MemoryStore = {
    saved: [],
    failNext: false,
    ready: Promise.resolve(),
    load: async () => {
      await store.ready;
      return current;
    },
    save: async (data) => {
      if (store.failNext) {
        store.failNext = false;
        throw new Error("disk full");
      }
      current = data;
      store.saved.push(data);
    },
  };
  return store;
}

interface Harness {
  service: BoardService;
  store: MemoryStore;
  clock: FakeClock;
  events: string[];
}

interface Listeners {
  onBoard?: (board: string, posts: readonly Post[]) => void;
  onBoardRemoved?: (board: string) => void;
  refuse?: BoardServicePorts["refuse"];
}

/** A service that has not loaded its boards yet. */
function build(initial?: BoardsFile, listeners: Listeners = {}): Harness {
  const store = memoryStore(initial);
  const clock = createFakeClock(T0);
  const events: string[] = [];
  const service = createBoardService({
    store,
    clock,
    log: (message) => events.push(`log ${message}`),
    label: (author) => NAMES.get(author) ?? author,
    onBoard:
      listeners.onBoard ??
      ((board, posts) => events.push(`board ${board} ${posts.map((item) => item.id).join(",")}`)),
    onBoardRemoved: listeners.onBoardRemoved ?? ((board) => events.push(`removed ${board}`)),
    ...(listeners.refuse ? { refuse: listeners.refuse } : {}),
  });
  return { service, store, clock, events };
}

async function harness(initial?: BoardsFile, listeners?: Listeners): Promise<Harness> {
  const built = build(initial, listeners);
  await built.service.start();
  return built;
}

function post(seq: number, fields: Partial<Post> = {}): Post {
  return {
    id: `p${seq}`,
    seq,
    board: "w1",
    kind: "note",
    text: `post ${seq}`,
    author: "user",
    createdAt: new Date(T0 + seq * 1000).toISOString(),
    updatedAt: new Date(T0 + seq * 1000).toISOString(),
    ...fields,
  };
}

function file(posts: Post[]): BoardsFile {
  return { version: 1, nextSeq: posts.length + 1, wakesPaused: false, posts };
}

test("a post gets the next seq, an id, trimmed text and an open state", async () => {
  const { service, events } = await harness();
  const result = await service.post({
    board: "w1",
    kind: "task",
    text: "  Write tests  ",
    author: "a",
    to: "b",
  });
  expect(result).toEqual({
    ok: true,
    post: {
      id: "p1",
      seq: 1,
      board: "w1",
      kind: "task",
      text: "Write tests",
      author: "a",
      to: "b",
      state: "open",
      createdAt: "2026-11-11T09:00:00.000Z",
      updatedAt: "2026-11-11T09:00:00.000Z",
    },
  });
  expect(events).toEqual(["board w1 p1"]);
  expect(service.boards()).toEqual({ w1: [result.ok ? result.post : null] });
});

test("posts made at the same time run one after the other", async () => {
  const { service } = await harness();
  const results = await Promise.all(
    ["one", "two", "three"].map((text) =>
      service.post({ board: "w1", kind: "note", text, author: "user" }),
    ),
  );
  expect(results.map((result) => result.ok && result.post.id)).toEqual(["p1", "p2", "p3"]);
  expect(service.boards().w1?.map((item) => item.text)).toEqual(["one", "two", "three"]);
});

test("a post made while the boards load waits for them", async () => {
  const { service, store } = build(file([post(1), post(2)]));
  let finishLoad: () => void = () => undefined;
  store.ready = new Promise((resolve) => {
    finishLoad = resolve;
  });
  const started = service.start();
  const posting = service.post({ board: "w1", kind: "note", text: "late", author: "user" });
  // Time for the post to go ahead of the load, if it does not wait.
  await settle();
  expect(store.saved).toEqual([]);
  finishLoad();
  await started;
  const late = await posting;
  expect(late.ok && late.post.id).toBe("p3");
  expect(service.boards().w1?.map((item) => item.id)).toEqual(["p1", "p2", "p3"]);
});

test("blank and overlong text is refused", async () => {
  const { service, store } = await harness();
  expect(await service.post({ board: "lobby", kind: "note", text: "   ", author: "user" })).toEqual(
    {
      ok: false,
      error: "Unable to post: the text is empty",
    },
  );
  expect(
    await service.post({ board: "lobby", kind: "note", text: "x".repeat(2001), author: "user" }),
  ).toEqual({
    ok: false,
    error: "Unable to post: the text is longer than 2,000 characters",
  });
  expect(store.saved).toEqual([]);
});

test("claim rules: one claimer, a repeat claim is a no-op, done cannot be claimed, reopen clears", async () => {
  const { service } = await harness();
  await service.post({ board: "w1", kind: "task", text: "Ship it", author: "user" });
  const claimed = await service.update({ id: "p1", action: "claim", actor: "a" });
  expect(claimed).toEqual({
    ok: true,
    post: expect.objectContaining({ state: "claimed", claimedBy: "a", seq: 2 }),
  });
  expect(await service.update({ id: "p1", action: "claim", actor: "b" })).toEqual({
    ok: false,
    error: "Unable to claim p1: claimed by Alice",
  });
  expect(await service.update({ id: "p1", action: "claim", actor: "a" })).toEqual(claimed);
  expect(await service.update({ id: "p1", action: "done", actor: "a" })).toEqual({
    ok: true,
    post: expect.objectContaining({ state: "done", claimedBy: "a", seq: 3 }),
  });
  expect(await service.update({ id: "p1", action: "claim", actor: "b" })).toEqual({
    ok: false,
    error: "Unable to claim p1: it is done",
  });
  const reopened = await service.update({ id: "p1", action: "reopen", actor: "b" });
  expect(reopened.ok && reopened.post).toEqual({
    id: "p1",
    seq: 4,
    board: "w1",
    kind: "task",
    text: "Ship it",
    author: "user",
    state: "open",
    createdAt: "2026-11-11T09:00:00.000Z",
    updatedAt: "2026-11-11T09:00:00.000Z",
  });
});

test("reopening an open task and finishing a done one change nothing", async () => {
  const { service, store } = await harness();
  const created = await service.post({
    board: "w1",
    kind: "task",
    text: "Ship it",
    author: "user",
  });
  expect(await service.update({ id: "p1", action: "reopen", actor: "a" })).toEqual(created);
  const done = await service.update({ id: "p1", action: "done", actor: "a" });
  expect(await service.update({ id: "p1", action: "done", actor: "b" })).toEqual(done);
  expect(store.saved).toHaveLength(2);
});

function lobbyTask(seq: number, fields: Partial<Post> = {}): Post {
  return post(seq, { board: "lobby", kind: "task", state: "open", ...fields });
}

test("lobby pickup serializes competing agents and tasks, even across a restart", async () => {
  const { service, store } = await harness(file([lobbyTask(1), lobbyTask(2)]));
  const [claim, otherAgent, secondTask] = await Promise.all([
    service.claimLobbyTask("p1", "a", 1),
    service.claimLobbyTask("p1", "b", 1),
    service.claimLobbyTask("p2", "a", 2),
  ]);
  expect(claim).toMatchObject({ id: "p1", seq: 3, claimedBy: "a", state: "claimed" });
  expect([otherAgent, secondTask]).toEqual([null, null]);
  expect(store.saved).toHaveLength(1);

  const restarted = (await harness(await store.load())).service;
  expect(await restarted.claimLobbyTask("p2", "a", 2)).toBeNull();
  expect(await restarted.claimLobbyTask("p2", "b", 2)).toMatchObject({ id: "p2", claimedBy: "b" });
});

test("a late rollback cannot reopen an acknowledged delivery", async () => {
  const { service } = await harness(file([lobbyTask(1)]));
  const claim = await service.claimLobbyTask("p1", "a", 1);
  expect(claim?.pickupMessageId).toBeTruthy();
  if (!claim) throw new Error("expected a claim");
  await service.confirmLobbyDelivery(claim);
  await service.releaseLobbyTask(claim);
  expect(service.postsOf("lobby")[0]).toMatchObject({ state: "claimed", claimedBy: "a" });
  expect(service.postsOf("lobby")[0]).not.toHaveProperty("pickupMessageId");
});

test("pickup skips directed posts, notes, room tasks, stale tasks, and the author's own tasks", async () => {
  const { service, store } = await harness(
    file([
      lobbyTask(1, { to: "a" }),
      post(2, { board: "lobby" }),
      lobbyTask(3, { board: "w1" }),
      lobbyTask(4, { state: "done" }),
      lobbyTask(5, { author: "a" }),
      lobbyTask(6),
    ]),
  );
  for (const seq of [1, 2, 3, 4, 5]) {
    expect(await service.claimLobbyTask(`p${seq}`, "a", seq)).toBeNull();
  }
  expect(await service.claimLobbyTask("p6", "a", 1)).toBeNull();
  expect(store.saved).toHaveLength(0);
  await service.setWakesPaused(true);
  expect(await service.claimLobbyTask("p6", "a", 6)).toBeNull();
});

test("releasing a failed delivery preserves manual changes, including a newer claim by the same agent", async () => {
  const { service, store } = await harness(file([lobbyTask(1)]));
  const first = await service.claimLobbyTask("p1", "a", 1);
  if (!first) throw new Error("expected an initial claim");
  await service.update({ id: first.id, actor: "user", action: "reopen" });
  const second = await service.update({ id: first.id, actor: "a", action: "claim" });
  if (!second.ok) throw new Error(second.error);
  await service.releaseLobbyTask(first);
  await service.releaseLobbyTask({ ...second.post, claimedBy: "b" });
  expect(service.boards().lobby).toEqual([second.post]);
  await service.update({ id: first.id, actor: "user", action: "done" });
  await service.releaseLobbyTask(second.post);
  expect((await store.load()).posts[0]?.state).toBe("done");
});

test("pickup and release propagate save errors and can be retried with their original revision", async () => {
  const { service, store } = await harness(file([lobbyTask(1)]));
  store.failNext = true;
  await expect(service.claimLobbyTask("p1", "a", 1)).rejects.toThrow("disk full");
  expect((await store.load()).posts[0]).toEqual(lobbyTask(1));
  const claim = await service.claimLobbyTask("p1", "a", 1);
  if (!claim) throw new Error("expected the retry to claim the task");
  store.failNext = true;
  await expect(service.releaseLobbyTask(claim)).rejects.toThrow("disk full");
  expect((await store.load()).posts[0]).toEqual(claim);
  await service.releaseLobbyTask(claim);
  await service.releaseLobbyTask(claim);
  expect((await store.load()).posts[0]).toMatchObject({ state: "open", seq: 3 });
  expect((await store.load()).posts[0]).not.toHaveProperty("claimedBy");
  expect(store.saved).toHaveLength(2);
});

test("notes have no state, and unknown ids are refused", async () => {
  const { service } = await harness();
  await service.post({ board: "w1", kind: "note", text: "fyi", author: "a" });
  expect(await service.update({ id: "p1", action: "claim", actor: "b" })).toEqual({
    ok: false,
    error: "Unable to claim p1: it is a note",
  });
  expect(await service.update({ id: "p9", action: "done", actor: "b" })).toEqual({
    ok: false,
    error: "Unable to update p9: no such post",
  });
});

test("a full board drops its oldest done tasks, then its oldest notes", () => {
  const posts = [
    post(1, { kind: "note" }),
    post(2, { kind: "task", state: "done" }),
    post(3, { kind: "task", state: "open" }),
    post(4, { kind: "note" }),
  ];
  expect(trimBoard(posts, 3).map((item) => item.id)).toEqual(["p1", "p3", "p4"]);
  expect(trimBoard(posts, 2).map((item) => item.id)).toEqual(["p3", "p4"]);
  expect(trimBoard(posts, 1).map((item) => item.id)).toEqual(["p3"]);
});

test("a board of 200 open tasks refuses a new post; one with a note makes room", async () => {
  const open = Array.from({ length: 200 }, (_, index) =>
    post(index + 1, { kind: "task", state: "open" }),
  );
  const full = await harness(file(open));
  expect(
    await full.service.post({ board: "w1", kind: "note", text: "hi", author: "user" }),
  ).toEqual({
    ok: false,
    error: "Unable to post: the board holds 200 open or claimed tasks",
  });
  const withNote = await harness(file([post(1, { kind: "note" }), ...open.slice(1)]));
  const result = await withNote.service.post({
    board: "w1",
    kind: "note",
    text: "hi",
    author: "user",
  });
  expect(result.ok).toBe(true);
  expect(
    withNote.service
      .boards()
      .w1?.map((item) => item.id)
      .includes("p1"),
  ).toBe(false);
  expect(withNote.service.boards().w1).toHaveLength(200);
});

test("done tasks are removed 7 days after they were finished", async () => {
  const { service, clock } = await harness();
  await service.post({ board: "w1", kind: "task", text: "Old", author: "user" });
  await service.update({ id: "p1", action: "done", actor: "user" });
  clock.advance(7 * DAY);
  await service.prune();
  expect(service.boards().w1).toHaveLength(1);
  clock.advance(1);
  await service.prune();
  expect(service.boards()).toEqual({});
});

test("read returns the newest 30, or the next 30 after a cursor, newest last", async () => {
  const { service } = await harness(
    file(Array.from({ length: 40 }, (_, index) => post(index + 1))),
  );
  const first = service.read("w1", null);
  expect([
    first.posts[0]?.id,
    first.posts.at(-1)?.id,
    first.posts.length,
    first.cursor,
    first.more,
  ]).toEqual(["p11", "p40", 30, 40, false]);
  const paged = service.read("w1", 5);
  expect([paged.posts[0]?.id, paged.posts.at(-1)?.id, paged.cursor, paged.more]).toEqual([
    "p6",
    "p35",
    35,
    true,
  ]);
  expect(service.read("w1", 40)).toEqual({ posts: [], cursor: 40, more: false });
  expect(service.read("lobby", null)).toEqual({ posts: [], cursor: 0, more: false });
});

test("a failed save changes nothing and says so", async () => {
  const { service, store, events } = await harness();
  store.failNext = true;
  expect(await service.post({ board: "w1", kind: "note", text: "hi", author: "user" })).toEqual({
    ok: false,
    error: "Unable to save the board: disk full",
  });
  expect(service.boards()).toEqual({});
  expect(events).toEqual(["log [office] unable to save the board: disk full"]);
  expect((await service.post({ board: "w1", kind: "note", text: "hi", author: "user" })).ok).toBe(
    true,
  );
});

test("deleting a post, removing a board, and the persisted wake pause", async () => {
  const { service, store, events } = await harness();
  await service.post({ board: "w1", kind: "note", text: "one", author: "user" });
  await service.post({ board: "w2", kind: "note", text: "two", author: "user" });
  expect(await service.remove("p1")).toEqual({ ok: true });
  expect(await service.remove("p1")).toEqual({
    ok: false,
    error: "Unable to delete p1: no such post",
  });
  await service.removeBoard("w2");
  await service.removeBoard("w3");
  expect(service.boards()).toEqual({});
  expect(events.slice(-3)).toEqual(["board w1 ", "removed w2", "removed w3"]);
  await service.setWakesPaused(true);
  expect(service.wakesPaused()).toBe(true);
  expect(store.saved.at(-1)?.wakesPaused).toBe(true);
  store.failNext = true;
  await expect(service.setWakesPaused(false)).rejects.toThrow(
    "Unable to save the board: disk full",
  );
  expect(service.wakesPaused()).toBe(true);
});

/** lobby: p1 task done, p2 task open, p3 note, p4 task done; w1: p5 task done. */
function clearable(): Post[] {
  return [
    post(1, { board: "lobby", kind: "task", state: "done" }),
    post(2, { board: "lobby", kind: "task", state: "open" }),
    post(3, { board: "lobby", kind: "note" }),
    post(4, { board: "lobby", kind: "task", state: "done" }),
    post(5, { board: "w1", kind: "task", state: "done" }),
  ];
}

test("clearing a board deletes its done tasks in one save and leaves the rest", async () => {
  const { service, store, events } = await harness(file(clearable()));
  const saves = store.saved.length;
  expect(await service.clearDone("lobby")).toEqual({ ok: true });
  expect(store.saved.length).toBe(saves + 1);
  expect(service.boards().lobby?.map((item) => item.id)).toEqual(["p2", "p3"]);
  expect(service.boards().w1?.map((item) => item.id)).toEqual(["p5"]);
  expect(events.at(-1)).toMatch(/^board lobby /);
});

test("clearing a board with no done task saves nothing", async () => {
  const lobbyOpen = clearable().filter((item) => item.board !== "lobby" || item.state !== "done");
  const { service, store } = await harness(file(lobbyOpen));
  const saves = store.saved.length;
  expect(await service.clearDone("lobby")).toEqual({ ok: true });
  expect(store.saved.length).toBe(saves);
});

test("a clear that cannot save keeps the posts", async () => {
  const { service, store } = await harness(file(clearable()));
  store.failNext = true;
  expect(await service.clearDone("lobby")).toEqual({
    ok: false,
    error: expect.stringMatching(/^Unable to save the board/),
  });
  expect(service.boards().lobby).toHaveLength(4);
});

test("a listener that throws is logged and the change still stands", async () => {
  const { service, events } = await harness(undefined, {
    onBoard: () => {
      throw new Error("hub down");
    },
    onBoardRemoved: () => {
      throw new Error("hub gone");
    },
  });
  expect((await service.post({ board: "w1", kind: "note", text: "hi", author: "user" })).ok).toBe(
    true,
  );
  await service.removeBoard("w1");
  expect(service.boards()).toEqual({});
  expect(events).toEqual([
    "log [office] board listener failed: hub down",
    "log [office] board listener failed: hub gone",
  ]);
});

function dutyPost(seq: number, id: string, day: string, fields: Partial<Post> = {}): Post {
  return post(seq, { board: "duty", kind: "task", state: "open", duty: { id, day }, ...fields });
}

const CUPS: Duty = { id: "cups", name: "Cups", instructions: "", days: [3], chore: "cups" };
const BUILD: Duty = { id: "build", name: "Build", instructions: "Run the build", days: [3] };

test("the day's sync posts each due duty once, keyed by duty and day", async () => {
  const { service, store, events } = await harness();
  const plan = { duties: [CUPS, BUILD], day: "2026-11-11", due: [CUPS, BUILD] };
  await service.syncDuties(plan);
  expect(service.postsOf("duty")).toMatchObject([
    {
      id: "p1",
      text: "Cups",
      state: "open",
      author: "user",
      duty: { id: "cups", day: "2026-11-11" },
    },
    { id: "p2", text: "Build\n\nRun the build", duty: { id: "build", day: "2026-11-11" } },
  ]);
  expect(events).toEqual(["board duty p1,p2"]);
  await service.syncDuties(plan);
  await service.update({ id: "p1", action: "done", actor: "user" });
  await service.syncDuties(plan);
  expect(service.postsOf("duty")).toHaveLength(2);
  expect(store.saved).toHaveLength(2);
});

test("an open or claimed duty of an earlier day is owed: no second post; done ones of earlier days go", async () => {
  const { service } = await harness(
    file([
      dutyPost(1, "cups", "2026-11-10", { text: "Cups" }),
      dutyPost(2, "build", "2026-11-10", { state: "claimed", claimedBy: "a" }),
      dutyPost(3, "cups", "2026-11-09", { state: "done" }),
      dutyPost(4, "build", "2026-11-11", { state: "done" }),
    ]),
  );
  await service.syncDuties({ duties: [CUPS, BUILD], day: "2026-11-11", due: [CUPS, BUILD] });
  expect(service.postsOf("duty").map((item) => item.id)).toEqual(["p1", "p2", "p4"]);
  await service.syncDuties({ duties: [CUPS, BUILD], day: "2026-11-12", due: [] });
  expect(service.postsOf("duty").map((item) => item.id)).toEqual(["p1", "p2"]);
});

test("a duty that leaves the list takes its open post; an edit changes its open post's text", async () => {
  const { service } = await harness(
    file([
      dutyPost(1, "cups", "2026-11-11"),
      dutyPost(2, "build", "2026-11-11", { text: "Build\n\nRun the build" }),
      dutyPost(3, "gone", "2026-11-11", { state: "claimed", claimedBy: "a" }),
      dutyPost(4, "gone2", "2026-11-11"),
    ]),
  );
  const edited = { ...BUILD, name: "Build it", instructions: "Run the full build" };
  await service.syncDuties({ duties: [edited], day: "2026-11-11", due: [] });
  const posts = service.postsOf("duty");
  expect(posts.map((item) => item.id)).toEqual(["p3", "p2"]);
  expect(posts[1]).toMatchObject({ text: "Build it\n\nRun the full build", seq: 5 });
});

test("a pretend duty acted out is done by that agent; the first report wins", async () => {
  const { service } = await harness(
    file([
      dutyPost(1, "cups", "2026-11-11"),
      lobbyTask(2),
      dutyPost(3, "build", "2026-11-11", { state: "claimed", claimedBy: "b" }),
    ]),
  );
  expect(await service.actDuty("p1", "a")).toMatchObject({
    ok: true,
    post: { state: "done", claimedBy: "a" },
  });
  expect(await service.actDuty("p1", "b")).toMatchObject({ ok: true, post: { claimedBy: "a" } });
  expect(await service.actDuty("p2", "a")).toEqual({
    ok: false,
    error: "Unable to record p2: it is not a duty",
  });
  expect(await service.actDuty("p3", "a")).toEqual({
    ok: false,
    error: "Unable to record p3: claimed by Bob",
  });
  expect(await service.actDuty("p9", "a")).toEqual({
    ok: false,
    error: "Unable to record p9: no such post",
  });
});

test("a refusal port stops an update before the state rules, and pickup claims duty posts too", async () => {
  const { service } = await harness(
    file([dutyPost(1, "cups", "2026-11-11"), dutyPost(2, "build", "2026-11-11"), lobbyTask(3)]),
    {
      refuse: (item, input) =>
        item.duty?.id === "cups" && input.action === "claim" ? "it is a pretend duty" : null,
    },
  );
  expect(await service.update({ id: "p1", action: "claim", actor: "a" })).toEqual({
    ok: false,
    error: "Unable to claim p1: it is a pretend duty",
  });
  expect(await service.claimLobbyTask("p1", "a", 1)).toBeNull();
  const claim = await service.claimLobbyTask("p2", "a", 2);
  expect(claim).toMatchObject({ id: "p2", state: "claimed", claimedBy: "a" });
  // One at a time: an agent holding a duty is handed no lobby task.
  expect(await service.claimLobbyTask("p3", "a", 3)).toBeNull();
  if (!claim) throw new Error("expected a claim");
  await service.releaseLobbyTask(claim);
  expect(service.postsOf("duty")[1]).toMatchObject({ state: "open", duty: { id: "build" } });
  const again = await service.claimLobbyTask("p2", "a", service.postsOf("duty")[1]?.seq ?? 0);
  if (!again) throw new Error("expected a second claim");
  await service.finishLobbyClaim(again);
  expect(service.postsOf("duty")[1]).toMatchObject({ state: "done", duty: { id: "build" } });
});
