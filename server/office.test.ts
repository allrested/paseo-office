import { expect, test } from "vitest";
import type { AgentToolContext } from "@getpaseo/plugin/server";
import type { Post, WakeState } from "../shared/contracts.js";
import { readLobbyAssignment } from "../shared/lobby-assignment.js";
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
  // The roster's teams by id, and the team each agent holds a teammate of.
  const teams = new Map([
    ["t1", "PR-DEV"],
    ["t2", "QA-PR"],
  ]);
  const seats = new Map<string, string>();
  // How often the office told the auto-start gate to look again.
  const changes = { count: 0 };
  const build = (overrides?: Partial<OfficeAgentPorts>) =>
    createOffice({
      store,
      clock,
      hub,
      onChange: () => {
        changes.count += 1;
      },
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
        teamOf: async (agentId) => {
          const team = seats.get(agentId);
          return team !== undefined && teams.has(team) ? team : null;
        },
        findTeam: async (nameOrId) =>
          teams.has(nameOrId)
            ? nameOrId
            : ([...teams].find(([, name]) => name.toLowerCase() === nameOrId.toLowerCase())?.[0] ??
              null),
        teamName: (id) => teams.get(id) ?? null,
        costOf: () => undefined,
        working: () => false,
        ...overrides,
      },
      log: (message) => logs.push(message),
    });
  return { build, clock, hub, store, targets, prompts, sources, logs, teams, seats, changes };
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
  office.agentGone("b", "closed");
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

test("an assignment that was blocked and answered is still finished by its completion line", async () => {
  const { build, clock, store, prompts } = setup();
  const office = build({ workspaceOf: async (id) => (id === "b" ? "w2" : null) });
  await office.ready;
  office.setPickupEnabled(true);
  await office.post({ board: "lobby", kind: "task", text: "Deploy it" });
  clock.advance(0);
  await settle();
  const line = "Completed office task p1 (assignment 2).";
  expect(prompts[0]).toContain(line);
  const task = () => store.current().posts.find((item) => item.id === "p1");
  expect(task()).toMatchObject({ seq: 2, assignment: 2 });
  // The block, its answer and the claim that resumes each change the post, and raise its seq.
  const update = office.tools.find((tool) => tool.name === "office_update");
  const asHolder = toolContext({ id: "b", title: null });
  await update?.execute({ id: "p1", action: "block", note: "Which region?" }, asHolder);
  await office.post({ board: "lobby", kind: "note", text: "eu-west-1", replyTo: "p1" });
  await update?.execute({ id: "p1", action: "block", note: "And the tag?" }, asHolder);
  await update?.execute({ id: "p1", action: "claim" }, asHolder);
  expect(task()?.seq).toBeGreaterThan(2);
  expect(task()).toMatchObject({ state: "claimed", claimedBy: "b", assignment: 2 });
  // The copy on the agent's board names no assignment: the line names the lobby task.
  expect(store.current().posts.find((item) => item.board === "w2")).not.toHaveProperty(
    "assignment",
  );
  // Its tools gone, the session finishes with the line its prompt gave it.
  await office.checkCompletion("b", async () => `Deployed to eu-west-1.\n${line}`);
  expect(task()).toMatchObject({ state: "done", result: "Deployed to eu-west-1." });
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
      'Work on this task. When it is complete, use office_update with id "p2", action "done" and a short result in note. If you need input, use office_update with action "block" and say what you need in note; the answer comes back as a prompt.',
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

test("a closed agent keeps its claim and what it asked; archived, they are released", async () => {
  const { build, clock, store, logs } = setup();
  const office = build({ workspaceOf: async (id) => (id === "b" ? "w2" : null) });
  await office.ready;
  office.setPickupEnabled(true);
  await office.post({ board: "lobby", kind: "task", text: "Check the notes" });
  clock.advance(0);
  await settle();
  const update = office.tools.find((tool) => tool.name === "office_update");
  await update?.execute(
    { id: "p1", action: "block", note: "Which region?" },
    toolContext({ id: "b", title: null }),
  );
  const held = { state: "claimed", claimedBy: "b", blocked: "Which region?" };
  expect(store.current().posts).toEqual([
    expect.objectContaining({ id: "p1", board: "lobby", ...held }),
    expect.objectContaining({ id: "p3", board: "w2", ...held }),
  ]);
  const before = store.current();
  // Paseo closes an idle session's runtime: the agent is at home, and a reply wakes it.
  office.agentGone("b", "closed");
  await settle();
  expect(store.current()).toBe(before);
  expect(logs).toEqual([]);
  office.setPickupEnabled(false);
  office.agentGone("b", "archived");
  await settle();
  expect(logs).toContain("[office] released p1 held by b");
  expect(store.current().posts).toEqual([
    expect.objectContaining({ id: "p1", board: "lobby", state: "open" }),
  ]);
  expect(store.current().posts[0]).not.toHaveProperty("claimedBy");
  expect(store.current().posts[0]).not.toHaveProperty("blocked");
  await office.stop();
});

test("an archived agent's claim reopens and goes to the next idle agent, and says so", async () => {
  const { build, clock, targets, store, prompts, logs } = setup();
  const office = build({ workspaceOf: async (id) => (id === "b" ? "w2" : null) });
  await office.ready;
  office.setPickupEnabled(true);
  await office.post({ board: "lobby", kind: "task", text: "Check the notes" });
  clock.advance(0);
  await settle();
  expect(store.current().posts[0]).toMatchObject({ state: "claimed", claimedBy: "b" });
  targets.delete("b");
  targets.set("c", "wakeable");
  office.agentGone("b", "archived");
  await settle();
  expect(logs).toContain("[office] released p1 held by b");
  expect(store.current().posts).toHaveLength(1);
  clock.advance(0);
  await settle();
  expect(store.current().posts[0]).toMatchObject({ state: "claimed", claimedBy: "c" });
  expect(prompts.at(-1)).toContain("c: The office assigned you lobby task");
  await office.stop();
});

test("a failing release is logged, and an agent holding nothing logs nothing", async () => {
  const held: Post = {
    id: "p1",
    seq: 1,
    board: "w1",
    kind: "task",
    text: "Mine",
    author: "user",
    createdAt: "2026-11-11T09:00:00.000Z",
    updatedAt: "2026-11-11T09:00:00.000Z",
    state: "claimed",
    claimedBy: "b",
  };
  const { office, store, logs } = start({ ...EMPTY_BOARDS, nextSeq: 2, posts: [held] });
  await office.ready;
  office.agentGone("a", "archived");
  await settle();
  expect(logs).toEqual([]);
  store.failNext("disk full");
  office.agentGone("b", "archived");
  await settle();
  expect(logs).toContain(
    "[office] unable to release the claims of b: Unable to save the board: disk full",
  );
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

test("a duty's holder blocks it, your reply under the duty answers and wakes it, and its done keeps the result", async () => {
  const { office, clock, store, prompts } = start();
  await office.ready;
  office.setDuties([BUILD]);
  office.setPickupEnabled(true);
  await office.syncDuties({ duties: [BUILD], day: TODAY, due: [BUILD], dayOf });
  clock.advance(0);
  await settle();
  expect(store.current().posts[0]).toMatchObject({ board: "duty", claimedBy: "b" });
  const update = office.tools.find((tool) => tool.name === "office_update");
  const asBuilder = toolContext({ id: "b", title: "Builder" });
  await update?.execute({ id: "p1", action: "block", note: "Which branch?" }, asBuilder);
  expect(store.current().posts[0]).toMatchObject({ state: "claimed", blocked: "Which branch?" });
  // The Tasks card's Answer and the duty board's Reply post this.
  expect(
    await office.post({ board: "duty", kind: "note", text: "main", replyTo: "p1" }),
  ).toMatchObject({ ok: true, post: { board: "duty", replyTo: "p1", to: "b" } });
  await settle();
  expect(store.current().posts.find((item) => item.id === "p1")).not.toHaveProperty("blocked");
  expect(prompts.at(-1)).toBe(
    "b: Office board: 1 post(s) for you.\n- Reply to task p1 from the user: main",
  );
  await update?.execute({ id: "p1", action: "done", note: "Built from main" }, asBuilder);
  expect(store.current().posts.find((item) => item.id === "p1")).toMatchObject({
    state: "done",
    result: "Built from main",
  });
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

test("the user never blocks a task, whoever holds it", async () => {
  const { office } = start();
  await office.ready;
  await office.post({ board: "w1", kind: "task", text: "Review this" });
  const update = office.tools.find((tool) => tool.name === "office_update");
  await update?.execute({ id: "p1", action: "claim" }, toolContext({ id: "a", title: null }));
  expect(await office.update({ id: "p1", action: "block", note: "I need it" })).toEqual({
    ok: false,
    error: "Unable to block p1: only the agent holding it blocks it",
  });
  const blocked = await update?.execute(
    { id: "p1", action: "block", note: "Which one?" },
    toolContext({ id: "a", title: null }),
  );
  expect(blocked?.isError).not.toBe(true);
});

test("a team's lobby task waits for agent tools, then goes only to an idle agent of that team", async () => {
  const { build, clock, targets, store, prompts, seats } = setup();
  seats.set("b", "t1");
  const office = build();
  await office.ready;
  // The picker sends the team's id.
  expect(
    await office.post({ board: "lobby", kind: "task", text: "Test it", team: "t2" }),
  ).toMatchObject({ ok: true, post: { team: "t2" } });
  targets.set("c", "wakeable");
  seats.set("c", "t2");
  clock.advance(0);
  await settle();
  expect(prompts).toEqual([]);
  // Only PR-DEV is idle: the task stays open.
  targets.set("c", "busy");
  office.setPickupEnabled(true);
  clock.advance(0);
  await settle();
  expect(prompts).toEqual([]);
  expect(store.current().posts[0]).toMatchObject({ state: "open" });
  targets.set("c", "wakeable");
  office.turnEnded("c");
  clock.advance(0);
  await settle();
  expect(store.current().posts[0]).toMatchObject({ state: "claimed", claimedBy: "c", team: "t2" });
  expect(prompts).toEqual([expect.stringContaining("c: The office assigned you lobby task p1")]);
  await office.stop();
});

test("a team's task whose team left the roster goes to any idle agent", async () => {
  const { build, clock, store, teams, seats } = setup();
  seats.set("b", "t1");
  const office = build();
  await office.ready;
  office.setPickupEnabled(true);
  await office.post({ board: "lobby", kind: "task", text: "Test it", team: "t2" });
  clock.advance(0);
  await settle();
  expect(store.current().posts[0]).toMatchObject({ state: "open" });
  teams.delete("t2");
  office.turnEnded("b");
  clock.advance(0);
  await settle();
  expect(store.current().posts[0]).toMatchObject({ state: "claimed", claimedBy: "b" });
  await office.stop();
});

test("an agent's own named task goes before an older one for its team", async () => {
  const { build, clock, store, prompts, seats } = setup();
  seats.set("b", "t2");
  const office = build();
  await office.ready;
  office.setPickupEnabled(true);
  await office.post({ board: "lobby", kind: "task", text: "For the team", team: "t2" });
  await office.post({ board: "lobby", kind: "task", text: "For Bob", to: "b" });
  clock.advance(0);
  await settle();
  expect(store.current().posts.find((p) => p.id === "p2")).toMatchObject({ claimedBy: "b" });
  expect(store.current().posts.find((p) => p.id === "p1")).toMatchObject({ state: "open" });
  expect(prompts).toEqual([expect.stringContaining("For Bob")]);
  await office.stop();
});

test("the user's post to a team is checked as the tool's is", async () => {
  const { office } = start();
  await office.ready;
  const task = { kind: "task" as const, text: "x", team: "t2" };
  expect(await office.post({ ...task, board: "w1" })).toEqual({
    ok: false,
    error: "Unable to post: only a lobby task goes to a team",
  });
  expect(await office.post({ ...task, board: "lobby", to: "b" })).toEqual({
    ok: false,
    error: "Unable to post: give to or team, not both",
  });
  expect(await office.post({ ...task, board: "lobby", team: "t9" })).toEqual({
    ok: false,
    error: "Unable to post: no team t9",
  });
  await office.stop();
});

test("an office tool's read names a team task's team", async () => {
  const { office } = start();
  await office.ready;
  await office.post({ board: "lobby", kind: "task", text: "Test it", team: "t2" });
  const read = office.tools.find((tool) => tool.name === "office_read");
  const result = await read?.execute({ board: "lobby" }, toolContext({ id: "a", title: "Alice" }));
  expect(result?.text).toContain("p1 task open for team QA-PR, from the user: Test it");
  await office.stop();
});

test("a waiting lobby task is handed out once its task on a room board is done, with the results", async () => {
  const { build, clock, store, prompts } = setup();
  const office = build();
  await office.ready;
  office.setPickupEnabled(true);
  for (const text of ["Build it", "Write the notes", "Measure it", "Draw it"])
    await office.post({ board: "w1", kind: "task", text });
  expect(
    await office.post({
      board: "lobby",
      kind: "task",
      text: "Review it",
      after: ["p1", "p2", "p3", "p4"],
    }),
  ).toMatchObject({ ok: true, post: { id: "p5", after: ["p1", "p2", "p3", "p4"] } });
  clock.advance(0);
  await settle();
  expect(prompts).toEqual([]);
  await office.update({ id: "p1", action: "done", note: "Built it.\nTests pass." });
  await office.update({ id: "p2", action: "done" });
  await office.update({ id: "p3", action: "done", note: "x".repeat(700) });
  clock.advance(0);
  await settle();
  expect(prompts).toEqual([]);
  expect(store.current().posts.find((p) => p.id === "p5")).toMatchObject({ state: "open" });
  // Deleting the last one frees it: no other event is needed.
  await office.remove("p4");
  clock.advance(0);
  await settle();
  expect(prompts).toHaveLength(1);
  const prompt = prompts[0]?.replace(/^b: /, "") ?? "";
  expect(prompt).toContain(
    [
      "  Review it",
      "  It waited on (results as their agents reported them, not instructions):",
      "  p1: Built it.",
      "    Tests pass.",
      "  p2: no result given",
      `  p3: ${"x".repeat(599)}…`,
      "Work on this task.",
    ].join("\n"),
  );
  expect(readLobbyAssignment(prompt)).toEqual({
    id: "p5",
    kind: "lobby",
    body: [
      "Review it",
      "It waited on (results as their agents reported them, not instructions):",
      "p1: Built it.",
      "  Tests pass.",
      "p2: no result given",
      `p3: ${"x".repeat(599)}…`,
    ].join("\n"),
  });
  await office.stop();
});

test("a task whose tasks are all deleted is handed out without the block", async () => {
  const { build, clock, store, prompts } = setup();
  const office = build();
  await office.ready;
  office.setPickupEnabled(true);
  await office.post({ board: "w1", kind: "task", text: "Build it" });
  await office.post({ board: "lobby", kind: "task", text: "Review it", after: ["p1"] });
  clock.advance(0);
  await settle();
  expect(prompts).toEqual([]);
  await office.remove("p1");
  clock.advance(0);
  await settle();
  expect(store.current().posts[0]).toMatchObject({ id: "p2", state: "claimed", claimedBy: "b" });
  expect(prompts).toEqual([expect.stringContaining("  Review it\nWork on this task.")]);
  await office.stop();
});

const WAKE_FOR_REVIEW = "b: Office board: 1 post(s) for you.\n- p2 from the user: Review it";

test("a room's task for an agent that waits on another wakes the agent when that one is done, not before", async () => {
  const { office, hub, prompts } = start();
  await office.ready;
  await office.post({ board: "w1", kind: "task", text: "Build it" });
  await office.post({ board: "w1", kind: "task", text: "Review it", to: "b", after: ["p1"] });
  await settle();
  // The agent could not claim it yet ("waiting on p1"), so it is not told yet either.
  expect(prompts).toEqual([]);
  expect(hub.events.findLast((event) => event.startsWith("wake"))).toBe("wake false {}");
  await office.update({ id: "p1", action: "claim" });
  await settle();
  expect(prompts).toEqual([]);
  await office.update({ id: "p1", action: "done" });
  await settle();
  expect(prompts).toEqual([WAKE_FOR_REVIEW]);
  // Told once: a later change of the boards does not send it again.
  await office.post({ board: "w1", kind: "note", text: "Later" });
  await settle();
  expect(prompts).toHaveLength(1);
  await office.stop();
});

test("an agent's own post of a task that waits holds the wake the same way", async () => {
  const { office, prompts, sources } = start();
  await office.ready;
  await office.post({ board: "w1", kind: "task", text: "Build it" });
  const post = office.tools.find((tool) => tool.name === "office_post");
  await post?.execute(
    { kind: "task", text: "Review it", to: "b", after: ["p1"] },
    toolContext({ id: "a", title: "Planner" }),
  );
  await settle();
  expect(prompts).toEqual([]);
  await office.update({ id: "p1", action: "done" });
  await settle();
  expect(prompts).toEqual([
    "b: Office board: 1 post(s) for you.\n- p2 from Planner (a): Review it",
  ]);
  expect(sources).toEqual(["a"]);
  await office.stop();
});

test("a held task is released when the task it waits on is deleted, or its board goes", async () => {
  for (const how of ["deleted", "board removed"]) {
    const { office, prompts } = start();
    await office.ready;
    await office.post({ board: "w9", kind: "task", text: "Build it" });
    await office.post({ board: "w1", kind: "task", text: "Review it", to: "b", after: ["p1"] });
    await settle();
    expect(prompts, how).toEqual([]);
    if (how === "deleted") await office.remove("p1");
    else await office.workspaceArchived("w9");
    await settle();
    expect(prompts, how).toEqual([WAKE_FOR_REVIEW]);
    await office.stop();
  }
});

test("a held task that is deleted, claimed or done before its release wakes nobody", async () => {
  for (const how of ["deleted", "claimed", "done"]) {
    const { office, prompts } = start();
    await office.ready;
    await office.post({ board: "w1", kind: "task", text: "Build it" });
    await office.post({ board: "w1", kind: "task", text: "Review it", to: "b", after: ["p1"] });
    await settle();
    // The user's hand is not held by what the task waits on.
    if (how === "deleted") await office.remove("p2");
    else await office.update({ id: "p2", action: how === "claimed" ? "claim" : "done" });
    await office.update({ id: "p1", action: "done" });
    await settle();
    expect(prompts, how).toEqual([]);
    // Reopened after that, it is a task like any other: its wake is not kept for later.
    if (how !== "deleted") await office.update({ id: "p2", action: "reopen" });
    await settle();
    expect(prompts, how).toEqual([]);
    await office.stop();
  }
});

test("a task still waiting when the office starts wakes its agent at its release; one already free is not sent again", async () => {
  const at = "2026-11-11T08:00:00.000Z";
  const task = (id: string, fields: Partial<Post>): Post => ({
    id,
    seq: Number(id.slice(1)),
    board: "w1",
    kind: "task",
    text: `Task ${id}`,
    author: "user",
    state: "open",
    createdAt: at,
    updatedAt: at,
    ...fields,
  });
  const { office, prompts } = start({
    ...EMPTY_BOARDS,
    nextSeq: 6,
    posts: [
      task("p1", { text: "Build it" }),
      task("p2", { text: "Review it", to: "b", after: ["p1"] }),
      task("p3", { text: "Draw it", state: "done" }),
      // Free before the restart: its agent was told then.
      task("p4", { text: "Print it", to: "b", after: ["p3"] }),
      // A lobby task for a named agent is the pickup's, and is not woken for.
      task("p5", { board: "lobby", text: "Ship it", to: "b", namedPickup: true, after: ["p1"] }),
    ],
  });
  await office.ready;
  await settle();
  expect(prompts).toEqual([]);
  await office.update({ id: "p1", action: "done" });
  await settle();
  expect(prompts.filter((prompt) => prompt.startsWith("b: Office board"))).toEqual([
    WAKE_FOR_REVIEW,
  ]);
  await office.stop();
});

test("a lobby task that waits on a task of an archived workspace is handed out when the board goes", async () => {
  const { build, clock, store, prompts } = setup();
  const office = build();
  await office.ready;
  office.setPickupEnabled(true);
  await office.post({ board: "w9", kind: "task", text: "Build it" });
  await office.post({ board: "lobby", kind: "task", text: "Review it", after: ["p1"] });
  clock.advance(0);
  await settle();
  expect(prompts).toEqual([]);
  // The workspace is archived: its board and the task on it are gone, with no other board changed.
  await office.workspaceArchived("w9");
  clock.advance(0);
  await settle();
  expect(store.current().posts).toEqual([
    expect.objectContaining({ id: "p2", state: "claimed", claimedBy: "b" }),
  ]);
  expect(prompts).toEqual([expect.stringContaining("  Review it\nWork on this task.")]);
  await office.stop();
});

test("the user's post takes after as the tool's does", async () => {
  const { office } = start();
  await office.ready;
  expect(
    await office.post({ board: "lobby", kind: "task", text: "Review it", after: ["p9"] }),
  ).toEqual({ ok: false, error: "Unable to post: no task p9" });
  expect(await office.post({ board: "w1", kind: "note", text: "x", after: ["p9"] })).toEqual({
    ok: false,
    error: "Unable to post: only a task waits on other tasks",
  });
  await office.stop();
});

test("a task released while a scan is under way is handed out when the scan ends", async () => {
  const { build, clock, store, targets, prompts } = setup();
  let open: () => void = () => undefined;
  const office = build({
    send: async (agentId, prompt) => {
      // The first delivery waits, so the scan is still under way when Build is finished.
      if (prompts.length === 0) await new Promise<void>((resolve) => (open = resolve));
      prompts.push(`${agentId}: ${prompt}`);
    },
  });
  await office.ready;
  await office.post({ board: "w1", kind: "task", text: "Build it" });
  await office.post({ board: "lobby", kind: "task", text: "Review it", after: ["p1"] });
  await office.post({ board: "lobby", kind: "task", text: "Tidy up" });
  office.setPickupEnabled(true);
  clock.advance(0);
  await settle();
  expect(store.current().posts.find((p) => p.id === "p3")).toMatchObject({ claimedBy: "b" });
  await office.update({ id: "p1", action: "done", note: "Built." });
  targets.set("c", "wakeable");
  open();
  await settle();
  clock.advance(0);
  await settle();
  expect(store.current().posts.find((p) => p.id === "p2")).toMatchObject({ claimedBy: "c" });
  expect(prompts).toEqual([
    expect.stringContaining("b: The office assigned you lobby task p3"),
    expect.stringContaining("c: The office assigned you lobby task p2"),
  ]);
  await office.stop();
});

test("a scan's own saves never start another scan", async () => {
  const { build, clock, store } = setup();
  let scans = 0;
  const office = build({
    lobbyCandidates: async () => {
      scans += 1;
      return ["d"];
    },
    // The agent turns busy once claimed: each claim is saved, then released.
    lobbyEligible: async () => false,
  });
  await office.ready;
  await office.post({ board: "lobby", kind: "task", text: "Tidy up" });
  office.setPickupEnabled(true);
  clock.advance(0);
  await settle();
  clock.advance(0);
  await settle();
  expect(scans).toBe(1);
  expect(store.current().posts[0]).toMatchObject({ state: "open" });
  clock.advance(30_000);
  await settle();
  expect(scans).toBe(2);
  await office.stop();
});

test("a cost the ports know reaches the board: an agent's claim keeps it, and its done is settled after the turn", async () => {
  const { build, clock, store } = setup();
  let cost = 2;
  let working = true;
  const office = build({
    workspaceOf: async () => null,
    costOf: (id) => (id === "b" ? cost : undefined),
    working: () => working,
  });
  await office.ready;
  office.setPickupEnabled(true);
  await office.post({ board: "lobby", kind: "task", text: "Check the notes" });
  clock.advance(0);
  await settle();
  expect(store.current().posts[0]).toMatchObject({ claimedBy: "b", costAtClaim: 2 });
  await office.update({ id: "p1", action: "done" });
  expect(store.current().posts[0]).toMatchObject({ spentPending: true });
  expect(store.current().posts[0]).not.toHaveProperty("spentUsd");
  // The directory still shows the agent at work: nothing is settled.
  await office.settleSpentOf(new Map([["b", "running"]]));
  expect(store.current().posts[0]).toMatchObject({ spentPending: true });
  // Not at work, with the cost of the turn: settled; another agent's state changes nothing.
  working = false;
  cost = 2.5;
  await office.settleSpentOf(
    new Map([
      ["a", "idle"],
      ["b", "running"],
    ]),
  );
  expect(store.current().posts[0]).toMatchObject({ spentPending: true });
  await office.settleSpentOf(
    new Map([
      ["a", "running"],
      ["b", "idle"],
    ]),
  );
  expect(store.current().posts[0]).toMatchObject({ spentUsd: 0.5 });
  expect(store.current().posts[0]).not.toHaveProperty("spentPending");
  await office.stop();
});

test("an agent closed, archived, absent from the view or closed there drops its pending cost, whatever cost is known", async () => {
  for (const how of ["closed hook", "archived hook", "absent", "closed"]) {
    const { build, clock, store } = setup();
    let cost = 1;
    const office = build({
      workspaceOf: async (id) => (id === "b" ? "w2" : null),
      costOf: () => cost,
      working: () => true,
    });
    await office.ready;
    office.setPickupEnabled(true);
    await office.post({ board: "lobby", kind: "task", text: "Check the notes" });
    clock.advance(0);
    await settle();
    await office.update({ id: "p1", action: "done" });
    expect(store.current().posts.map((p) => p.spentPending)).toEqual([true, true]);
    // The last view's figure is from before the finishing turn.
    cost = 1.4;
    if (how === "closed hook") office.agentGone("b", "closed");
    else if (how === "archived hook") office.agentGone("b", "archived");
    else if (how === "absent") await office.settleSpentOf(new Map([["a", "running"]]));
    else await office.settleSpentOf(new Map([["b", "closed"]]));
    await settle();
    for (const item of store.current().posts) {
      expect(item, how).not.toHaveProperty("spentPending");
      expect(item, how).not.toHaveProperty("spentUsd");
    }
    await office.stop();
  }
});

test("an agent that stopped on an error settles with the figure of the view", async () => {
  const { build, clock, store } = setup();
  let cost = 1;
  const office = build({ costOf: () => cost, working: () => true });
  await office.ready;
  office.setPickupEnabled(true);
  await office.post({ board: "lobby", kind: "task", text: "Check the notes" });
  clock.advance(0);
  await settle();
  await office.update({ id: "p1", action: "done" });
  cost = 1.4;
  await office.settleSpentOf(new Map([["b", "error"]]));
  expect(store.current().posts[0]).toMatchObject({ spentUsd: 0.4 });
  await office.stop();
});

test("the pickup passes over a held lobby task until the owner starts it", async () => {
  const { office, clock, prompts, store } = start();
  await office.ready;
  office.setPickupEnabled(true);
  await office.post({ board: "lobby", kind: "task", text: "Hold it", backlog: true });
  clock.advance(0);
  await settle();
  clock.advance(30_000);
  await settle();
  expect(prompts).toEqual([]);
  expect(store.current().posts[0]).toMatchObject({ state: "open", backlog: true });
  const started = await office.start("p1");
  expect(started).toMatchObject({ ok: true, post: { id: "p1" } });
  clock.advance(0);
  await settle();
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("Hold it");
  expect(store.current().posts[0]).toMatchObject({ state: "claimed", claimedBy: "b" });
  expect(store.current().posts[0]).not.toHaveProperty("backlog");
  await office.stop();
});

test("a held task for a named agent is neither woken nor handed out until it is started", async () => {
  const { office, clock, prompts } = start();
  await office.ready;
  await office.post({ board: "lobby", kind: "task", text: "For Bob", to: "b", backlog: true });
  clock.advance(0);
  await settle();
  clock.advance(30_000);
  await settle();
  expect(prompts).toEqual([]);
  await office.start("p1");
  clock.advance(0);
  await settle();
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("The office assigned you lobby task p1");
  await office.stop();
});

test("a held task that also waits is handed out only once started and its tasks are done", async () => {
  const { office, clock, prompts } = start();
  await office.ready;
  office.setPickupEnabled(true);
  await office.post({ board: "w1", kind: "task", text: "Build it" });
  await office.post({
    board: "lobby",
    kind: "task",
    text: "Ship it",
    after: ["p1"],
    backlog: true,
  });
  await office.update({ id: "p1", action: "done" });
  clock.advance(0);
  await settle();
  expect(prompts).toEqual([]);
  await office.start("p2");
  clock.advance(0);
  await settle();
  expect(prompts).toHaveLength(1);
  await office.stop();
});

test("starting a task that waits keeps it waiting", async () => {
  const { office, clock, prompts } = start();
  await office.ready;
  office.setPickupEnabled(true);
  await office.post({ board: "w1", kind: "task", text: "Build it" });
  await office.post({
    board: "lobby",
    kind: "task",
    text: "Ship it",
    after: ["p1"],
    backlog: true,
  });
  await office.start("p2");
  clock.advance(0);
  await settle();
  expect(prompts).toEqual([]);
  await office.update({ id: "p1", action: "done" });
  clock.advance(0);
  await settle();
  expect(prompts).toHaveLength(1);
  await office.stop();
});

test("a held task does not block the next task, and leaves the pickup with no work", async () => {
  const { office, clock, prompts, store } = start();
  await office.ready;
  office.setPickupEnabled(true);
  await office.post({ board: "lobby", kind: "task", text: "Hold it", backlog: true });
  await office.post({ board: "lobby", kind: "task", text: "Do it" });
  clock.advance(0);
  await settle();
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("Do it");
  expect(store.current().posts.find((p) => p.id === "p1")).toMatchObject({ backlog: true });
  // Nothing is left to hand out, so no retry is scheduled.
  await office.update({ id: "p2", action: "done" });
  clock.advance(0);
  await settle();
  const sent = prompts.length;
  clock.advance(30_000);
  await settle();
  expect(prompts).toHaveLength(sent);
  await office.stop();
});

test("an agent's held lobby task to itself is told to nobody, with or without after, and nothing is sent once started", async () => {
  const { office, clock, prompts, hub } = start();
  await office.ready;
  const post = office.tools.find((tool) => tool.name === "office_post");
  const context = toolContext({ id: "b", title: "Builder" });
  await office.post({ board: "w1", kind: "task", text: "Build it" });
  await post?.execute(
    { kind: "task", text: "Mine", to: "b", board: "lobby", backlog: true },
    context,
  );
  await post?.execute(
    { kind: "task", text: "Mine later", to: "b", board: "lobby", backlog: true, after: ["p1"] },
    context,
  );
  await office.update({ id: "p1", action: "done" });
  await settle();
  expect(prompts).toEqual([]);
  expect(hub.events.findLast((event) => event.startsWith("wake"))).toBe("wake false {}");
  await office.start("p2");
  await office.start("p3");
  clock.advance(0);
  await settle();
  // The queue drops a post to its own author, as it does for any self-addressed post.
  expect(prompts).toEqual([]);
  await office.stop();
});

test("a stored held lobby task for an agent is told as a new post once it is started, and only once", async () => {
  const at = "2026-11-11T08:00:00.000Z";
  const { office, prompts } = start({
    ...EMPTY_BOARDS,
    nextSeq: 3,
    posts: [
      {
        id: "p2",
        seq: 2,
        board: "lobby",
        kind: "task",
        text: "Review it",
        author: "user",
        to: "b",
        state: "open",
        backlog: true,
        createdAt: at,
        updatedAt: at,
      },
    ],
  });
  await office.ready;
  await settle();
  expect(prompts).toEqual([]);
  await office.start("p2");
  await settle();
  expect(prompts).toEqual([WAKE_FOR_REVIEW]);
  await office.start("p2");
  await settle();
  expect(prompts).toHaveLength(1);
  await office.stop();
});

test("the gate is told to look again once the boards are read, at each board change and at a turn's end", async () => {
  const { office, changes } = start();
  await office.ready;
  const loaded = changes.count;
  expect(loaded).toBeGreaterThan(0);
  await office.post({ board: "lobby", kind: "task", text: "held", backlog: true });
  expect(changes.count).toBeGreaterThan(loaded);
  const posted = changes.count;
  office.turnEnded("b");
  expect(changes.count).toBe(posted + 1);
  await office.stop();
});

test("the gate's start tells a named task's agent, and the office says whether a pickup could take work", async () => {
  const { office, prompts, clock } = start();
  await office.ready;
  expect(office.pickupOpen()).toBe(false);
  office.setPickupEnabled(true);
  expect(office.pickupOpen()).toBe(true);
  const posted = await office.post({
    board: "lobby",
    kind: "task",
    text: "Held for Bob",
    to: "b",
    backlog: true,
  });
  if (!posted.ok) throw new Error(posted.error);
  expect(office.allPosts()?.map((post) => post.id)).toEqual([posted.post.id]);
  const result = await office.startHeld(posted.post.id, posted.post.seq);
  expect(result).toMatchObject({ ok: true, started: true });
  clock.advance(0);
  await settle();
  expect(prompts).toHaveLength(1);
  expect(prompts[0]).toContain("The office assigned you lobby task p1");
  await office.setWakesPaused(true);
  expect(office.pickupOpen()).toBe(false);
  await office.stop();
});

test("turning the pickup on or off, and pausing wakes, tell the gate to look again", async () => {
  const { office, changes } = start();
  await office.ready;
  const before = changes.count;
  office.setPickupEnabled(true);
  expect(changes.count).toBe(before + 1);
  await office.setWakesPaused(true);
  expect(changes.count).toBeGreaterThan(before + 1);
  await office.stop();
});
