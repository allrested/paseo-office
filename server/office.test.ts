import { expect, test } from "vitest";
import type { AgentToolContext } from "@getpaseo/plugin/server";
import type { Post, WakeState } from "../shared/contracts.js";
import { EMPTY_BOARDS, type BoardStore, type BoardsFile } from "./board-store.js";
import { createFakeClock, settle } from "./fake-clock.js";
import {
  PRUNE_INTERVAL_MS,
  createOffice,
  wakeAuthorLabel,
  type OfficeHub,
  type OfficeAgentPorts,
} from "./office.js";
import type { WakeTarget } from "./mention-queue.js";

interface RecordingHub extends OfficeHub {
  events: string[];
}

function recordingHub(): RecordingHub {
  const events: string[] = [];
  return {
    events,
    setBoards: (boards) => events.push(`boards ${Object.keys(boards).join(",")}`),
    setBoard: (board, posts: readonly Post[]) => events.push(`board ${board} ${posts.length}`),
    removeBoard: (board) => events.push(`removed ${board}`),
    setWake: (wake: WakeState) => events.push(`wake ${wake.paused} ${JSON.stringify(wake.queued)}`),
  };
}

interface MemoryStore extends BoardStore {
  current(): BoardsFile;
  /** The next save rejects with this message. */
  failNext(message: string): void;
  /** Loads wait until `release` is called. */
  hold(): void;
  release(): void;
}

function memoryStore(initial: BoardsFile = EMPTY_BOARDS): MemoryStore {
  let current = initial;
  let failure: string | null = null;
  let open: () => void = () => undefined;
  let gate: Promise<void> = Promise.resolve();
  return {
    current: () => current,
    failNext(message) {
      failure = message;
    },
    hold() {
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
    },
    release: () => open(),
    load: async () => {
      await gate;
      return current;
    },
    save: async (data) => {
      if (failure !== null) {
        const message = failure;
        failure = null;
        throw new Error(message);
      }
      current = data;
    },
  };
}

/** The agents the daemon knows, by full id and by a start of one. */
const FULL_IDS = new Map([
  ["a", "a"],
  ["b", "b"],
  ["bo", "b"],
]);

function setup(initial?: BoardsFile) {
  const clock = createFakeClock(Date.parse("2026-11-11T09:00:00.000Z"));
  const hub = recordingHub();
  const store = memoryStore(initial);
  const targets = new Map<string, WakeTarget>([["b", "wakeable"]]);
  const prompts: string[] = [];
  const sources: (string | null)[] = [];
  const logs: string[] = [];
  const build = (overrides?: Partial<OfficeAgentPorts>) =>
    createOffice({
      store,
      clock,
      hub,
      agents: {
        lobbyCandidates: async () =>
          [...targets.keys()].filter((id) => targets.get(id) === "wakeable"),
        lobbyEligible: async (id) => targets.get(id) === "wakeable",
        status: async (agentId) => targets.get(agentId) ?? "gone",
        resolve: async (agentId) => FULL_IDS.get(agentId) ?? null,
        workspaceOf: async () => null,
        send: async (agentId, prompt, source) => {
          prompts.push(`${agentId}: ${prompt}`);
          sources.push(source);
        },
        ...overrides,
      },
      log: (message) => logs.push(message),
    });
  return { build, clock, hub, store, targets, prompts, sources, logs };
}

function start(initial?: BoardsFile) {
  const harness = setup(initial);
  return { ...harness, office: harness.build() };
}

function toolContext(agent: { id: string; title: string | null }): AgentToolContext {
  return {
    agent: {
      id: agent.id,
      workspaceId: "w1",
      parentAgentId: null,
      provider: "claude",
      cwd: "/",
      title: agent.title,
      metadata: {},
      background: false,
    },
    paseo: undefined as unknown as AgentToolContext["paseo"],
    signal: new AbortController().signal,
  };
}

test("author labels name the user, or the agent's title and id", () => {
  expect(wakeAuthorLabel("user", undefined)).toBe("the user");
  expect(wakeAuthorLabel("a1", "Review MR")).toBe("Review MR (a1)");
  expect(wakeAuthorLabel("a1", undefined)).toBe("agent a1");
});

test("on start the hub gets the boards and the wake state", async () => {
  const { office, hub } = start();
  await office.ready;
  expect(hub.events).toEqual(["boards ", "wake false {}"]);
});

test("a user post that names an agent lands on the board and wakes it", async () => {
  const { office, hub, prompts, sources } = start();
  await office.ready;
  expect((await office.post({ board: "w1", kind: "task", text: "Review this", to: "b" })).ok).toBe(
    true,
  );
  await settle();
  expect(prompts).toEqual(["b: Office board: 1 post(s) for you.\n- p1 from the user: Review this"]);
  // The user's post is a prompt as from the user: it names no source agent.
  expect(sources).toEqual([null]);
  expect(hub.events.slice(2)).toEqual(["board w1 1", 'wake false {"b":1}', "wake false {}"]);
});

test("an agent's tool post is labelled with its title and id, and the wake names it as the source", async () => {
  const { office, prompts, sources } = start();
  await office.ready;
  const post = office.tools.find((tool) => tool.name === "office_post");
  office.noteAgent({ id: "a", workspaceId: "w1", title: "Planner" });
  await post?.execute(
    { kind: "note", text: "Your turn", to: "b" },
    toolContext({ id: "a", title: "Planner" }),
  );
  await settle();
  expect(prompts).toEqual([
    "b: Office board: 1 post(s) for you.\n- p1 from Planner (a): Your turn",
  ]);
  expect(sources).toEqual(["a"]);
});

test("a tool post to the start of an agent's id is stored and queued under the full id", async () => {
  const { office, store, prompts } = start();
  await office.ready;
  const post = office.tools.find((tool) => tool.name === "office_post");
  const result = await post?.execute(
    { kind: "note", text: "Your turn", to: "bo" },
    toolContext({ id: "a", title: null }),
  );
  await settle();
  expect(result?.isError).toBeUndefined();
  expect(store.current().posts.map((item) => item.to)).toEqual(["b"]);
  // Queued under "bo", the agent's turn-end and close hooks (which carry "b") would never find it.
  expect(prompts).toEqual(["b: Office board: 1 post(s) for you.\n- p1 from agent a: Your turn"]);
});

test("a tool post to an agent the daemon does not know is refused and nothing is stored", async () => {
  const { office, store, prompts } = start();
  await office.ready;
  const post = office.tools.find((tool) => tool.name === "office_post");
  const result = await post?.execute(
    { kind: "note", text: "Anyone?", to: "zz" },
    toolContext({ id: "a", title: null }),
  );
  await settle();
  expect(result).toEqual({ text: "Unable to post: no agent zz", isError: true });
  expect(store.current().posts).toEqual([]);
  expect(prompts).toEqual([]);
});

test("a title with a line break names its agent on one line", async () => {
  const { office } = start();
  await office.ready;
  office.noteAgent({ id: "a", workspaceId: "w1", title: "  Plan\nner \n" });
  await office.post({ board: "w1", kind: "task", text: "Review this" });
  const update = office.tools.find((tool) => tool.name === "office_update");
  await update?.execute({ id: "p1", action: "claim" }, toolContext({ id: "a", title: null }));
  // The user is refused with the holder's name; a second line there would read as another entry.
  expect(await office.update({ id: "p1", action: "claim" })).toEqual({
    ok: false,
    error: "Unable to claim p1: claimed by Plan ner",
  });
});

test("pausing is saved and holds wakes until resumed", async () => {
  const { office, store, prompts } = start();
  await office.ready;
  expect(await office.setWakesPaused(true)).toEqual({ paused: true, queued: {} });
  expect(store.current().wakesPaused).toBe(true);
  await office.post({ board: "w1", kind: "note", text: "Later", to: "b" });
  await settle();
  expect(prompts).toEqual([]);
  expect(await office.setWakesPaused(false)).toEqual({ paused: false, queued: { b: 1 } });
  await settle();
  expect(prompts).toHaveLength(1);
});

test("a pause that cannot be saved is refused and wakes go on", async () => {
  const { office, store, prompts } = start();
  await office.ready;
  store.failNext("disk full");
  await expect(office.setWakesPaused(true)).rejects.toThrow("disk full");
  await office.post({ board: "w1", kind: "note", text: "Now", to: "b" });
  await settle();
  expect(prompts).toHaveLength(1);
});

test("a saved pause holds wakes from the start", async () => {
  const { office, hub, prompts } = start({ ...EMPTY_BOARDS, wakesPaused: true });
  await office.ready;
  expect(hub.events).toEqual(["boards ", "wake true {}"]);
  await office.post({ board: "w1", kind: "note", text: "Later", to: "b" });
  await settle();
  expect(prompts).toEqual([]);
});

test("an agent's turn end sends what waited for it, and a closed agent's queue is dropped", async () => {
  const { office, hub, targets, prompts } = start();
  await office.ready;
  targets.set("b", "busy");
  await office.post({ board: "w1", kind: "note", text: "one", to: "b" });
  await settle();
  expect(prompts).toEqual([]);
  targets.set("b", "wakeable");
  office.turnEnded("b");
  await settle();
  expect(prompts).toHaveLength(1);
  targets.set("b", "busy");
  await office.post({ board: "w1", kind: "note", text: "two", to: "b" });
  await settle();
  office.agentGone("b");
  expect(hub.events.slice(-2)).toEqual(['wake false {"b":1}', "wake false {}"]);
});

test("an archived workspace loses its board; done tasks are pruned every hour", async () => {
  const { office, hub, clock, store } = start();
  await office.ready;
  await office.post({ board: "w1", kind: "note", text: "one" });
  await office.workspaceArchived("w1");
  expect(hub.events.at(-1)).toBe("removed w1");
  await office.post({ board: "w2", kind: "task", text: "two" });
  await office.update({ id: "p2", action: "done" });
  clock.advance(7 * 24 * 60 * 60 * 1000);
  await settle();
  expect(store.current().posts).toHaveLength(1);
  clock.advance(PRUNE_INTERVAL_MS);
  await settle();
  expect(store.current().posts).toEqual([]);
  office.stop();
  expect(clock.pending()).toBe(0);
});

test("stopping the office cancels a wake that waited to be tried again", async () => {
  const { office, clock, targets, prompts } = start();
  await office.ready;
  targets.set("b", "busy");
  await office.post({ board: "w1", kind: "note", text: "one", to: "b" });
  await settle();
  office.stop();
  expect(clock.pending()).toBe(0);
  targets.set("b", "wakeable");
  clock.advance(60_000);
  await settle();
  expect(prompts).toEqual([]);
});

test("an office stopped while its boards load starts no timer and tells the hub nothing", async () => {
  const { build, store, hub, clock } = setup();
  store.hold();
  const office = build();
  office.stop();
  store.release();
  await office.ready;
  expect(hub.events).toEqual([]);
  expect(clock.pending()).toBe(0);
});

test("a stored lobby backlog waits for enabled tools and wakes, and hands the next task to a freed agent", async () => {
  const { office, build, clock, targets, store, prompts } = start();
  await office.ready;
  await office.post({ board: "lobby", kind: "task", text: "One" });
  await office.post({ board: "lobby", kind: "note", text: "Discussion" });
  await office.post({ board: "w1", kind: "task", text: "Workspace only" });
  await office.post({ board: "lobby", kind: "task", text: "Two" });
  await office.setWakesPaused(true);
  await office.stop();
  const next = build();
  next.setPickupEnabled(true);
  await next.ready;
  clock.advance(30_000);
  await settle();
  expect(prompts).toEqual([]);
  targets.set("b", "busy");
  await next.setWakesPaused(false);
  clock.advance(0);
  await settle();
  expect(prompts).toEqual([]);
  targets.set("b", "wakeable");
  next.turnEnded("b");
  clock.advance(0);
  await settle();
  expect(store.current().posts.find((p) => p.id === "p1")).toMatchObject({
    state: "claimed",
    claimedBy: "b",
  });
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("One");
  next.turnEnded("b");
  clock.advance(30_000);
  await settle();
  expect(prompts).toHaveLength(1);
  await next.update({ id: "p1", action: "done" });
  clock.advance(0);
  await settle();
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("Two");
  await next.stop();
});

test("a lost receipt survives reload and retries the same prompt and identifier without blocking another agent", async () => {
  const { build, clock, targets, store } = setup();
  targets.set("c", "wakeable");
  const attempts: { id: string; prompt: string; messageId: string | undefined }[] = [];
  let first = true;
  const send: OfficeAgentPorts["send"] = async (id, prompt, _source, messageId) => {
    attempts.push({ id, prompt, messageId });
    if (first) {
      first = false;
      throw new Error("lost connection");
    }
  };
  const office = build({ send });
  await office.ready;
  await office.post({ board: "lobby", kind: "task", text: "First" });
  await office.post({ board: "lobby", kind: "task", text: "Second" });
  office.setPickupEnabled(true);
  clock.advance(0);
  await settle();
  expect(attempts.map((a) => a.id)).toEqual(["b", "c"]);
  expect(store.current().posts.find((p) => p.id === "p1")?.pickupMessageId).toBe(
    attempts[0]?.messageId,
  );
  expect(store.current().posts.find((p) => p.id === "p2")).not.toHaveProperty("pickupMessageId");
  await office.stop();
  const reloaded = build({ send });
  reloaded.setPickupEnabled(true);
  await reloaded.ready;
  clock.advance(0);
  await settle();
  expect(attempts).toHaveLength(3);
  expect(attempts[0]?.messageId).toBeTruthy();
  expect(attempts[2]).toEqual(attempts[0]);
  expect(store.current().posts.every((p) => p.state === "claimed" && !p.pickupMessageId)).toBe(
    true,
  );
  await reloaded.stop();
});

test("a pending permission discovered after claiming sends nothing and releases the task", async () => {
  const { build, clock, store, prompts } = setup();
  const office = build({ lobbyEligible: async () => false });
  await office.ready;
  office.setPickupEnabled(true);
  await office.post({ board: "lobby", kind: "task", text: "Wait" });
  clock.advance(0);
  await settle();
  expect(prompts).toEqual([]);
  expect(store.current().posts[0]).toMatchObject({ state: "open" });
  expect(store.current().posts[0]).not.toHaveProperty("claimedBy");
  await office.stop();
});

test("explicit mentions share the hourly wake budget with lobby assignments", async () => {
  const { office, clock, prompts } = start();
  await office.ready;
  for (let i = 0; i < 6; i++) {
    await office.post({ board: "w1", kind: "note", text: "Please look", to: "b" });
    await settle();
  }
  await office.post({ board: "lobby", kind: "task", text: "Backlog" });
  office.setPickupEnabled(true);
  clock.advance(0);
  await settle();
  expect(prompts).toHaveLength(6);
  clock.advance(60 * 60 * 1000);
  office.turnEnded("b");
  await settle();
  clock.advance(30_000);
  await settle();
  expect(prompts).toHaveLength(7);
  expect(prompts[6]).toContain("Backlog");
  await office.stop();
});

test("a session without its board tool can confirm just its current assignment", async () => {
  const { office, prompts, store, clock } = start();
  await office.ready;
  office.setPickupEnabled(true);
  await office.post({ board: "lobby", kind: "task", text: "Check the notes" });
  clock.advance(0);
  await settle();
  const line = "Completed office task p1 (assignment 2).";
  expect(prompts[0]).toContain(line);
  await office.checkCompletion("b", async () => "I need more information.");
  await office.checkCompletion("other", async () => line);
  expect(store.current().posts[0]?.state).toBe("claimed");
  await office.checkCompletion("b", async () => {
    await office.update({ id: "p1", action: "reopen" });
    return line;
  });
  expect(store.current().posts[0]?.state).toBe("open");
  clock.advance(0);
  await settle();
  await office.checkCompletion("b", async () => line);
  expect(store.current().posts[0]?.state).toBe("claimed");
  await office.checkCompletion(
    "b",
    async () => "Verified.\nCompleted office task p1 (assignment 4).",
  );
  expect(store.current().posts[0]?.state).toBe("done");
  await office.stop();
});

const CUPS = { id: "cups", name: "Cups", instructions: "", days: [3], chore: "cups" as const };
const BUILD = { id: "build", name: "Build", instructions: "Run the build", days: [3] };
const TODAY = "2026-11-11";
const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10);

test("an instructed duty goes to an idle agent as a lobby task does; a pretend one never does", async () => {
  const { office, clock, store, prompts, sources } = start();
  await office.ready;
  office.setDuties([CUPS, BUILD]);
  await office.syncDuties({ duties: [CUPS, BUILD], day: TODAY, due: [CUPS, BUILD], dayOf });
  office.setPickupEnabled(true);
  clock.advance(0);
  await settle();
  expect(prompts).toEqual([
    [
      "b: The office assigned you duty p2 from the duty board.",
      "  Build",
      "  ",
      "  Run the build",
      'Work on this task. When it is complete, use office_update with id "p2", action "done" and a short result in note. If you need input, leave it claimed and explain what you need.',
      "If the tool is unavailable and you have finished, put this exact line at the end of your reply: Completed office task p2 (assignment 3).",
    ].join("\n"),
  ]);
  expect(sources).toEqual([null]);
  expect(store.current().posts[0]).toMatchObject({ id: "p1", state: "open" });
  expect(store.current().posts[0]).not.toHaveProperty("claimedBy");
  await office.checkCompletion("b", async () => "Done.\nCompleted office task p2 (assignment 3).");
  expect(store.current().posts[1]).toMatchObject({ id: "p2", state: "done", claimedBy: "b" });
  clock.advance(30_000);
  await settle();
  expect(prompts).toHaveLength(1);
  await office.stop();
});

test("an agent cannot claim a pretend duty; the 3D office's report of one acted out is recorded", async () => {
  const { office } = start();
  await office.ready;
  office.setDuties([CUPS, BUILD]);
  await office.syncDuties({ duties: [CUPS, BUILD], day: TODAY, due: [CUPS, BUILD], dayOf });
  const update = office.tools.find((tool) => tool.name === "office_update");
  const claimed = await update?.execute(
    { id: "p1", action: "claim" },
    toolContext({ id: "a", title: "Planner" }),
  );
  expect(claimed).toEqual({
    text: "Unable to claim p1: it is a pretend duty, which the 3D office acts out",
    isError: true,
  });
  expect(await office.actDuty("p1", "a")).toMatchObject({
    ok: true,
    post: { state: "done", claimedBy: "a" },
  });
  expect(await office.actDuty("p2", "a")).toEqual({
    ok: false,
    error: "Unable to record p2: an agent is handed this duty",
  });
  expect(await office.post({ board: "duty", kind: "task", text: "Extra" })).toEqual({
    ok: false,
    error: "Unable to post: the duty board takes its duties from the duty list",
  });
  await office.stop();
});

test("on the duty board an agent finishes or reopens only a duty it holds; the owner's hand marks any", async () => {
  const { office } = start();
  await office.ready;
  office.setDuties([CUPS, BUILD]);
  await office.syncDuties({ duties: [CUPS, BUILD], day: TODAY, due: [CUPS, BUILD], dayOf });
  const update = office.tools.find((tool) => tool.name === "office_update");
  const as = (agentId: string, id: string, action: string) =>
    update?.execute({ id, action }, toolContext({ id: agentId, title: null }));
  const refused = (text: string) => ({ text, isError: true });
  // A pretend duty has no holder: no agent finishes it.
  expect(await as("a", "p1", "done")).toEqual(
    refused("Unable to finish p1: it is a pretend duty, which the 3D office acts out"),
  );
  expect(await as("a", "p2", "done")).toEqual(refused("Unable to finish p2: claim it first"));
  expect(await as("b", "p2", "claim")).not.toHaveProperty("isError");
  expect(await as("a", "p2", "done")).toEqual(refused("Unable to finish p2: claimed by b"));
  expect(await as("a", "p2", "reopen")).toEqual(refused("Unable to reopen p2: claimed by b"));
  // The holder lets it go, as the pickup's release does, and finishes it, as its finish does.
  expect(await as("b", "p2", "reopen")).not.toHaveProperty("isError");
  expect(await as("b", "p2", "claim")).not.toHaveProperty("isError");
  expect(await as("b", "p2", "done")).not.toHaveProperty("isError");
  expect(await as("b", "p2", "reopen")).toEqual(refused("Unable to reopen p2: it is done"));
  // The owner's hand, from the duty board's editor.
  expect(await office.update({ id: "p2", action: "reopen" })).toMatchObject({
    ok: true,
    post: { state: "open" },
  });
  expect(await office.update({ id: "p1", action: "done" })).toMatchObject({
    ok: true,
    post: { state: "done" },
  });
  await office.stop();
});

test("a duty acted out names an agent of the office; an unknown one is refused", async () => {
  const { office } = start();
  await office.ready;
  office.setDuties([CUPS]);
  await office.syncDuties({ duties: [CUPS], day: TODAY, due: [CUPS], dayOf });
  expect(await office.actDuty("p1", "nobody")).toEqual({
    ok: false,
    error: "Unable to record p1: no agent nobody",
  });
  // A start of an id names the agent, as everywhere on the boards.
  expect(await office.actDuty("p1", "bo")).toMatchObject({
    ok: true,
    post: { state: "done", claimedBy: "b" },
  });
  await office.stop();
});

test("a duty that loses its instructions while it is handed out is still delivered, and its agent gets work after it", async () => {
  const harness = setup();
  let failNext = true;
  const office = harness.build({
    send: async (agentId, prompt) => {
      if (failNext) {
        failNext = false;
        throw new Error("the network is down");
      }
      harness.prompts.push(`${agentId}: ${prompt}`);
    },
  });
  const { clock, store, prompts } = harness;
  await office.ready;
  office.setDuties([BUILD]);
  await office.syncDuties({ duties: [BUILD], day: TODAY, due: [BUILD], dayOf });
  office.setPickupEnabled(true);
  clock.advance(0);
  await settle();
  expect(store.current().posts[0]).toMatchObject({ state: "claimed", claimedBy: "b" });
  expect(store.current().posts[0]?.pickupMessageId).toEqual(expect.any(String));
  // The owner takes the instructions out before the delivery is tried again.
  const pretend = { ...BUILD, instructions: "" };
  office.setDuties([pretend]);
  await office.syncDuties({ duties: [pretend], day: TODAY, due: [], dayOf });
  clock.advance(30_000);
  await settle();
  expect(prompts).toEqual([expect.stringContaining("b: The office assigned you duty p1")]);
  expect(store.current().posts[0]).not.toHaveProperty("pickupMessageId");
  const update = office.tools.find((tool) => tool.name === "office_update");
  expect(
    await update?.execute({ id: "p1", action: "done" }, toolContext({ id: "b", title: null })),
  ).not.toHaveProperty("isError");
  await office.post({ board: "lobby", kind: "task", text: "Next" });
  clock.advance(0);
  await settle();
  expect(prompts[1]).toContain("b: The office assigned you lobby task");
  await office.stop();
});

test("a pickup by an agent with a workspace puts the task on its board, and its completion line finishes both", async () => {
  const { build, clock, store, prompts, hub } = setup();
  const office = build({ workspaceOf: async (id) => (id === "b" ? "w2" : null) });
  await office.ready;
  office.setPickupEnabled(true);
  await office.post({ board: "lobby", kind: "task", text: "Check the notes" });
  clock.advance(0);
  await settle();
  expect(store.current().posts).toEqual([
    expect.objectContaining({ id: "p1", board: "lobby", state: "claimed", link: "p3" }),
    expect.objectContaining({
      id: "p3",
      board: "w2",
      state: "claimed",
      claimedBy: "b",
      link: "p1",
    }),
  ]);
  expect(hub.events).toContain("board w2 1");
  const line = "Completed office task p1 (assignment 2).";
  expect(prompts[0]).toContain(line);
  await office.checkCompletion("b", async () => line);
  expect(store.current().posts.map((p) => p.state)).toEqual(["done", "done"]);
  await office.stop();
});

test("the user's reopen of a lobby task deletes its copy", async () => {
  const { build, clock, store } = setup();
  const office = build({ workspaceOf: async () => "w2" });
  await office.ready;
  office.setPickupEnabled(true);
  await office.post({ board: "lobby", kind: "task", text: "Check the notes" });
  clock.advance(0);
  await settle();
  office.setPickupEnabled(false);
  expect(await office.update({ id: "p3", action: "reopen" })).toMatchObject({
    ok: true,
    post: { id: "p1", state: "open" },
  });
  expect(store.current().posts).toEqual([expect.not.objectContaining({ link: expect.anything() })]);
  await office.stop();
});

test("a named lobby assignment reaches only its recipient and completion checks both boards", async () => {
  const { build, clock, targets, store, prompts } = setup();
  const office = build({ workspaceOf: async () => "w1" });
  await office.ready;
  targets.set("c", "wakeable");
  targets.set("b", "busy");
  await office.post({ board: "lobby", kind: "task", text: "Customize the avatar", to: "b" });
  clock.advance(0);
  await settle();
  expect(prompts).toEqual([]);
  targets.set("b", "wakeable");
  office.turnEnded("b");
  clock.advance(0);
  await settle();
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("b: The office assigned you lobby task p1");
  expect(prompts[0]).toContain("Completed office task p1 (assignment 2).");
  await office.checkCompletion("b", async () => "I still need input");
  expect(store.current().posts.map((post) => post.state)).toEqual(["claimed", "claimed"]);
  await office.checkCompletion("b", async () => "Completed office task p1 (assignment 2).");
  expect(store.current().posts.map((post) => post.state)).toEqual(["done", "done"]);
  await office.stop();
});

test("a duty handed to an agent with a workspace gets no copy there; a task named for it waits for the duty", async () => {
  const { build, clock, store, prompts } = setup();
  const office = build({ workspaceOf: async (id) => (id === "b" ? "w2" : null) });
  await office.ready;
  office.setDuties([BUILD]);
  await office.syncDuties({ duties: [BUILD], day: TODAY, due: [BUILD], dayOf });
  office.setPickupEnabled(true);
  clock.advance(0);
  await settle();
  expect(prompts).toEqual([
    expect.stringContaining("b: The office assigned you duty p1 from the duty board."),
  ]);
  expect(store.current().posts).toEqual([
    expect.objectContaining({ id: "p1", board: "duty", state: "claimed", claimedBy: "b" }),
  ]);
  expect(store.current().posts[0]).not.toHaveProperty("link");
  await office.post({ board: "lobby", kind: "task", text: "Customize the avatar", to: "b" });
  office.turnEnded("b");
  clock.advance(0);
  await settle();
  expect(prompts).toHaveLength(1);
  await office.checkCompletion("b", async () => "Completed office task p1 (assignment 2).");
  office.turnEnded("b");
  clock.advance(0);
  await settle();
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain("b: The office assigned you lobby task p3 from the user.");
  expect(prompts[1]).toContain("Completed office task p3 (assignment 5).");
  expect(store.current().posts).toEqual([
    expect.objectContaining({ id: "p1", board: "duty", state: "done", claimedBy: "b" }),
    expect.objectContaining({ id: "p3", board: "lobby", state: "claimed", link: "p6" }),
    expect.objectContaining({ id: "p6", board: "w2", state: "claimed", link: "p3" }),
  ]);
  expect(store.current().posts[0]).not.toHaveProperty("link");
  await office.stop();
});

test("a user's reply to a claimed task wakes its holder with a reply prompt, and names no pickup", async () => {
  const claimed: Post = {
    id: "p1",
    seq: 1,
    board: "lobby",
    kind: "task",
    text: "Fix it",
    author: "user",
    state: "claimed",
    claimedBy: "b",
    createdAt: "2026-11-11T08:00:00.000Z",
    updatedAt: "2026-11-11T08:00:00.000Z",
  };
  const { office, store, prompts } = start({
    version: 1,
    nextSeq: 2,
    wakesPaused: false,
    posts: [claimed],
  });
  await office.ready;
  const reply = await office.post({
    board: "lobby",
    kind: "note",
    text: "Which one?",
    replyTo: "p1",
  });
  expect(reply).toMatchObject({ ok: true, post: { kind: "note", replyTo: "p1", to: "b" } });
  expect(store.current().posts[1]).not.toHaveProperty("namedPickup");
  await settle();
  expect(prompts).toEqual([
    "b: Office board: 1 post(s) for you.\n- Reply to task p1 from the user: Which one?",
  ]);
  await office.stop();
});

test("a reply to a duty is taken on the duty board, while an ordinary post there is refused", async () => {
  const { office } = start();
  await office.ready;
  office.setDuties([BUILD]);
  await office.syncDuties({ duties: [BUILD], day: TODAY, due: [BUILD], dayOf });
  expect(await office.post({ board: "duty", kind: "note", text: "hi" })).toMatchObject({
    ok: false,
  });
  expect(
    await office.post({ board: "duty", kind: "note", text: "hi", replyTo: "p1" }),
  ).toMatchObject({ ok: true, post: { board: "duty", replyTo: "p1" } });
  await office.stop();
});

test("a completion line keeps the reply's text before it as the task's result", async () => {
  const { office, clock, store } = start();
  await office.ready;
  office.setPickupEnabled(true);
  await office.post({ board: "lobby", kind: "task", text: "Check the notes" });
  clock.advance(0);
  await settle();
  await office.checkCompletion(
    "b",
    async () => "  All checked, two typos fixed.\n\nCompleted office task p1 (assignment 2).",
  );
  expect(store.current().posts[0]).toMatchObject({
    state: "done",
    result: "All checked, two typos fixed.",
  });
  await office.post({ board: "lobby", kind: "task", text: "Again" });
  clock.advance(0);
  await settle();
  await office.checkCompletion("b", async () => "Completed office task p4 (assignment 5).");
  expect(store.current().posts[1]).toMatchObject({ state: "done" });
  expect(store.current().posts[1]).not.toHaveProperty("result");
  await office.stop();
});
