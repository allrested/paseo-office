import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ChatChange, ChatImage, ChatMessage, OfficeAgent, Post } from "../shared/contracts.js";
import { chatT } from "../shared/chat-words.js";
import {
  CHAT_CLOCK_MS,
  GroupSessionUnavailable,
  PROMPT_PREFIX,
  RECALL_WINDOW_MS,
  clipAnswer,
  createChatService,
  isUsageLimit,
  lastAssistantText,
  mentionedIds,
  staffNameOf,
} from "./chat-service.js";
import { createChatStore, emptyChat, type ChatData, type ChatStore } from "./chat-store.js";
import { createFakeClock, settle } from "./fake-clock.js";
import type { DirectoryView } from "./hub.js";

// The engine's banter is as quiet as it gets (no automatic reactions, no chance answers), and its
// delays are the top of each range.
beforeEach(() => {
  vi.spyOn(Math, "random").mockReturnValue(0.99);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const MORNING = new Date(2026, 10, 18, 9, 0).getTime(); // a Wednesday
const WORKSPACE = { id: "w1", name: "main", projectName: "shop" };
const agent = (id: string, title: string, overrides: Partial<OfficeAgent> = {}): OfficeAgent => ({
  id,
  title,
  provider: "claude",
  model: null,
  status: "idle",
  workspaceId: "w1",
  parentAgentId: null,
  permissions: [],
  createdAt: "2026-11-18T05:00:00.000Z",
  ...overrides,
});
const view = (...agents: OfficeAgent[]): DirectoryView => ({ agents, workspaces: [WORKSPACE] });

/** A promise the test ends itself: `finish(null)` resolves it, `finish(error)` rejects it. */
function deferred() {
  let resolve = (): void => undefined;
  let reject = (_error: Error): void => undefined;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  const finish = (error: Error | null): void => {
    if (error === null) resolve();
    else reject(error);
  };
  return { promise, finish };
}

async function harness(options: { at?: number; store?: ChatStore; posts?: Post[] } = {}) {
  const clock = createFakeClock(options.at ?? MORNING);
  const sent: [string, string][] = [];
  const attachments: ChatImage[][] = [];
  const asked: string[] = [];
  const turns: (string | null)[] = [];
  const changes: ChatChange[] = [];
  const saved: ChatData[] = [];
  const logs: string[] = [];
  const answers = new Map<string, string | null>();
  const deliveredGroup = new Map<string, string>();
  const unrelatedTurns = new Set<string>();
  const privateTurns = new Set<string>();
  // `hold`: each send waits in `held` until the test finishes it. `answerGate`: a read waits for it.
  const failure = {
    send: null as Error | null,
    answer: null as Error | null,
    hold: false,
    answerGate: null as Promise<void> | null,
  };
  const held: ((error: Error | null) => void)[] = [];
  const store: ChatStore = options.store ?? {
    load: async () => emptyChat(),
    save: async (data) => {
      saved.push(structuredClone(data));
    },
  };
  const service = await createChatService({
    store,
    clock,
    tr: chatT,
    lobbyPosts: () => options.posts ?? [],
    send: async (id, prompt, images, group) => {
      if (failure.hold) {
        const wait = deferred();
        held.push(wait.finish);
        await wait.promise;
      }
      if (failure.send) throw failure.send;
      sent.push([id, prompt]);
      if (group?.group) deliveredGroup.set(id, group.messageId);
      if (images) attachments.push(images);
    },
    readTurn: async (id, turnId, group) => {
      asked.push(id);
      turns.push(turnId);
      if (failure.answerGate) await failure.answerGate;
      if (failure.answer) throw failure.answer;
      return {
        matches:
          !group || (deliveredGroup.get(id) === group.messageId && !unrelatedTurns.has(turnId!)),
        text: answers.get(id) ?? null,
        privateTurn: turnId !== null && privateTurns.has(turnId),
      };
    },
    emit: (change) => changes.push(change),
    log: (message) => logs.push(message),
  });
  return {
    service,
    clock,
    sent,
    attachments,
    asked,
    turns,
    changes,
    saved,
    logs,
    answers,
    unrelatedTurns,
    privateTurns,
    failure,
    held,
  };
}
type Harness = Awaited<ReturnType<typeof harness>>;

const messages = (h: Harness): ChatMessage[] => h.service.snapshot().messages;
const said = (h: Harness, name: string): string[] =>
  messages(h)
    .filter((message) => message.name === name)
    .map((message) => message.text);
const mine = (h: Harness): ChatMessage[] => messages(h).filter((message) => message.from === "me");
const typing = (h: Harness): string[] => h.service.snapshot().typing;
const WORK = (key: string): string[] => chatT(`chat.work.${key}`, null, "list");
/** Upstream's lines for `key` with their `{name}` parts filled, as the engine says them. */
const filled = (lines: string[], vars: Record<string, string>): string[] =>
  lines.map((line) => line.replace(/\{(\w+)\}/g, (part, name: string) => vars[name] ?? part));

async function send(h: Harness, text: string): Promise<void> {
  expect(await h.service.request({ op: "send", text })).toEqual({ ok: true });
}

/* ---------- the pure parts ---------- */

test("the seven office staff have chat names", () => {
  expect(
    ["director", "reception", "hr", "cleaner", "guard", "courier", "accountant"].map((key) =>
      staffNameOf("__" + key, chatT),
    ),
  ).toEqual([
    "Director",
    "Receptionist",
    "HR",
    "Cleaner",
    "Security guard",
    "Courier",
    "Accountant",
  ]);
  expect(staffNameOf("__claude", chatT)).toBeNull();
});

test("a usage limit is told from other errors", () => {
  expect(isUsageLimit("You've hit your usage limit. Resets at 5pm")).toBe(true);
  expect(isUsageLimit("429 rate limit exceeded")).toBe(true);
  expect(isUsageLimit("connection reset")).toBe(false);
});

test("the last assistant message is its consecutive parts joined, and none gives null", () => {
  expect(
    lastAssistantText([
      { type: "assistant_message", text: "old" },
      { type: "tool_call" },
      { type: "assistant_message", text: "All " },
      { type: "assistant_message", text: "done." },
    ]),
  ).toBe("All done.");
  expect(lastAssistantText([{ type: "tool_call" }])).toBeNull();
  expect(lastAssistantText([{ type: "assistant_message", text: "  " }])).toBeNull();
});

test("an answer over 1,200 characters is clipped with an ellipsis", () => {
  expect(clipAnswer("x".repeat(1200))).toHaveLength(1200);
  const clipped = clipAnswer("x".repeat(2000));
  expect(clipped).toHaveLength(1200);
  expect(clipped.endsWith("…")).toBe(true);
});

test("an @name prompts its member only: a longer member's name and a name character after it do not count", () => {
  const team = [
    { id: "m", name: "Mjd" },
    { id: "m1", name: "Mjd-1" },
    { id: "a", name: "Alice" },
  ];
  expect(mentionedIds("@Mjd-1 go", team)).toEqual(["m1"]);
  expect(mentionedIds("@Mjd and @Mjd-1", team)).toEqual(["m", "m1"]);
  expect(mentionedIds("@Alice, hi", team)).toEqual(["a"]);
  expect(mentionedIds("@Alicex hi", team)).toEqual([]);
  expect(mentionedIds("@Bea hi", team)).toEqual([]);
  expect(mentionedIds("@Alice @Alice", team)).toEqual(["a"]);
});

/* ---------- the service ---------- */

test("a new conversation starts with upstream's first line and says so to nobody", async () => {
  const h = await harness();
  expect(messages(h)).toEqual([
    expect.objectContaining({ kind: "sys", text: chatT("chat.sys.created") }),
  ]);
  expect(h.changes).toEqual([]);
});

test("completion questions use the lobby board and never schedule a simulated reply", async () => {
  const post: Post = {
    id: "p1",
    seq: 1,
    kind: "task",
    board: "lobby",
    author: "user",
    state: "done",
    text: "Fix the export",
    createdAt: "",
    updatedAt: "",
  };
  const h = await harness({
    posts: [post, { ...post, id: "p2", state: "claimed", text: "Still working" }],
  });
  h.service.view(view(agent("a1", "Alice")));
  await send(h, "what is done?");
  h.clock.advance(10_000);
  expect(said(h, "Director")).toEqual(["1 lobby task marked done.\np1 — Fix the export"]);
  expect(said(h, "Alice")).toEqual([]);
  expect(h.sent).toEqual([]);
});

test("board questions are answered locally and free-form follow-ups get a quoted session reply", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice"), agent("a2", "Bea")));
  await send(h, "@Director what's done?");
  expect(said(h, "Director")).toEqual(["No lobby tasks are marked done."]);
  const director = messages(h).at(-1)!;
  await h.service.request({ op: "send", text: "What is open?", replyTo: director.id });
  expect(messages(h).at(-1)).toMatchObject({
    from: "__director",
    text: "No lobby tasks are open.",
  });
  expect(h.sent).toEqual([]);
  for (const text of ["What happened at the meeting?", "I ask who is going back"]) {
    await send(h, text);
    expect(h.sent.at(-1)).toEqual(["a1", expect.stringContaining(text)]);
    expect(typing(h)).toEqual(["Alice"]);
    expect(mine(h).at(-1)).toMatchObject({ text, tag: "group" });
    h.answers.set("a1", "Pat said she was heading back.");
    await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t1");
    expect(messages(h).at(-1)).toMatchObject({
      from: "a1",
      text: "Pat said she was heading back.",
      reply: { id: mine(h).at(-1)!.id },
      tag: "group-reply",
    });
  }
  expect(h.sent).toHaveLength(2);
  expect(h.changes.filter((change) => change.op === "act")).toEqual([]);
});

test("a repeated lobby request reports its real assignment and does not duplicate the work", async () => {
  const text = "Can we integrate our two boards";
  const h = await harness({
    posts: [
      {
        id: "p34",
        seq: 34,
        board: "lobby",
        kind: "task",
        state: "claimed",
        claimedBy: "a1",
        author: "user",
        text,
        createdAt: "",
        updatedAt: "",
      },
    ],
  });
  h.service.view(view(agent("a1", "Taufik")));
  await send(h, text);
  expect(messages(h).at(-1)).toMatchObject({
    from: "__director",
    text: "Lobby task p34 is claimed by Taufik.",
    reply: { id: mine(h)[0].id },
  });
  expect(h.sent).toHaveLength(0);
});

test("only a free top-level session can answer the group, and one waiting for a reply stays reserved", async () => {
  const h = await harness();
  h.service.view(
    view(
      agent("parent", "Parent"),
      agent("child", "Child", { parentAgentId: "parent", status: "running" }),
      agent("busy", "Busy", { status: "running" }),
      agent("needs", "Needs approval", {
        permissions: [{ id: "permission", kind: "tool", title: "Run" }],
      }),
      agent("writer", "Stand-up notes"),
      agent("a1", "Alice"),
    ),
  );
  await send(h, "Hello team");
  expect(typing(h)).toEqual(["Alice"]);
  await send(h, "Anyone else around");
  expect(messages(h).at(-1)).toMatchObject({
    from: "__director",
    tag: "delivery",
    text: expect.stringContaining("No session is available"),
    reply: { id: mine(h).at(-1)!.id },
  });
  expect(h.sent.map(([id]) => id)).toEqual(["a1"]);
  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t1");
  h.service.view(null);
  await send(h, "Still there");
  expect(h.sent).toHaveLength(1);
  expect(messages(h).at(-1)?.reply?.id).toBe(mine(h).at(-1)?.id);
});

test("only a confirmed unavailable group recipient can be replaced before delivery", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice"), agent("a2", "Bea")));
  h.failure.hold = true;
  await send(h, "Who was at the office today");
  expect(typing(h)).toEqual(["Alice"]);
  h.held[0](new GroupSessionUnavailable("busy"));
  await settle();
  expect(typing(h)).toEqual(["Bea"]);
  h.held[1](null);
  await settle();
  expect(h.sent.map(([id]) => id)).toEqual(["a2"]);
  expect(said(h, "Director")).toEqual([]);
});

test("mentions and replies to an agent wait for that session's actual answer", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  await send(h, "@Alice what is done?");
  h.clock.advance(10_000);
  expect(said(h, "Alice")).toEqual([]);
  h.answers.set("a1", "The export is fixed.");
  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t1");
  h.clock.advance(10_000);
  const reply = messages(h).at(-1)!;
  expect(reply.text).toBe("The export is fixed.");
  await h.service.request({ op: "send", text: "Which export?", replyTo: reply.id });
  expect(h.sent.at(-1)).toEqual(["a1", PROMPT_PREFIX + "Which export?"]);
});

test("one message to two agents is two prompts that steer, and both show typing", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice"), agent("a2", "Bea")));
  await send(h, "@Alice @Bea look at the build");
  const PROMPT = `${PROMPT_PREFIX}@Alice @Bea look at the build`;
  expect(h.sent).toEqual([
    ["a1", PROMPT],
    ["a2", PROMPT],
  ]);
  expect(typing(h)).toEqual(["Alice", "Bea"]);
  expect(h.changes.at(-1)).toEqual({ op: "typing", names: ["Alice", "Bea"] });
});

test("a prompt names a member that is a prefix of a longer one once", async () => {
  const h = await harness();
  h.service.view(
    view(
      agent("m", "Mjd"),
      agent("m1", "Fix the login", { parentAgentId: "m", name: "Mjd-1", number: 1 }),
    ),
  );
  await send(h, "@Mjd-1 go");
  expect(h.sent).toEqual([["m1", `${PROMPT_PREFIX}@Mjd-1 go`]]);
  expect(typing(h)).toEqual(["Mjd-1"]);
});

test("choosing To sends the named session by id even when several agents share its title", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Builder"), agent("a2", "Builder")));
  const text = "Check whether @Builder already fixed the date links.";
  expect(await h.service.request({ op: "send", text, to: "a2" })).toEqual({ ok: true });
  expect(h.sent).toEqual([["a2", PROMPT_PREFIX + text]]);
  expect(mine(h)).toEqual([expect.objectContaining({ text })]);
  h.service.view(view(agent("a1", "Builder")));
  expect(await h.service.request({ op: "send", text, to: "a2" })).toMatchObject({ ok: false });
  expect(h.sent).toHaveLength(1);
  expect(mine(h)).toHaveLength(1);
});

test("an image-only prompt reaches the chosen session and the shared chat contains only its count", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Builder")));
  const images: ChatImage[] = [{ mimeType: "image/jpeg", data: "YXR0YWNobWVudA==" }];
  expect(await h.service.request({ op: "send", images })).toMatchObject({ ok: false });
  expect(h.sent).toHaveLength(0);
  expect(await h.service.request({ op: "send", images, to: "a1" })).toEqual({ ok: true });
  expect(h.attachments).toEqual([images]);
  expect(h.sent).toEqual([["a1", PROMPT_PREFIX + "1 image"]]);
  expect(mine(h)).toEqual([expect.objectContaining({ text: "1 image" })]);
  expect(JSON.stringify(h.service.snapshot())).not.toContain(images[0].data);
});

test("a custom poll pins itself, takes a vote, and another message can replace the pin", async () => {
  const h = await harness();
  expect(
    await h.service.request({
      op: "poll",
      question: "Which release?",
      options: ["Today", "Tomorrow"],
    }),
  ).toEqual({ ok: true });
  const poll = messages(h).find((m) => m.kind === "poll")!;
  expect(poll.poll?.opts.map((o) => o.t)).toEqual(["Today", "Tomorrow"]);
  expect(h.service.snapshot().pinned).toBe(poll.id);
  await h.service.request({ op: "vote", id: poll.id, index: 1 });
  expect(messages(h).find((m) => m.id === poll.id)?.poll?.opts[1].by).toEqual(["me"]);
  await send(h, "Read the changelog.");
  const message = mine(h).at(-1)!;
  expect(await h.service.request({ op: "pin", id: message.id })).toEqual({ ok: true });
  expect(h.changes.at(-1)).toMatchObject({ op: "all", pinned: message.id });
  await h.service.request({ op: "recall", id: message.id });
  expect(h.service.snapshot().pinned).toBeUndefined();
  expect(await h.service.request({ op: "pin", id: message.id })).toMatchObject({ ok: false });
  expect(await h.service.request({ op: "pin", id: "gone" })).toMatchObject({ ok: false });
});

test("a mention of an archived agent reports the missing recipient and cannot route to another session", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  await send(h, "@Alice look at this");
  h.clock.advance(10_000);
  expect(typing(h)).toEqual(["Alice"]);

  h.service.archived("a1");
  // Typing stops while she is still a member, or it would stay on for good.
  expect(typing(h)).toEqual([]);
  expect(messages(h).at(-1)).toMatchObject({
    kind: "sys",
    text: chatT("chat.sys.left", { name: "Alice" }),
  });

  h.service.view(view(agent("b", "Bea")));
  h.clock.advance(10_000); // Bea joins the office before the next message.
  const before = messages(h).length;
  await send(h, "@Alice hi");
  h.clock.advance(10_000);
  expect(h.sent).toEqual([["a1", `${PROMPT_PREFIX}@Alice look at this`]]);
  expect(messages(h).slice(before)).toEqual([
    expect.objectContaining({ from: "me", text: "@Alice hi" }),
    expect.objectContaining({
      from: "__director",
      tag: "delivery",
      reply: expect.objectContaining({ id: mine(h).at(-1)?.id }),
    }),
  ]);
  expect(typing(h)).toEqual([]);
});

test("a closed session reports the undelivered reply against the user’s message", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  h.answers.set("a1", "Never posted.");
  await send(h, "@Alice look at this");
  h.clock.advance(10_000);
  expect(typing(h)).toEqual(["Alice"]);

  h.service.closed("a1");
  expect(typing(h)).toEqual([]);
  expect(messages(h).at(-1)).toMatchObject({
    from: "__director",
    reply: { id: mine(h)[0]?.id },
    text: expect.stringContaining("session closed"),
  });
  // A closed agent's turn end never comes; one that came anyway finds nothing waiting.
  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t1");
  h.clock.advance(10_000);
  expect(h.asked).toEqual([]);
  expect(said(h, "Alice")).not.toContain("Never posted.");
  expect(typing(h)).toEqual([]);
});

test("an agent whose runtime is closed is not in the team", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice", { status: "closed" })));
  await send(h, "@Alice hi");
  h.clock.advance(10_000);
  expect(h.sent).toEqual([]);
  expect(said(h, "Alice")).toEqual([]);
});

test("when the turn ends the agent's last message is posted as a reply to your message and typing stops", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  h.answers.set("a1", "All green.");
  await send(h, "@Alice run the tests");
  const [question] = mine(h);
  expect(typing(h)).toEqual(["Alice"]);

  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t1");
  expect(h.asked).toEqual(["a1"]);
  expect(h.turns).toEqual(["t1"]);
  const answer = messages(h).find((message) => message.text === "All green.");
  expect(answer).toMatchObject({
    from: "a1",
    name: "Alice",
    reply: { id: question?.id, name: "Boss", text: "@Alice run the tests" },
  });
  expect(typing(h)).toEqual([]);
});

test("an answer is clipped and keeps its whole length up to 1,200", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice"), agent("a2", "Bea")));
  h.answers.set("a1", "x".repeat(2000));
  h.answers.set("a2", "y".repeat(1200));
  await send(h, "@Alice @Bea write it all down");
  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t1");
  await h.service.turnEnded({ id: "a2" }, { kind: "completed" }, "t2");
  const long = messages(h).find((message) => message.text.startsWith("x"));
  expect(long?.text).toBe(`${"x".repeat(1199)}…`);
  const whole = messages(h).find((message) => message.text.startsWith("y"));
  expect(whole?.text).toBe("y".repeat(1200));
});

test("a failed addressed turn quotes each unanswered prompt and stops typing", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  h.answers.set("a1", "Never posted.");
  await send(h, "@Alice run the tests");
  await send(h, "@Alice check this too");
  h.clock.advance(10_000);
  const before = messages(h).length;

  await h.service.turnEnded({ id: "a1" }, { kind: "failed", error: { message: "boom" } }, "t1");
  expect(typing(h)).toEqual([]);
  h.clock.advance(10_000);
  const after = messages(h).slice(before);
  expect(after.map((message) => message.reply?.id)).toEqual(mine(h).map((message) => message.id));
  expect(
    after.every(
      (message) => message.from === "__director" && message.text.includes("session failed"),
    ),
  ).toBe(true);
  expect(h.asked).toEqual([]);
  expect(typing(h)).toEqual([]);
});

test("a turn answering both group and directed messages stays out of subsequent group prompts", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  await send(h, "Who booked the meeting room?");
  await send(h, "@Alice please include my private agenda");
  h.answers.set("a1", "The private agenda is ready.");
  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t1");
  const reply = messages(h).find((message) => message.text === "The private agenda is ready.");
  expect(reply?.from).toBe("a1");
  expect(reply?.tag).toBeUndefined();

  h.service.view(view(agent("a1", "Alice", { status: "running" }), agent("a2", "Bea")));
  await send(h, "What time can we meet?");
  const [recipient, prompt] = h.sent.at(-1)!;
  expect(recipient).toBe("a2");
  expect(prompt).toContain("Who booked the meeting room?");
  expect(prompt).not.toContain("private agenda");
});

test("an earlier turn ending while the group request is pending cannot answer it or clear its wait", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  await send(h, "Who is coming back?");
  h.unrelatedTurns.add("old");
  h.answers.set("a1", "Unrelated workspace answer");
  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "old");
  await h.service.turnEnded(
    { id: "a1" },
    { kind: "failed", error: { message: "Old failure" } },
    "old",
  );
  expect(typing(h)).toEqual(["Alice"]);
  expect(messages(h).filter((message) => message.reply?.id === mine(h)[0].id)).toEqual([]);

  h.answers.set("a1", "Pat is coming back.");
  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "group");
  expect(messages(h).at(-1)).toMatchObject({
    text: "Pat is coming back.",
    from: "a1",
    tag: "group-reply",
    reply: { id: mine(h)[0].id },
  });
  expect(typing(h)).toEqual([]);
});

test("a group turn with a workspace steer or unreadable timeline releases the session with a quoted notice", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  await send(h, "When can we meet?");
  h.privateTurns.add("mixed");
  h.answers.set("a1", "Private workspace content");
  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "mixed");
  expect(messages(h).at(-1)).toMatchObject({
    from: "__director",
    tag: "delivery",
    text: expect.stringContaining("workspace message"),
    reply: { id: mine(h)[0].id },
  });
  expect(said(h, "Alice")).toEqual([]);
  expect(typing(h)).toEqual([]);

  await send(h, "What's the next meeting?");
  h.failure.answer = new Error("timeline unavailable");
  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "new");
  expect(messages(h).at(-1)).toMatchObject({
    tag: "delivery",
    text: expect.stringContaining("could not read"),
    reply: { id: mine(h)[1].id },
  });
  expect(typing(h)).toEqual([]);
});

test("a usage limit speaks its own line", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  await send(h, "@Alice run the tests");
  h.clock.advance(10_000);
  const before = messages(h).length;

  await h.service.turnEnded(
    { id: "a1" },
    { kind: "failed", error: { message: "You've hit your usage limit. Resets at 5pm" } },
    "t1",
  );
  h.clock.advance(10_000);
  const after = messages(h).slice(before);
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({
    from: "__director",
    reply: { id: mine(h)[0]?.id },
    text: expect.stringContaining("usage limit"),
  });
  expect(typing(h)).toEqual([]);
});

test("a canceled turn quotes the original message and stops typing", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  h.answers.set("a1", "Never posted.");
  await send(h, "@Alice run the tests");
  h.clock.advance(10_000);
  expect(typing(h)).toEqual(["Alice"]);
  const before = messages(h).length;

  await h.service.turnEnded({ id: "a1" }, { kind: "canceled", reason: "interrupted" }, "t1");
  h.clock.advance(10_000);
  expect(messages(h).slice(before)).toEqual([
    expect.objectContaining({
      from: "__director",
      reply: expect.objectContaining({ id: mine(h)[0]?.id }),
      text: expect.stringContaining("turn was canceled"),
    }),
  ]);
  expect(h.asked).toEqual([]);
  expect(typing(h)).toEqual([]);
});

test("a timeline read failure is reported against its prompt and the agent stops typing", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  h.failure.answer = new Error("timeline gone");
  await send(h, "@Alice run the tests");
  h.clock.advance(10_000);
  const before = messages(h).length;

  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t1");
  expect(h.asked).toEqual(["a1"]);
  expect(h.logs).toEqual([expect.stringContaining("timeline gone")]);
  expect(typing(h)).toEqual([]);
  h.clock.advance(10_000);
  // Report the missing answer without claiming the work is done.
  const after = messages(h).slice(before);
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({
    from: "__director",
    reply: { id: mine(h)[0]?.id },
    text: "Alice: Office could not read the session’s reply.",
  });
});

test("a prompt that cannot be sent says so and stops the typing", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  h.failure.send = new Error("agent is gone");
  await send(h, "@Alice hi");
  await settle();
  expect(messages(h).at(-1)).toMatchObject({
    from: "__director",
    reply: { id: mine(h)[0]?.id },
    text: "Alice: Message delivery failed: agent is gone.",
  });
  expect(typing(h)).toEqual([]);
  // Nothing waits for an answer any more.
  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t1");
  expect(h.asked).toEqual([]);
});

test("a prompt that cannot be sent keeps the earlier one waiting, and its answer still comes", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  h.answers.set("a1", "First is done.");
  await send(h, "@Alice first");
  const [first] = mine(h);
  // The first prompt started a turn; the second cannot steer it.
  h.failure.send = new Error("cannot steer");
  await send(h, "@Alice second");
  await settle();
  expect(messages(h).at(-1)).toMatchObject({
    from: "__director",
    reply: { id: mine(h)[1]?.id },
    text: "Alice: Message delivery failed: cannot steer.",
  });
  expect(typing(h)).toEqual(["Alice"]);

  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t1");
  const answer = messages(h).find((message) => message.text === "First is done.");
  expect(answer?.reply).toEqual({ id: first?.id, name: "Boss", text: "@Alice first" });
  expect(typing(h)).toEqual([]);
});

test("two prompts in flight that both fail leave nobody typing", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  h.failure.hold = true;
  await send(h, "@Alice A");
  await send(h, "@Alice B");
  expect(typing(h)).toEqual(["Alice"]);

  h.held[0]?.(new Error("agent is gone"));
  await settle();
  expect(typing(h)).toEqual(["Alice"]);
  h.held[1]?.(new Error("agent is gone"));
  await settle();
  expect(typing(h)).toEqual([]);
  const failures = messages(h).filter(
    (message) => message.text === "Alice: Message delivery failed: agent is gone.",
  );
  expect(failures).toHaveLength(2);
});

test("a prompt sent while an answer is read, which then fails, leaves nothing waiting", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  h.answers.set("a1", "A is done.");
  await send(h, "@Alice A");
  const [first] = mine(h);
  const read = deferred();
  h.failure.answerGate = read.promise;
  const ended = h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t1");

  h.failure.hold = true;
  await send(h, "@Alice B");
  read.finish(null);
  await ended;
  const answer = messages(h).find((message) => message.text === "A is done.");
  expect(answer?.reply).toMatchObject({ id: first?.id, text: "@Alice A" });
  // B is still on its way.
  expect(typing(h)).toEqual(["Alice"]);

  h.held[0]?.(new Error("agent is gone"));
  await settle();
  expect(typing(h)).toEqual([]);
  // Nothing waits any more: a later turn reads no answer and quotes nobody.
  h.failure.answerGate = null;
  h.answers.set("a1", "Later.");
  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t2");
  expect(h.asked).toEqual(["a1"]);
  expect(messages(h).filter((message) => message.text === "Later.")).toEqual([]);
});

test("the reply skips a prompt that fails while the turn end is being read", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  h.answers.set("a1", "Both read.");
  await send(h, "@Alice A");
  h.failure.hold = true;
  await send(h, "@Alice B");
  const first = mine(h)[0];
  const read = deferred();
  h.failure.answerGate = read.promise;
  const ended = h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t1");

  h.held[0]?.(new Error("Active turn changed before steering could be delivered"));
  await settle();
  read.finish(null);
  await ended;
  const answer = messages(h).find((message) => message.text === "Both read.");
  expect(answer?.reply).toEqual({ id: first?.id, name: "Boss", text: "@Alice A" });
  expect(typing(h)).toEqual([]);
});

test.each(["closed", "archived"] as const)(
  "a %s session settles a pending read once",
  async (event) => {
    const h = await harness();
    h.service.view(view(agent("a1", "Alice")));
    await send(h, "@Alice test the build");
    h.answers.set("a1", "Old answer.");
    const read = deferred();
    h.failure.answerGate = read.promise;
    const ended = h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t1");
    h.service[event]("a1");
    read.finish(null);
    await ended;
    const replies = messages(h).filter((message) => message.reply?.id === mine(h)[0]?.id);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ from: "__director", text: expect.stringContaining(event) });
    expect(typing(h)).toEqual([]);
  },
);

test("stopping Office saves an interruption notice for pending chat and ignores a late send failure", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  h.failure.hold = true;
  await send(h, "@Alice run the tests");
  await h.service.stop();
  h.held[0]?.(new Error("disconnected"));
  await settle();
  expect(typing(h)).toEqual([]);
  const replies = h.saved.at(-1)?.msgs.filter((message) => message.reply?.id === mine(h)[0]?.id);
  expect(replies).toHaveLength(1);
  expect(replies?.[0]).toMatchObject({
    from: "__director",
    tag: "delivery",
    text: expect.stringContaining("Office stopped"),
  });
});

test("a turn that ends with no office open still gets its answer", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice"), agent("a2", "Bea")));
  h.answers.set("a1", "Shipped.");
  await send(h, "@Alice ship it");
  h.service.view(null);
  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t1");
  expect(messages(h)).toContainEqual(
    expect.objectContaining({
      from: "a1",
      text: "Shipped.",
      reply: expect.objectContaining({ name: "Boss" }),
    }),
  );
  expect(typing(h)).toEqual([]);
  // The team is kept too, so an agent nobody asked still says its turn is done.
  await h.service.turnEnded({ id: "a2" }, { kind: "completed" }, "t2");
  h.clock.advance(10_000);
  expect(said(h, "Bea")).toHaveLength(1);
  expect(filled(WORK("done"), { task: "Bea" })).toContain(said(h, "Bea")[0]);
});

test("an agent that leaves the view while it works still answers, and its typing stops", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  h.answers.set("a1", "Shipped.");
  await send(h, "@Alice ship it");
  // The next view no longer has her: the answer comes from the member kept with the prompt.
  h.service.view(view());
  expect(typing(h)).toEqual(["Alice"]);
  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t1");
  expect(messages(h)).toContainEqual(
    expect.objectContaining({ from: "a1", name: "Alice", text: "Shipped." }),
  );
  expect(typing(h)).toEqual([]);
});

test("two messages to one agent in one turn get one answer, replying to the newest", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  h.answers.set("a1", "Both done.");
  await send(h, "@Alice first");
  await send(h, "@Alice second");
  expect(h.sent).toEqual([
    ["a1", `${PROMPT_PREFIX}@Alice first`],
    ["a1", `${PROMPT_PREFIX}@Alice second`],
  ]);
  const second = mine(h).at(-1);

  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t1");
  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t2");
  const answers = messages(h).filter((message) => message.text === "Both done.");
  expect(answers).toHaveLength(1);
  expect(answers[0]?.reply).toEqual({ id: second?.id, name: "Boss", text: "@Alice second" });
  expect(h.asked).toEqual(["a1"]);
  expect(typing(h)).toEqual([]);
});

/* ---------- each office event is the engine's line ---------- */

test("each office event is the engine's line: the first view is a baseline and says nothing", async () => {
  const h = await harness();
  const waiting = agent("a1", "Alice", {
    permissions: [{ id: "p1", kind: "tool", title: "Run npm test" }],
  });
  h.service.view(view(waiting));
  h.clock.advance(10_000);
  // An agent already there is not announced; a permission already there is not either.
  h.service.view(view(waiting));
  h.clock.advance(10_000);
  expect(messages(h)).toEqual([expect.objectContaining({ text: chatT("chat.sys.created") })]);
});

test("each office event is the engine's line: a new agent is added and says hello", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  h.service.view(view(agent("a1", "Alice"), agent("a2", "Bea")));
  h.clock.advance(10_000);
  expect(messages(h)).toContainEqual(
    expect.objectContaining({
      kind: "sys",
      text: chatT("chat.sys.added", { by: "HR", name: "Bea" }),
    }),
  );
  const hello = said(h, "Bea");
  expect(hello).toHaveLength(1);
  expect(filled(WORK("hello"), { project: "shop" })).toContain(hello[0]);
  expect(said(h, "Alice")).toEqual([]);
});

test("each office event is the engine's line: a permission waits", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  h.service.view(
    view(
      agent("a1", "Alice", { permissions: [{ id: "p1", kind: "tool", title: "Run npm test" }] }),
    ),
  );
  const lines = said(h, "Alice");
  expect(lines).toHaveLength(1);
  expect(WORK("wait")).toContain(lines[0]);
});

test("each office event is the engine's line: a question asks", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  h.service.view(
    view(
      agent("a1", "Alice", { permissions: [{ id: "q1", kind: "question", title: "Which one?" }] }),
    ),
  );
  const lines = said(h, "Alice");
  expect(lines).toHaveLength(1);
  expect(WORK("ask")).toContain(lines[0]);
});

test("each office event is the engine's line: a sub-agent is a helper its parent calls in", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  h.service.view(
    view(
      agent("a1", "Alice"),
      agent("s1", "Check the docs", { parentAgentId: "a1", name: "Alice-1", number: 1 }),
    ),
  );
  h.clock.advance(10_000);
  const lines = said(h, "Alice");
  expect(lines).toHaveLength(1);
  expect(WORK("helper")).toContain(lines[0]);
  expect(said(h, "Alice-1")).toEqual([]);
});

test("each office event is the engine's line: a turn that ends says it is done with its task", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Fix the login")));
  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t1");
  h.clock.advance(10_000);
  const lines = said(h, "Fix the login");
  expect(lines).toHaveLength(1);
  expect(filled(WORK("done"), { task: "Fix the login" })).toContain(lines[0]);
  // Nobody asked it anything, so no answer is read.
  expect(h.asked).toEqual([]);
});

/* ---------- the office's life ---------- */

test("reception greets the office and an agent starts the lunch poll", async () => {
  const early = await harness({ at: new Date(2026, 10, 18, 8, 0).getTime() });
  early.service.view(view(agent("a1", "Alice")));
  early.clock.advance(CHAT_CLOCK_MS);
  early.clock.advance(6000);
  expect(messages(early)).toContainEqual(
    expect.objectContaining({ from: "__reception", name: "Receptionist" }),
  );

  const noon = await harness({ at: new Date(2026, 10, 18, 10, 50).getTime() });
  noon.service.view(view(agent("a1", "Alice")));
  noon.clock.advance(CHAT_CLOCK_MS);
  expect(messages(noon)).toContainEqual(expect.objectContaining({ kind: "poll", from: "a1" }));
  expect(messages(noon)).toContainEqual(
    expect.objectContaining({
      kind: "sys",
      text: chatT("chat.sys.poll", { name: "Alice", q: chatT("chat.life.lunchPoll") }),
    }),
  );
});

test("a vote, an rsvp and a reaction reach the engine as you, and the same reaction again takes it back", async () => {
  const loaded: ChatData = {
    v: 1,
    msgs: [
      {
        id: "p1",
        at: MORNING - 60_000,
        kind: "poll",
        from: "a1",
        name: "Alice",
        text: "Lunch?",
        poll: {
          q: "Lunch?",
          opts: [
            { t: "Rice", by: [] },
            { t: "Noodles", by: ["a1"] },
          ],
        },
        reacts: {},
      },
      {
        id: "r1",
        at: MORNING - 60_000,
        kind: "remind",
        from: "a1",
        name: "Alice",
        text: "Stand-up",
        remind: { title: "Stand-up", at: MORNING + 3_600_000, repeat: "week", yes: [], no: [] },
        reacts: {},
      },
    ],
    pinned: null,
    days: {},
    keys: [],
  };
  const h = await harness({
    store: { load: async () => structuredClone(loaded), save: async () => undefined },
  });
  const byId = (id: string) => messages(h).find((message) => message.id === id);

  expect(await h.service.request({ op: "vote", id: "p1", index: 0 })).toEqual({ ok: true });
  expect(byId("p1")?.poll?.opts).toEqual([
    { t: "Rice", by: ["me"] },
    { t: "Noodles", by: ["a1"] },
  ]);

  expect(await h.service.request({ op: "rsvp", id: "r1", yes: true })).toEqual({ ok: true });
  expect(byId("r1")?.remind).toMatchObject({ yes: ["me"], no: [] });
  expect(await h.service.request({ op: "rsvp", id: "r1", yes: false })).toEqual({ ok: true });
  expect(byId("r1")?.remind).toMatchObject({ yes: [], no: ["me"] });

  expect(await h.service.request({ op: "react", id: "p1", emoji: "👍" })).toEqual({ ok: true });
  expect(byId("p1")?.reacts).toEqual({ "👍": ["me"] });
  expect(h.changes.at(-1)).toEqual({ op: "update", message: byId("p1") });
  expect(await h.service.request({ op: "react", id: "p1", emoji: "👍" })).toEqual({ ok: true });
  expect(byId("p1")?.reacts).toEqual({});
});

test("a message can be recalled for two minutes, and later the server refuses", async () => {
  const h = await harness();
  await send(h, "first");
  await send(h, "second");
  const [first, second] = mine(h);

  h.clock.advance(RECALL_WINDOW_MS);
  expect(await h.service.request({ op: "recall", id: first?.id ?? "" })).toEqual({ ok: true });
  expect(mine(h)[0]).toMatchObject({ recalled: true, text: "" });

  h.clock.advance(1);
  expect(await h.service.request({ op: "recall", id: second?.id ?? "" })).toEqual({
    ok: false,
    error: "A message can be recalled for two minutes.",
  });
  expect(mine(h)[1]).toMatchObject({ text: "second" });
  expect(mine(h)[1]?.recalled).toBeUndefined();
});

test("a word for a meeting is an act for the open scenes, and a word for tea is none", async () => {
  const h = await harness();
  const acts = () => h.changes.filter((change) => change.op === "act");
  await send(h, "meeting at 10");
  expect(acts()).toEqual([{ op: "act", what: "meeting", id: expect.any(String) }]);
  await send(h, "milk tea");
  expect(acts()).toHaveLength(1);
  // Each act has its own id, so a client drops only one it already saw.
  await send(h, "stand-up now");
  const [one, two] = acts();
  expect(two).toEqual({ op: "act", what: "meeting", id: expect.any(String) });
  expect(two).not.toEqual(one);
});

test("a send with nothing in it or a sticker that is not on the list is refused", async () => {
  const h = await harness();
  const nothing = { ok: false, error: "There is nothing to send." };
  expect(await h.service.request({ op: "send", text: "   " })).toEqual(nothing);
  expect(await h.service.request({ op: "send" })).toEqual(nothing);
  expect(await h.service.request({ op: "send", sticker: 8 })).toEqual({
    ok: false,
    error: "There is no such sticker.",
  });
  expect(messages(h)).toHaveLength(1);

  expect(await h.service.request({ op: "send", sticker: 7 })).toEqual({ ok: true });
  expect(mine(h)).toEqual([expect.objectContaining({ kind: "sticker", sticker: 7 })]);
});

/* ---------- the file, the clock and the timers ---------- */

test("the conversation is kept across a restart, and the clock keeps its 30 s beat", async () => {
  const directory = await mkdtemp(join(tmpdir(), "office-chat-service-"));
  try {
    const file = join(directory, "office", "chat.json");
    const store = () => createChatStore({ file, now: () => 0, log: () => undefined });
    const polls = (h: Harness) => messages(h).filter((message) => message.kind === "poll");

    const first = await harness({ at: new Date(2026, 10, 18, 10, 44).getTime(), store: store() });
    first.service.view(view(agent("a1", "Alice")));
    await send(first, "hello");
    first.clock.advance(CHAT_CLOCK_MS); // 10:44:30
    expect(polls(first)).toEqual([]);
    first.clock.advance(CHAT_CLOCK_MS); // 10:45:00, the lunch poll's time
    expect(polls(first)).toHaveLength(1);
    await first.service.stop();

    const second = await harness({ at: first.clock.now(), store: store() });
    expect(messages(second)).toEqual(messages(first));
    second.service.view(view(agent("a1", "Alice")));
    second.clock.advance(CHAT_CLOCK_MS);
    // The day of the lunch poll was kept too: it does not come twice.
    expect(polls(second)).toHaveLength(1);
    await second.service.stop();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a save that fails is logged and the next change saves again", async () => {
  let failNext = true;
  const saved: ChatData[] = [];
  const h = await harness({
    store: {
      load: async () => emptyChat(),
      save: async (data) => {
        if (failNext) {
          failNext = false;
          throw new Error("disk full");
        }
        saved.push(data);
      },
    },
  });
  await settle();
  expect(h.logs).toEqual([expect.stringContaining("disk full")]);
  expect(saved).toEqual([]);

  h.service.view(view(agent("a1", "Alice")));
  await send(h, "hello");
  await settle();
  expect(saved.at(-1)?.msgs.map((message) => message.text)).toEqual([
    chatT("chat.sys.created"),
    "hello",
  ]);
});

test("saves in flight collapse to the newest one", async () => {
  const message = (id: string): ChatMessage => ({
    id,
    at: MORNING - 60_000,
    kind: "text",
    from: "me",
    name: "Boss",
    text: id,
    reacts: {},
  });
  let open = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const calls: ChatData[] = [];
  const h = await harness({
    store: {
      load: async () => ({ ...emptyChat(), msgs: [message("m1"), message("m2"), message("m3")] }),
      save: async (data) => {
        calls.push(data);
        await gate;
      },
    },
  });
  h.service.view(view(agent("a1", "Alice")));
  await send(h, "hello"); // a save starts and waits
  expect(calls).toHaveLength(1);

  await h.service.request({ op: "react", id: "m1", emoji: "👍" });
  await h.service.request({ op: "react", id: "m2", emoji: "❤️" });
  await h.service.request({ op: "react", id: "m3", emoji: "😆" });
  expect(calls).toHaveLength(1);

  open();
  await settle();
  expect(calls).toHaveLength(2);
  expect(calls[1]?.msgs.map((saved) => saved.reacts)).toEqual([
    { "👍": ["me"] },
    { "❤️": ["me"] },
    { "😆": ["me"] },
    {},
  ]);
  // Each save has its own copy: the first one does not change under it.
  expect(calls[0]?.msgs.map((saved) => saved.reacts)).toEqual([{}, {}, {}, {}]);
});

test("the engine's timers drain: after the banter only the 30 s clock is waiting, and stop() leaves none", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  await send(h, "@Alice hi");
  await send(h, "meeting");
  expect(h.clock.pending()).toBeGreaterThan(1);
  h.clock.advance(120_000);
  expect(h.clock.pending()).toBe(1);
  // More banter on its way: stop() cancels it with the clock.
  await send(h, "meeting again");
  expect(h.clock.pending()).toBeGreaterThan(1);
  await h.service.stop();
  expect(h.clock.pending()).toBe(0);
});

test("lines are told to subscribers as changes, and not while the engine is being made", async () => {
  const h = await harness();
  expect(h.changes).toEqual([]);

  h.service.view(view(agent("a1", "Alice")));
  await send(h, "@Alice hi");
  const [question] = mine(h);
  expect(h.changes).toEqual([
    { op: "add", message: question },
    { op: "typing", names: ["Alice"] },
  ]);

  h.clock.advance(10_000);
  h.answers.set("a1", "Hello!");
  await h.service.turnEnded({ id: "a1" }, { kind: "completed" }, "t1");
  const reply = messages(h).at(-1);
  expect(reply?.from).toBe("a1");
  expect(h.changes).toContainEqual({ op: "add", message: reply });

  // A pinned poll tells the whole conversation again.
  await send(h, "lunch?");
  expect(h.changes.at(-1)).toEqual({
    op: "all",
    messages: messages(h),
    pinned: h.service.snapshot().pinned,
  });
});

test("the same scene moment from two devices becomes one staff line", async () => {
  const h = await harness();
  h.service.view(view(agent("a1", "Alice")));
  const event = { op: "life", kind: "parcel", vars: { id: "a1" } } as const;
  expect(await h.service.request(event)).toEqual({ ok: true });
  await h.service.request(event);
  h.clock.advance(15000);
  const parcels = messages(h).filter((m) => m.from === "__reception" && m.text?.includes("Alice"));
  expect(parcels).toHaveLength(1);
  expect(parcels[0]?.name).toBe("Receptionist");
});

/** JPEG frame and scan markers with the office thumbnail dimensions. */
function jpegFrame(width = 480): string {
  const image = Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0,
    11,
    8,
    1,
    104,
    width >> 8,
    width & 255,
    1,
    1,
    0x11,
    0,
    0xff,
    0xda,
    0,
    8,
    1,
    1,
    0,
    0,
    63,
    0,
    0x7f,
    0xff,
    0xd9,
  ]);
  return `data:image/jpeg;base64,${image.toString("base64")}`;
}

test("group photos reach every chat once, survive a retry after restart, and never prompt an agent", async () => {
  const h = await harness();
  h.service.view(view(agent("a", "Ada")));
  const shot = { op: "photo", requestId: "click-1", data: jpegFrame() } as const;
  const replies = await Promise.all([h.service.request(shot), h.service.request(shot)]);
  expect(replies).toEqual([{ ok: true }, { ok: true }]);
  const photos = () => h.service.snapshot().messages.filter((m) => m.kind === "photo");
  expect(photos()).toMatchObject([{ photo: shot.data, from: "me" }]);
  expect(h.changes.filter((c) => c.op === "add" && c.message.kind === "photo")).toHaveLength(1);
  expect(h.sent).toHaveLength(0);
  for (let i = 2; i <= 8; i++) await h.service.request({ ...shot, requestId: `click-${i}` });
  expect(photos().filter((m) => m.photo)).toHaveLength(6);
  expect(
    h.changes.filter((c) => c.op === "update" && c.message.kind === "photo" && !c.message.photo),
  ).toHaveLength(2);
  await h.service.stop();
  const saved = h.saved.at(-1)!;
  expect(saved.msgs.filter((m) => m.photo)).toHaveLength(6);
  const restarted = await harness({ store: { load: async () => saved, save: async () => {} } });
  await restarted.service.request(shot);
  expect(restarted.service.snapshot().messages.filter((m) => m.kind === "photo")).toHaveLength(8);
  await restarted.service.stop();
});

test("a malformed or oversized group photo or a JPEG with different dimensions cannot enter the chat", async () => {
  const h = await harness();
  for (const data of [
    jpegFrame(481),
    jpegFrame().slice(0, -4),
    "data:image/jpeg;base64," + "A".repeat(96_000),
    "https://host/image.jpg",
  ]) {
    expect(await h.service.request({ op: "photo", requestId: "fixture", data })).toMatchObject({
      ok: false,
    });
  }
  expect(h.service.snapshot().messages.some((m) => m.kind === "photo")).toBe(false);
  await h.service.stop();
});
