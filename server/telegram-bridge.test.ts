import { afterEach, describe, expect, test } from "vitest";
import type { AgentToolContext } from "@getpaseo/plugin/server";
import type { Post, PostResult, TelegramState } from "../shared/contracts.js";
import { incidentNotice, planNotice, testNotice } from "../shared/notify.js";
import { EMPTY_BOARDS, type BoardStore, type BoardsFile } from "./board-store.js";
import { createFakeClock, settle, type FakeClock } from "./fake-clock.js";
import { createOffice, type Office } from "./office.js";
import {
  createTelegramBridge,
  type DirectoryAgent,
  type TelegramBoard,
  type TelegramBridge,
  type TelegramSettings,
} from "./telegram-bridge.js";
import {
  NO_SAVED_TOKEN,
  type SavedToken,
  type TelegramKept,
  type TelegramStore,
} from "./telegram-store.js";

const TOKEN = "123456789:AAH-secret_token_value_0123456789abcd";
const OTHER_TOKEN = "987654321:BBH-other_token_value_0123456789abcd";
/** The bot TOKEN belongs to. */
const BOT = "123456789";
const CHAT = -1001;
const OWNER = 501;
const FRIEND = 502;
const STRANGER = 999;
const NOW = Date.parse("2026-11-11T09:00:00.000Z");

const SETTINGS: TelegramSettings = {
  chat: String(CHAT),
  users: [String(OWNER), String(FRIEND)],
  needs: true,
  stalled: true,
  done: true,
  incidents: true,
  plan: true,
  lands: "backlog",
};

const HELP = "Reply to a task's message to answer it, or use /task or /board.";
const GONE = "That task is no longer on the board.";

// ---- a scripted Telegram ----

interface RawUpdate {
  update_id: number;
  [key: string]: unknown;
}

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown>;
  at: number;
}

type Answer = () => Response | Promise<Response>;

const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }));
const refusal = (status: number, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ ok: false, error_code: status, description: TOKEN, ...extra }), {
    status,
  });
/** A failed request as undici throws it: its message names the address, and so the token. */
const unreachable = (url: string) => () => {
  throw Object.assign(new TypeError(`fetch failed ${url}`), {
    cause: Object.assign(new Error(`connect ECONNREFUSED ${url}`), { code: "ECONNREFUSED" }),
  });
};

function fakeTelegram(clock: FakeClock) {
  const calls: Call[] = [];
  let pending: RawUpdate[] = [];
  let nextMessageId = 1000;
  const sent: { chat: unknown; text: string; messageId: number }[] = [];
  const pollAnswers: Answer[] = [];
  const sendAnswers: Answer[] = [];
  const meAnswers: Answer[] = [];
  let wake: (() => void) | null = null;
  const fetchFn = (async (input: string, init: RequestInit) => {
    const url = String(input);
    const method = url.split("/").at(-1) ?? "";
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, method, body, at: clock.now() });
    if (method === "getUpdates") {
      const scripted = pollAnswers.shift();
      if (scripted !== undefined) return scripted();
      if (body.offset === -1) return ok(pending.slice(-1));
      const offset = typeof body.offset === "number" ? body.offset : 0;
      const ready = () => {
        // Asking from an offset confirms what came before it.
        pending = pending.filter((item) => item.update_id >= offset);
        return pending;
      };
      if (ready().length > 0 || body.timeout === 0) return ok(ready());
      await new Promise<void>((resolve, reject) => {
        wake = resolve;
        init.signal?.addEventListener("abort", () =>
          reject(new DOMException(`aborted ${url}`, "AbortError")),
        );
      });
      return ok(ready());
    }
    if (method === "sendMessage") {
      const scripted = sendAnswers.shift();
      if (scripted !== undefined) return scripted();
      const messageId = nextMessageId++;
      sent.push({ chat: body.chat_id, text: String(body.text), messageId });
      return ok({ message_id: messageId });
    }
    if (method === "getMe") {
      const scripted = meAnswers.shift();
      if (scripted !== undefined) return scripted();
      return ok({ id: 1, is_bot: true, username: "office_bot" });
    }
    throw new Error(`unexpected ${method}`);
  }) as unknown as typeof fetch;
  return {
    fetchFn,
    calls,
    sent,
    pollAnswers,
    sendAnswers,
    meAnswers,
    polls: () => calls.filter((call) => call.method === "getUpdates"),
    texts: () => sent.map((message) => message.text),
    push(...updates: RawUpdate[]) {
      pending.push(...updates);
      const waiting = wake;
      wake = null;
      waiting?.();
    },
  };
}

let nextUpdate = 10;
let nextIncoming = 1;

interface MessageFields {
  from?: { id: number; is_bot?: boolean } | null;
  chat?: { id: number; type: string };
  text?: string | null;
  replyTo?: number;
}

function update(fields: MessageFields): RawUpdate {
  const from = fields.from === undefined ? { id: OWNER } : fields.from;
  return {
    update_id: nextUpdate++,
    message: {
      message_id: nextIncoming++,
      ...(from === null ? {} : { from: { is_bot: false, first_name: "Someone", ...from } }),
      chat: fields.chat ?? { id: CHAT, type: "supergroup" },
      ...(fields.text === null ? {} : { text: fields.text ?? "hello" }),
      ...(fields.replyTo === undefined ? {} : { reply_to_message: { message_id: fields.replyTo } }),
    },
  };
}

const inChat = (from: number, text: string, replyTo?: number) =>
  update({ from: { id: from }, text, ...(replyTo === undefined ? {} : { replyTo }) });
const inPrivate = (from: number, text: string) =>
  update({ from: { id: from }, chat: { id: from, type: "private" }, text });

// ---- the office's side ----

function post(id: string, fields: Partial<Post> = {}): Post {
  return {
    id,
    seq: Number(id.slice(1)),
    board: "lobby",
    kind: "task",
    state: "open",
    text: `Task ${id}`,
    author: "user",
    createdAt: "2026-11-11T08:00:00.000Z",
    updatedAt: "2026-11-11T08:00:00.000Z",
    ...fields,
  };
}

const TITLES = new Map([
  ["a", "Builder"],
  ["b", "Reviewer"],
]);

/** A board in memory: what is posted is recorded and put on it, as the user's. */
function fakeBoard(initial: Post[] = []) {
  const posts = [...initial];
  const posted: Parameters<Office["post"]>[0][] = [];
  let seq = 100;
  let hold: Promise<void> | null = null;
  const board: TelegramBoard & {
    posts: Post[];
    posted: typeof posted;
    holdNext(gate: Promise<void>): void;
  } = {
    posts,
    posted,
    holdNext(gate) {
      hold = gate;
    },
    allPosts: () => posts,
    label: (author) => (author === "user" ? "the user" : (TITLES.get(author) ?? author)),
    async post(input): Promise<PostResult> {
      posted.push(input);
      if (hold !== null) {
        const gate = hold;
        hold = null;
        await gate;
      }
      if (input.text.trim() === "")
        return { ok: false, error: "Unable to post: the text is empty" };
      const created = post(`p${seq++}`, {
        board: input.board,
        kind: input.kind,
        text: input.text,
        ...(input.backlog ? { backlog: true } : {}),
        ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
      });
      posts.push(created);
      return { ok: true, post: created };
    },
  };
  return board;
}

function memoryTelegramStore(
  token: SavedToken = { token: TOKEN, unreadable: false },
  state: TelegramKept | null = { version: 1, bot: BOT, offset: 1, sent: [], taskTimes: [] },
) {
  const store: TelegramStore & {
    token: SavedToken;
    state: TelegramKept | null;
    saves: TelegramKept[];
  } = {
    token,
    state,
    saves: [],
    loadToken: async () => store.token,
    saveToken: async (next) => {
      store.token = next === null ? NO_SAVED_TOKEN : { token: next, unreadable: false };
    },
    loadState: async () => structuredClone(store.state),
    saveState: async (next) => {
      store.state = structuredClone(next);
      store.saves.push(structuredClone(next));
    },
  };
  return store;
}

interface SetupOptions {
  board?: TelegramBoard;
  store?: ReturnType<typeof memoryTelegramStore>;
  env?: NodeJS.ProcessEnv;
  settings?: TelegramSettings | null;
  agents?: Map<string, DirectoryAgent> | null;
  clock?: FakeClock;
  telegram?: ReturnType<typeof fakeTelegram>;
}

const running: TelegramBridge[] = [];

afterEach(async () => {
  for (const bridge of running.splice(0)) await bridge.stop();
});

function setup(options: SetupOptions = {}) {
  const clock = options.clock ?? createFakeClock(NOW);
  const telegram = options.telegram ?? fakeTelegram(clock);
  const board = options.board ?? fakeBoard();
  const store = options.store ?? memoryTelegramStore();
  const logs: string[] = [];
  const states: TelegramState[] = [];
  const directory = {
    agents: options.agents === undefined ? new Map<string, DirectoryAgent>() : options.agents,
  };
  const bridge = createTelegramBridge({
    store,
    env: options.env ?? {},
    fetchFn: telegram.fetchFn,
    clock,
    board,
    agents: () => directory.agents,
    changed: (state) => states.push(state),
    log: (line) => logs.push(line),
  });
  running.push(bridge);
  bridge.settingsChanged(options.settings === undefined ? SETTINGS : options.settings);
  /** Nothing the bridge said, showed or kept for clients holds a token. */
  function leakCheck(): void {
    const said = JSON.stringify({ logs, states, state: bridge.state() });
    expect(said).not.toContain(TOKEN);
    expect(said).not.toContain(OTHER_TOKEN);
    expect(said).not.toContain("api.telegram.org");
  }
  return { clock, telegram, board, store, logs, states, directory, bridge, leakCheck };
}

/** Lets the bridge's promise chains run until `done` holds. */
async function until(done: () => boolean): Promise<void> {
  for (let round = 0; round < 100; round += 1) {
    if (done()) return;
    await settle();
  }
  throw new Error("timed out waiting");
}

async function started(harness: ReturnType<typeof setup>, polls = 1): Promise<void> {
  await harness.bridge.ready;
  await until(() => harness.telegram.polls().length >= polls);
}

// ---- tests ----

describe("when it runs", () => {
  test("it polls once it has a token, a chat and a user, and says where the token comes from", async () => {
    const harness = setup();
    await started(harness);
    expect(harness.telegram.polls()[0]).toMatchObject({
      url: `https://api.telegram.org/bot${TOKEN}/getUpdates`,
      body: { offset: 1, timeout: 25, allowed_updates: ["message"] },
    });
    expect(harness.bridge.state()).toEqual({
      on: true,
      source: "saved",
      problem: null,
      dropped: 0,
    });
    // It asks who it is first, for the name a command may carry.
    expect(harness.telegram.calls[0]?.method).toBe("getMe");
    harness.leakCheck();
  });

  test("with no token, no chat or no user it does not poll", async () => {
    for (const harness of [
      setup({ store: memoryTelegramStore(NO_SAVED_TOKEN) }),
      setup({ settings: { ...SETTINGS, chat: "" } }),
      setup({ settings: { ...SETTINGS, users: [] } }),
      setup({ settings: null }),
    ]) {
      await harness.bridge.ready;
      await settle();
      expect(harness.telegram.calls).toEqual([]);
      expect(harness.bridge.state().on).toBe(false);
    }
  });

  test("the environment's token serves when none is saved, and is said to", async () => {
    const harness = setup({
      store: memoryTelegramStore(NO_SAVED_TOKEN),
      env: { TELEGRAM_BOT_TOKEN: OTHER_TOKEN },
    });
    await started(harness);
    expect(harness.telegram.polls()[0]?.url).toContain(OTHER_TOKEN);
    expect(harness.bridge.state()).toMatchObject({ on: true, source: "env" });
    harness.leakCheck();
  });

  test("an unreadable token file is no token, shown as a problem", async () => {
    const harness = setup({ store: memoryTelegramStore({ token: null, unreadable: true }) });
    await harness.bridge.ready;
    await settle();
    expect(harness.telegram.calls).toEqual([]);
    expect(harness.bridge.state()).toEqual({
      on: false,
      source: null,
      problem: "The saved Telegram token cannot be read: save it again",
      dropped: 0,
    });
  });

  test("the state is published only when it changes", async () => {
    const harness = setup();
    await started(harness);
    const count = harness.states.length;
    harness.bridge.settingsChanged({ ...SETTINGS, done: false });
    harness.bridge.boardChanged();
    await settle();
    expect(harness.states).toHaveLength(count);
    const unique = new Set(harness.states.map((state) => JSON.stringify(state)));
    expect(unique.size).toBe(harness.states.length);
  });
});

describe("the first run", () => {
  test("is also a state kept for another bot: the environment's token changed across a restart", async () => {
    const board = fakeBoard([post("p1")]);
    const store = memoryTelegramStore(NO_SAVED_TOKEN, {
      version: 1,
      bot: BOT,
      offset: 50,
      sent: [{ chat: String(CHAT), messageId: 900, postId: "p1" }],
      taskTimes: [],
    });
    const harness = setup({ board, store, env: { TELEGRAM_BOT_TOKEN: OTHER_TOKEN } });
    await started(harness, 2);
    expect(harness.telegram.polls()[0]?.body).toMatchObject({ offset: -1 });
    expect(store.state).toMatchObject({ bot: "987654321", offset: 0, sent: [] });
    harness.telegram.push(inChat(OWNER, "go ahead", 900));
    await until(() => harness.telegram.sent.length === 1);
    expect(harness.telegram.texts()).toEqual([GONE]);
    expect(board.posted).toEqual([]);
  });

  test("keeps the state of the same bot", async () => {
    const store = memoryTelegramStore(undefined, {
      version: 1,
      bot: BOT,
      offset: 50,
      sent: [{ chat: String(CHAT), messageId: 900, postId: "p1" }],
      taskTimes: [],
    });
    const harness = setup({ store });
    await started(harness);
    expect(harness.telegram.polls()[0]?.body).toMatchObject({ offset: 50 });
    expect(store.state?.sent).toHaveLength(1);
  });

  test("throws away what waited before the bridge was set up, and goes on from the update after it", async () => {
    const clock = createFakeClock(NOW);
    const telegram = fakeTelegram(clock);
    const board = fakeBoard();
    telegram.push(inChat(OWNER, "/task old one"), inChat(OWNER, "/task old two"));
    const lastOld = nextUpdate - 1;
    const store = memoryTelegramStore(undefined, null);
    const harness = setup({ clock, telegram, board, store });
    await started(harness, 2);
    expect(telegram.polls()[0]?.body).toEqual({
      offset: -1,
      timeout: 0,
      allowed_updates: ["message"],
    });
    expect(telegram.polls()[1]?.body).toMatchObject({ offset: lastOld + 1, timeout: 25 });
    expect(store.state?.offset).toBe(lastOld + 1);
    expect(board.posted).toEqual([]);
    expect(telegram.sent).toEqual([]);
  });

  test("with nothing waiting it goes on from the start", async () => {
    const store = memoryTelegramStore(undefined, null);
    const harness = setup({ store });
    await started(harness, 2);
    expect(harness.telegram.polls()[1]?.body).toMatchObject({ offset: 0 });
    expect(store.state?.offset).toBe(0);
  });
});

describe("who is heard", () => {
  test("a listed user in the configured chat is answered there", async () => {
    const harness = setup();
    await started(harness);
    harness.telegram.push(inChat(OWNER, "hi"));
    await until(() => harness.telegram.sent.length === 1);
    expect(harness.telegram.sent[0]).toMatchObject({ chat: CHAT, text: HELP });
    expect(harness.bridge.state().dropped).toBe(0);
  });

  test("a listed user in a private chat with the bot is answered there", async () => {
    const harness = setup();
    await started(harness);
    harness.telegram.push(inPrivate(FRIEND, "hi"));
    await until(() => harness.telegram.sent.length === 1);
    expect(harness.telegram.sent[0]).toMatchObject({ chat: FRIEND, text: HELP });
  });

  const SECRET = "/task rm -rf / please";
  const strangers: [string, () => RawUpdate][] = [
    [
      "a listed user in another group",
      () => update({ from: { id: OWNER }, chat: { id: -2002, type: "group" }, text: SECRET }),
    ],
    ["someone not listed, in the configured chat", () => inChat(STRANGER, SECRET)],
    ["someone not listed, in a private chat", () => inPrivate(STRANGER, SECRET)],
    [
      "a bot, even with a listed id",
      () => update({ from: { id: OWNER, is_bot: true }, text: SECRET }),
    ],
    [
      "a private chat that is not the sender's own",
      () => update({ from: { id: OWNER }, chat: { id: STRANGER, type: "private" }, text: SECRET }),
    ],
    [
      "a chat whose id is the sender's but that is not private",
      () => update({ from: { id: OWNER }, chat: { id: OWNER, type: "group" }, text: SECRET }),
    ],
    ["a message with no sender", () => update({ from: null, text: SECRET })],
    ["a message with no text", () => update({ from: { id: OWNER }, text: null })],
    [
      "a sender whose id is not a number",
      () => ({
        update_id: nextUpdate++,
        message: {
          message_id: 1,
          from: { id: String(OWNER), is_bot: false },
          chat: { id: CHAT, type: "group" },
          text: SECRET,
        },
      }),
    ],
  ];

  test.each(strangers)(
    "%s is dropped: counted, never answered, acted on or logged",
    async (_case, message) => {
      const harness = setup();
      await started(harness);
      harness.telegram.push(message());
      await until(() => harness.bridge.state().dropped === 1);
      await settle();
      expect(harness.telegram.sent).toEqual([]);
      expect(harness.board).toMatchObject({ posted: [] });
      const said = JSON.stringify({ logs: harness.logs, states: harness.states });
      for (const word of ["rm -rf", String(STRANGER), "-2002", String(OWNER)]) {
        expect(said).not.toContain(word);
      }
      expect(harness.states.at(-1)).toMatchObject({ dropped: 1 });
    },
  );

  test("the count of what was dropped adds up", async () => {
    const harness = setup();
    await started(harness);
    harness.telegram.push(...strangers.map(([, message]) => message()));
    await until(() => harness.bridge.state().dropped === strangers.length);
  });

  test("an edit, a channel post or a button press is ignored, not counted", async () => {
    const harness = setup();
    await started(harness);
    harness.telegram.push(
      { update_id: nextUpdate++, edited_message: { message_id: 1, text: "x" } },
      { update_id: nextUpdate++, channel_post: { message_id: 2, text: "x" } },
      { update_id: nextUpdate++, callback_query: { id: "3" } },
    );
    const last = nextUpdate - 1;
    await until(() => harness.store.state?.offset === last + 1);
    expect(harness.bridge.state().dropped).toBe(0);
    expect(harness.telegram.sent).toEqual([]);
  });

  test("a message from a listed user that is no command or reply gets one line of help", async () => {
    const harness = setup();
    await started(harness);
    harness.telegram.push(inChat(OWNER, "/start"), inChat(OWNER, "what is up"));
    await until(() => harness.telegram.sent.length === 2);
    expect(harness.telegram.texts()).toEqual([HELP, HELP]);
  });
});

describe("what goes out", () => {
  function claimed(id: string, fields: Partial<Post> = {}): Post {
    return post(id, { state: "claimed", claimedBy: "a", ...fields });
  }

  test("a task newly blocked is told once, and again when its question changes", async () => {
    const board = fakeBoard([claimed("p1", { text: "Deploy\nthe   ledger" })]);
    const harness = setup({ board });
    await started(harness);
    harness.bridge.boardChanged();
    board.posts[0] = {
      ...claimed("p1", { text: "Deploy\nthe   ledger" }),
      blocked: "Which region?",
    };
    harness.bridge.boardChanged();
    harness.bridge.boardChanged();
    await until(() => harness.telegram.sent.length === 1);
    await settle();
    expect(harness.telegram.sent[0]).toMatchObject({
      chat: String(CHAT),
      text: "p1 needs you — Builder: Which region?\nDeploy the ledger",
    });
    board.posts[0] = { ...board.posts[0], blocked: "And the tag?" } as Post;
    harness.bridge.boardChanged();
    await until(() => harness.telegram.sent.length === 2);
    expect(harness.telegram.sent[1]?.text).toBe(
      "p1 needs you — Builder: And the tag?\nDeploy the ledger",
    );
    // Each is a message a reply can answer.
    expect(harness.store.state?.sent).toEqual([
      { chat: String(CHAT), messageId: 1000, postId: "p1" },
      { chat: String(CHAT), messageId: 1001, postId: "p1" },
    ]);
  });

  test("a task newly done is told once, with its result or without one", async () => {
    const board = fakeBoard([claimed("p1"), claimed("p2"), post("p3")]);
    const harness = setup({ board });
    await started(harness);
    harness.bridge.boardChanged();
    board.posts[0] = { ...claimed("p1"), state: "done", result: "Shipped\nit" };
    board.posts[1] = { ...claimed("p2"), state: "done" };
    board.posts[2] = { ...post("p3"), state: "done", result: "Did it myself" };
    harness.bridge.boardChanged();
    harness.bridge.boardChanged();
    await until(() => harness.telegram.sent.length === 3);
    await settle();
    expect(harness.telegram.texts()).toEqual([
      "p1 done by Builder: Shipped it\nTask p1",
      "p2 done by Builder: no result given\nTask p2",
      "p3 done by the owner: Did it myself\nTask p3",
    ]);
  });

  test("nothing already blocked or done when the bridge starts is told", async () => {
    const board = fakeBoard([
      claimed("p1", { blocked: "Which region?" }),
      claimed("p2", { state: "done", result: "x" }),
    ]);
    const harness = setup({ board });
    await started(harness);
    harness.bridge.boardChanged();
    harness.bridge.boardChanged();
    await settle();
    expect(harness.telegram.sent).toEqual([]);
  });

  test("a lobby task and its copy on the holder's board are one event, told as the lobby task", async () => {
    const board = fakeBoard([
      claimed("p1", { link: "p2" }),
      claimed("p2", { board: "w1", link: "p1" }),
      // A room's own task is told as itself.
      claimed("p3", { board: "w1" }),
    ]);
    const harness = setup({ board });
    await started(harness);
    harness.bridge.boardChanged();
    for (const index of [0, 1, 2]) {
      board.posts[index] = { ...(board.posts[index] as Post), blocked: "Which region?" };
    }
    harness.bridge.boardChanged();
    await until(() => harness.telegram.sent.length === 2);
    await settle();
    expect(harness.telegram.texts().map((text) => text.split(" ")[0])).toEqual(["p1", "p3"]);
  });

  test("a long message is cut to 3,500 characters and a task's text to 200, each with …", async () => {
    const board = fakeBoard([claimed("p1", { text: "t".repeat(300) })]);
    const harness = setup({ board });
    await started(harness);
    harness.bridge.boardChanged();
    board.posts[0] = { ...claimed("p1", { text: "t".repeat(300) }), blocked: "q".repeat(5000) };
    harness.bridge.boardChanged();
    await until(() => harness.telegram.sent.length === 1);
    const text = harness.telegram.texts()[0] ?? "";
    expect(text).toHaveLength(3500);
    expect(text.endsWith("…")).toBe(true);
    board.posts[0] = { ...claimed("p1", { text: "t".repeat(300) }), blocked: "short" };
    harness.bridge.boardChanged();
    await until(() => harness.telegram.sent.length === 2);
    expect(harness.telegram.texts()[1]).toBe(`p1 needs you — Builder: short\n${"t".repeat(199)}…`);
  });

  test("each kind is sent only while its switch is on", async () => {
    const board = fakeBoard([claimed("p1"), claimed("p2")]);
    const harness = setup({ board, settings: { ...SETTINGS, needs: false, done: false } });
    await started(harness);
    harness.bridge.boardChanged();
    board.posts[0] = { ...claimed("p1"), blocked: "Which region?" };
    board.posts[1] = { ...claimed("p2"), state: "done" };
    harness.bridge.boardChanged();
    harness.bridge.tell(
      incidentNotice(
        {
          id: "i1",
          key: "SHOP-1",
          title: "Down",
          url: "https://x.test/1",
          foundAt: NOW,
          tracker: "jira",
        } as never,
        "Office 3D",
      ),
    );
    harness.bridge.settingsChanged({ ...SETTINGS, incidents: false, plan: false });
    harness.bridge.tell(planNotice("Claude", "weekly", 96, NOW, "Office 3D"));
    harness.bridge.tell(
      incidentNotice(
        {
          id: "i2",
          key: "SHOP-2",
          title: "Down",
          url: "https://x.test/2",
          foundAt: NOW,
          tracker: "jira",
        } as never,
        "Office 3D",
      ),
    );
    await until(() => harness.telegram.sent.length === 1);
    await settle();
    expect(harness.telegram.texts()).toEqual([
      "Office 3D: Incident SHOP-1\nDown\nhttps://x.test/1",
    ]);
  });

  test("an incident and a plan warning go as the webhook gets them; other notices do not", async () => {
    const harness = setup();
    await started(harness);
    harness.bridge.tell(planNotice("Claude", "weekly", 96, NOW, "Office 3D"));
    harness.bridge.tell(testNotice(NOW, "Office 3D"));
    await until(() => harness.telegram.sent.length === 1);
    await settle();
    expect(harness.telegram.sent).toEqual([
      {
        chat: String(CHAT),
        text: "Office 3D: Claude is at 96% of its weekly limit",
        messageId: 1000,
      },
    ]);
    // A notice names no task: a reply to it is answered as one to a task that is gone.
    expect(harness.store.state?.sent).toEqual([]);
  });

  test("nothing is sent while the bridge is not running", async () => {
    const board = fakeBoard([claimed("p1")]);
    const harness = setup({ board, settings: { ...SETTINGS, users: [] } });
    await harness.bridge.ready;
    harness.bridge.boardChanged();
    board.posts[0] = { ...claimed("p1"), blocked: "Which region?" };
    harness.bridge.boardChanged();
    harness.bridge.tell(planNotice("Claude", "weekly", 96, NOW, "Office 3D"));
    await settle();
    expect(harness.telegram.calls).toEqual([]);
    // Turned on later, it does not tell what happened while it was off.
    harness.bridge.settingsChanged(SETTINGS);
    await started(harness);
    harness.bridge.boardChanged();
    await settle();
    expect(harness.telegram.sent).toEqual([]);
  });

  test("a send that fails is not tried again, and is the bridge's problem until one goes through", async () => {
    const board = fakeBoard([claimed("p1"), claimed("p2")]);
    const harness = setup({ board });
    await started(harness);
    harness.bridge.boardChanged();
    harness.telegram.sendAnswers.push(
      unreachable(`https://api.telegram.org/bot${TOKEN}/sendMessage`),
    );
    board.posts[0] = { ...claimed("p1"), blocked: "Which region?" };
    harness.bridge.boardChanged();
    await until(() => harness.bridge.state().problem !== null);
    expect(harness.bridge.state().problem).toBe("Telegram could not be reached: ECONNREFUSED");
    harness.clock.advance(120_000);
    await settle();
    expect(harness.telegram.calls.filter((call) => call.method === "sendMessage")).toHaveLength(1);
    board.posts[1] = { ...claimed("p2"), state: "done" };
    harness.bridge.boardChanged();
    await until(() => harness.telegram.sent.length === 1);
    await until(() => harness.bridge.state().problem === null);
    harness.leakCheck();
  });
});

describe("a stalled claim", () => {
  const idleSince = new Date(NOW - 10 * 60_000).toISOString();
  const held = (id: string, holder: string, board = "lobby") =>
    post(id, {
      board,
      state: "claimed",
      claimedBy: holder,
      claimedAt: idleSince,
      updatedAt: idleSince,
    });

  test("is told once when the rule first holds, with its cause, checked every 60 s", async () => {
    const board = fakeBoard([held("p1", "a"), held("p2", "b"), held("p3", "c")]);
    const agents = new Map<string, DirectoryAgent>([
      ["a", { status: "running", title: "Builder" }],
      ["b", { status: "running", title: null }],
      ["c", { status: "running", title: "Tester" }],
    ]);
    const harness = setup({ board, agents });
    await started(harness);
    harness.clock.advance(60_000);
    await settle();
    expect(harness.telegram.sent).toEqual([]);
    agents.set("a", { status: "error", title: "Builder" });
    agents.set("b", { status: "closed", title: null });
    agents.set("c", { status: "idle", title: "Tester" });
    harness.clock.advance(59_999);
    await settle();
    expect(harness.telegram.sent).toEqual([]);
    harness.clock.advance(1);
    await until(() => harness.telegram.sent.length === 3);
    expect(harness.telegram.texts()).toEqual([
      "p1 is stalled — Builder stopped on an error\nTask p1",
      // With no title in the directory the board's name serves.
      "p2 is stalled — Reviewer is at home\nTask p2",
      "p3 is stalled — Tester is idle\nTask p3",
    ]);
    harness.clock.advance(60_000);
    await settle();
    expect(harness.telegram.sent).toHaveLength(3);
    // Once it stops holding, it may be told again.
    agents.set("a", { status: "running", title: "Builder" });
    harness.clock.advance(60_000);
    await settle();
    agents.set("a", { status: "error", title: "Builder" });
    harness.clock.advance(60_000);
    await until(() => harness.telegram.sent.length === 4);
    expect(harness.telegram.texts()[3]).toBe(
      "p1 is stalled — Builder stopped on an error\nTask p1",
    );
  });

  test("that stalls in the bridge's first minute is told at the first check", async () => {
    const board = fakeBoard([held("p1", "a")]);
    const agents = new Map<string, DirectoryAgent>([
      ["a", { status: "running", title: "Builder" }],
    ]);
    const harness = setup({ board, agents });
    await started(harness);
    harness.clock.advance(30_000);
    agents.set("a", { status: "error", title: "Builder" });
    harness.clock.advance(30_000);
    await until(() => harness.telegram.sent.length === 1);
    expect(harness.telegram.texts()).toEqual([
      "p1 is stalled — Builder stopped on an error\nTask p1",
    ]);
  });

  test("on the duty board is told, as a blocked duty is; a duty done is not", async () => {
    const board = fakeBoard(["p1", "p2", "p3", "p4"].map((id) => held(id, "a", "duty")));
    const agents = new Map<string, DirectoryAgent>([
      ["a", { status: "running", title: "Builder" }],
    ]);
    const harness = setup({ board, agents });
    await started(harness);
    board.posts[0] = { ...(board.posts[0] as Post), blocked: "Which plant?" };
    board.posts[1] = { ...(board.posts[1] as Post), state: "done", result: "Watered" };
    board.posts[2] = { ...(board.posts[2] as Post), state: "done" };
    harness.bridge.boardChanged();
    agents.set("a", { status: "error", title: "Builder" });
    harness.clock.advance(60_000);
    await until(() => harness.telegram.sent.length === 2);
    await settle();
    expect(harness.telegram.texts()).toEqual([
      "p1 needs you — Builder: Which plant?\nTask p1",
      "p4 is stalled — Builder stopped on an error\nTask p4",
    ]);
  });

  test("a claim already stalled when the bridge starts is not told", async () => {
    const board = fakeBoard([held("p1", "a")]);
    const agents = new Map<string, DirectoryAgent>([["a", { status: "error", title: "Builder" }]]);
    const harness = setup({ board, agents });
    await started(harness);
    harness.clock.advance(180_000);
    await settle();
    expect(harness.telegram.sent).toEqual([]);
  });

  test("without the directory none is told, and the switch keeps them quiet", async () => {
    const board = fakeBoard([held("p1", "a")]);
    const harness = setup({ board, agents: null });
    await started(harness);
    harness.clock.advance(60_000);
    harness.directory.agents = new Map([["a", { status: "running", title: "Builder" }]]);
    harness.clock.advance(60_000);
    harness.directory.agents = null;
    harness.clock.advance(60_000);
    await settle();
    expect(harness.telegram.sent).toEqual([]);
    harness.directory.agents = new Map([["a", { status: "error", title: "Builder" }]]);
    harness.bridge.settingsChanged({ ...SETTINGS, stalled: false });
    harness.clock.advance(60_000);
    await settle();
    expect(harness.telegram.sent).toEqual([]);
  });
});

describe("a reply", () => {
  function toolContext(id: string, title: string): AgentToolContext {
    return {
      agent: {
        id,
        workspaceId: null,
        parentAgentId: null,
        provider: "claude",
        cwd: "/",
        title,
        metadata: {},
        background: false,
      },
      paseo: undefined as unknown as AgentToolContext["paseo"],
      signal: new AbortController().signal,
    };
  }

  function realOffice(clock: FakeClock, initial: BoardsFile) {
    let current = initial;
    const store: BoardStore = {
      load: async () => current,
      save: async (data) => {
        current = data;
      },
    };
    const prompts: string[] = [];
    const listeners: (() => void)[] = [];
    const office = createOffice({
      store,
      clock,
      hub: { setBoards: () => {}, setBoard: () => {}, removeBoard: () => {}, setWake: () => {} },
      onChange: () => {
        for (const listener of listeners) listener();
      },
      log: () => {},
      agents: {
        lobbyCandidates: async () => [],
        lobbyEligible: async () => false,
        status: async () => "wakeable",
        resolve: async (id) => id,
        workspaceOf: async () => null,
        send: async (agentId, prompt) => {
          prompts.push(`${agentId}: ${prompt}`);
        },
        teamOf: async () => null,
        findTeam: async () => null,
        teamName: () => null,
        costOf: () => undefined,
        working: () => false,
      },
    });
    return { office, prompts, listeners, current: () => current };
  }

  test("to a task's message answers it: posted under the task as the user's, which unblocks it and wakes its holder", async () => {
    const clock = createFakeClock(NOW);
    const { office, prompts, listeners, current } = realOffice(clock, {
      ...EMPTY_BOARDS,
      nextSeq: 2,
      posts: [post("p1", { state: "claimed", claimedBy: "b", seq: 1 })],
    });
    const harness = setup({ clock, board: office });
    listeners.push(() => harness.bridge.boardChanged());
    await office.ready;
    await started(harness);
    office.noteAgent({ id: "b", workspaceId: null, title: "Reviewer" });
    const officeUpdate = office.tools.find((tool) => tool.name === "office_update");
    await officeUpdate?.execute(
      { id: "p1", action: "block", note: "Which region?" },
      toolContext("b", "Reviewer"),
    );
    await until(() => harness.telegram.sent.length === 1);
    const asked = harness.telegram.sent[0];
    expect(asked?.text).toBe("p1 needs you — Reviewer: Which region?\nTask p1");
    harness.telegram.push(inChat(OWNER, "eu-west-1\u0007 please\tnow", asked?.messageId));
    await until(() => harness.telegram.sent.length === 2);
    expect(harness.telegram.sent[1]).toMatchObject({ chat: CHAT, text: "Posted under p1." });
    const task = current().posts.find((item) => item.id === "p1");
    expect(task).toMatchObject({ state: "claimed", claimedBy: "b" });
    expect(task).not.toHaveProperty("blocked");
    expect(current().posts.find((item) => item.replyTo === "p1")).toMatchObject({
      kind: "note",
      author: "user",
      text: "eu-west-1 please\tnow",
      to: "b",
    });
    clock.advance(0);
    await until(() => prompts.length > 0);
    expect(prompts[0]).toContain("eu-west-1");
    await office.stop();
  });

  test("the answer to a reply is the board's refusal when it refuses", async () => {
    const board = fakeBoard([post("p1")]);
    const store = memoryTelegramStore(undefined, {
      version: 1,
      bot: BOT,
      offset: 1,
      sent: [{ chat: String(CHAT), messageId: 900, postId: "p1" }],
      taskTimes: [],
    });
    const harness = setup({ board, store });
    await started(harness);
    harness.telegram.push(inChat(OWNER, "  \u0001 ", 900));
    await until(() => harness.telegram.sent.length === 1);
    expect(harness.telegram.texts()).toEqual(["Unable to post: the text is empty"]);
  });

  test("to a message the bridge does not know, or whose task is gone, says the task is gone", async () => {
    const board = fakeBoard([post("p1")]);
    const store = memoryTelegramStore(undefined, {
      version: 1,
      bot: BOT,
      offset: 1,
      sent: [
        { chat: String(CHAT), messageId: 900, postId: "p1" },
        { chat: String(CHAT), messageId: 901, postId: "p7" },
      ],
      taskTimes: [],
    });
    const harness = setup({ board, store });
    await started(harness);
    harness.telegram.push(inChat(OWNER, "answer", 555), inChat(OWNER, "answer", 901));
    await until(() => harness.telegram.sent.length === 2);
    expect(harness.telegram.texts()).toEqual([GONE, GONE]);
    expect(board.posted).toEqual([]);
  });

  test("is matched in its own chat: the same message id in another chat names no task", async () => {
    const board = fakeBoard([post("p1", { state: "claimed", claimedBy: "a", blocked: "Which?" })]);
    // A pair from the chat the office wrote to before the owner moved it.
    const store = memoryTelegramStore(undefined, {
      version: 1,
      bot: BOT,
      offset: 1,
      sent: [{ chat: "-4004", messageId: 900, postId: "p1" }],
      taskTimes: [],
    });
    const harness = setup({ board, store });
    await started(harness);
    harness.telegram.push(inChat(OWNER, "go ahead", 900));
    await until(() => harness.telegram.sent.length === 1);
    expect(harness.telegram.texts()).toEqual([GONE]);
    expect(board.posted).toEqual([]);
  });

  test("in a private chat is matched against the private chat's own messages", async () => {
    const board = fakeBoard([post("p1")]);
    // The group's message 900 names p1; the private chat's message 900 is another message.
    const store = memoryTelegramStore(undefined, {
      version: 1,
      bot: BOT,
      offset: 1,
      sent: [{ chat: String(CHAT), messageId: 900, postId: "p1" }],
      taskTimes: [],
    });
    const harness = setup({ board, store });
    await started(harness);
    harness.telegram.push(
      update({
        from: { id: OWNER },
        chat: { id: OWNER, type: "private" },
        text: "x",
        replyTo: 900,
      }),
    );
    await until(() => harness.telegram.sent.length === 1);
    expect(harness.telegram.texts()).toEqual([GONE]);
    expect(board.posted).toEqual([]);
  });

  test("in a private chat to the bridge's own message about a task is posted under that task", async () => {
    const board = fakeBoard();
    const harness = setup({ board });
    await started(harness);
    harness.telegram.push(inPrivate(FRIEND, "/task Fix the ledger"));
    await until(() => harness.telegram.sent.length === 1);
    const answer = harness.telegram.sent[0];
    expect(answer).toMatchObject({ chat: FRIEND, text: "Posted p100 to the backlog." });
    expect(harness.store.state?.sent).toEqual([
      { chat: String(FRIEND), messageId: answer?.messageId, postId: "p100" },
    ]);
    harness.telegram.push(
      update({
        from: { id: FRIEND },
        chat: { id: FRIEND, type: "private" },
        text: "Use the March figures",
        replyTo: answer?.messageId,
      }),
    );
    await until(() => harness.telegram.sent.length === 2);
    expect(harness.telegram.texts()[1]).toBe("Posted under p100.");
    expect(board.posted.at(-1)).toEqual({
      board: "lobby",
      kind: "note",
      text: "Use the March figures",
      replyTo: "p100",
    });
  });

  test("forwarded is not acted on: its words are someone else's", async () => {
    const board = fakeBoard([post("p1")]);
    const store = memoryTelegramStore(undefined, {
      version: 1,
      bot: BOT,
      offset: 1,
      sent: [{ chat: String(CHAT), messageId: 900, postId: "p1" }],
      taskTimes: [],
    });
    const harness = setup({ board, store });
    await started(harness);
    const forwarded = (fields: MessageFields, how: Record<string, unknown>) => {
      const raw = update(fields);
      Object.assign(raw.message as object, how);
      return raw;
    };
    harness.telegram.push(
      forwarded({ text: "/task rm -rf /" }, { forward_origin: { type: "hidden_user", date: 1 } }),
      forwarded({ text: "go ahead", replyTo: 900 }, { forward_date: 1 }),
    );
    await until(() => harness.telegram.sent.length === 2);
    expect(harness.telegram.texts()).toEqual([HELP, HELP]);
    expect(board.posted).toEqual([]);
    expect(harness.bridge.state().dropped).toBe(0);
  });

  test("after a restart still finds the task its message named", async () => {
    const board = fakeBoard([post("p1", { state: "claimed", claimedBy: "a" })]);
    const clock = createFakeClock(NOW);
    const store = memoryTelegramStore();
    const first = setup({ board, store, clock });
    await started(first);
    first.bridge.boardChanged();
    board.posts[0] = { ...(board.posts[0] as Post), blocked: "Which region?" };
    first.bridge.boardChanged();
    await until(() => first.telegram.sent.length === 1);
    await until(() => store.state?.sent.length === 1);
    await first.bridge.stop();
    const second = setup({ board, store, clock });
    await started(second);
    second.telegram.push(inChat(OWNER, "eu-west-1", first.telegram.sent[0]?.messageId));
    await until(() => second.telegram.sent.length === 1);
    expect(second.telegram.texts()).toEqual(["Posted under p1."]);
    expect(board.posted).toEqual([
      { board: "lobby", kind: "note", text: "eu-west-1", replyTo: "p1" },
    ]);
  });
});

describe("/task", () => {
  test("posts a lobby task as the user, held in the backlog, and answers with its id", async () => {
    const board = fakeBoard();
    const harness = setup({ board });
    await started(harness);
    harness.telegram.push(inChat(OWNER, "/task  Fix the\u0000 ledger\ntotal "));
    await until(() => harness.telegram.sent.length === 1);
    expect(board.posted).toEqual([
      { board: "lobby", kind: "task", text: "Fix the ledger\ntotal", backlog: true },
    ]);
    expect(harness.telegram.texts()).toEqual(["Posted p100 to the backlog."]);
    // A reply to the answer is a reply to the task.
    expect(harness.store.state?.sent).toEqual([
      { chat: String(CHAT), messageId: 1000, postId: "p100" },
    ]);
  });

  test("lands in To do when the setting says so, and takes the bot's name after the command", async () => {
    const board = fakeBoard();
    const harness = setup({ board, settings: { ...SETTINGS, lands: "todo" } });
    await started(harness);
    harness.telegram.push(inPrivate(OWNER, "/task@office_bot Ship it"));
    await until(() => harness.telegram.sent.length === 1);
    expect(board.posted).toEqual([{ board: "lobby", kind: "task", text: "Ship it" }]);
    expect(harness.telegram.texts()).toEqual(["Posted p100."]);
  });

  test("for another bot is left alone, unanswered; one for this bot is taken whatever its case", async () => {
    const board = fakeBoard();
    const harness = setup({ board });
    await started(harness);
    harness.telegram.push(
      inChat(OWNER, "/task@other_bot Ship it"),
      inChat(OWNER, "/board@other_bot"),
      inChat(OWNER, "/start@other_bot"),
      inChat(OWNER, "/task@OFFICE_BOT Ship this"),
    );
    await until(() => harness.telegram.sent.length === 1);
    await settle();
    expect(harness.telegram.texts()).toEqual(["Posted p100 to the backlog."]);
    expect(board.posted.map((input) => input.text)).toEqual(["Ship this"]);
    expect(harness.bridge.state().dropped).toBe(0);
  });

  test("with the bot's name unknown takes only the bare command", async () => {
    const board = fakeBoard();
    const clock = createFakeClock(NOW);
    const telegram = fakeTelegram(clock);
    telegram.meAnswers.push(() => refusal(502));
    const harness = setup({ board, clock, telegram });
    await started(harness);
    harness.telegram.push(inChat(OWNER, "/task@office_bot first"), inChat(OWNER, "/task second"));
    await until(() => harness.telegram.sent.length === 1);
    await settle();
    expect(board.posted.map((input) => input.text)).toEqual(["second"]);
    // Learning the name is best effort: it is no problem of the bridge's.
    expect(harness.bridge.state().problem).toBeNull();
  });

  test("with no text says how to use it, and posts nothing", async () => {
    const board = fakeBoard();
    const harness = setup({ board });
    await started(harness);
    harness.telegram.push(inChat(OWNER, "/task"), inChat(OWNER, "/task@office_bot   "));
    await until(() => harness.telegram.sent.length === 2);
    expect(harness.telegram.texts()).toEqual([
      "Usage: /task <what to do>",
      "Usage: /task <what to do>",
    ]);
    expect(board.posted).toEqual([]);
  });

  test("posts at most 20 tasks an hour from Telegram in all", async () => {
    const board = fakeBoard();
    const harness = setup({ board });
    await started(harness);
    for (let index = 0; index < 20; index += 1) {
      harness.telegram.push(inChat(index % 2 === 0 ? OWNER : FRIEND, `/task t${index}`));
    }
    harness.telegram.push(inPrivate(FRIEND, "/task one too many"));
    await until(() => harness.telegram.sent.length === 21);
    expect(board.posted).toHaveLength(20);
    expect(harness.telegram.texts()[20]).toBe("Too many tasks this hour: wait a little.");
    expect(harness.store.state?.taskTimes).toHaveLength(20);
    harness.clock.advance(60 * 60_000);
    harness.telegram.push(inChat(OWNER, "/task next hour"));
    await until(() => harness.telegram.sent.length === 22);
    expect(board.posted).toHaveLength(21);
    expect(harness.store.state?.taskTimes).toEqual([NOW + 60 * 60_000]);
  });
});

test("/board answers the lobby's counts and its first 20 tasks not done, blocked first", async () => {
  const posts = [
    post("p1", { state: "claimed", claimedBy: "a", text: "In progress one" }),
    post("p2", { state: "claimed", claimedBy: "a", blocked: "Which?", text: "Blocked one" }),
    post("p3", { after: ["p1"], text: "Waits on p1" }),
    post("p4", { text: "To do one" }),
    post("p5", { backlog: true, text: `Held ${"x".repeat(100)}` }),
    post("p6", { state: "done", text: "Done one" }),
    post("p7", { board: "w1", text: "A room's" }),
    post("p8", { kind: "note", state: undefined, text: "A note" }),
    ...Array.from({ length: 20 }, (_, index) => post(`p${20 + index}`, { text: `More ${index}` })),
  ];
  const harness = setup({ board: fakeBoard(posts) });
  await started(harness);
  harness.telegram.push(inChat(OWNER, "/board"));
  await until(() => harness.telegram.sent.length === 1);
  const lines = (harness.telegram.texts()[0] ?? "").split("\n");
  expect(lines[0]).toBe("Lobby: 1 in progress, 1 needs you, 1 waiting, 21 to do, 1 in the backlog");
  expect(lines.slice(1, 6)).toEqual([
    "p2 needs you: Blocked one",
    "p1 in progress: In progress one",
    "p3 waiting: Waits on p1",
    "p4 to do: To do one",
    "p20 to do: More 0",
  ]);
  expect(lines).toHaveLength(21);
  harness.telegram.push(inChat(OWNER, "/board@office_bot"));
  await until(() => harness.telegram.sent.length === 2);
  expect(harness.telegram.texts()[1]).toBe(harness.telegram.texts()[0]);
});

test("/board shows a held task last, its text cut to 80", async () => {
  const harness = setup({
    board: fakeBoard([post("p5", { backlog: true, text: "y".repeat(100) })]),
  });
  await started(harness);
  harness.telegram.push(inChat(OWNER, "/board"));
  await until(() => harness.telegram.sent.length === 1);
  expect(harness.telegram.texts()[0]).toBe(
    `Lobby: 0 in progress, 0 needs you, 0 waiting, 0 to do, 1 in the backlog\np5 backlog: ${"y".repeat(79)}…`,
  );
});

describe("the offset", () => {
  test("is saved before each update is handled, so a crash in the middle handles nothing twice", async () => {
    const clock = createFakeClock(NOW);
    const store = memoryTelegramStore();
    const board = fakeBoard();
    const telegram = fakeTelegram(clock);
    const first = setup({ clock, store, board, telegram });
    // It dies in the middle of a post: nothing stops it.
    running.splice(running.indexOf(first.bridge), 1);
    await started(first);
    const one = inChat(OWNER, "/task one");
    const two = inChat(OWNER, "/task two");
    const three = inChat(OWNER, "/task three");
    telegram.push(one);
    await until(() => telegram.sent.length === 1);
    // The second post never finishes: the daemon dies there.
    board.holdNext(new Promise(() => {}));
    telegram.push(two, three);
    await until(() => board.posted.length === 2);
    expect(store.saves.map((saved) => saved.offset)).toContain(one.update_id + 1);
    expect(store.state?.offset).toBe(two.update_id + 1);
    // A new daemon, the same files and the same Telegram, which still holds what was not confirmed.
    const second = setup({ clock, store, board, telegram: fakeTelegram(clock) });
    second.telegram.push(two, three);
    await started(second);
    await until(() => board.posted.length === 3);
    await settle();
    expect(board.posted.map((input) => input.text)).toEqual(["one", "two", "three"]);
    expect(second.telegram.polls()[0]?.body).toMatchObject({ offset: two.update_id + 1 });
    expect(store.state?.offset).toBe(three.update_id + 1);
  });

  test("an update below the offset is not handled again", async () => {
    const store = memoryTelegramStore(undefined, {
      version: 1,
      bot: BOT,
      offset: 50,
      sent: [],
      taskTimes: [],
    });
    const harness = setup({ store });
    harness.telegram.pollAnswers.push(() =>
      ok([
        {
          update_id: 49,
          message: {
            message_id: 1,
            from: { id: OWNER, is_bot: false },
            chat: { id: CHAT, type: "group" },
            text: "/task old",
          },
        },
      ]),
    );
    await started(harness, 2);
    await settle();
    expect(harness.board).toMatchObject({ posted: [] });
  });
});

describe("when Telegram fails", () => {
  const pollTimes = (harness: ReturnType<typeof setup>) =>
    harness.telegram.polls().map((call) => call.at - NOW);

  test("a network failure or a 5xx waits 5 s, doubling to 60 s, and a poll that works starts again at 5 s", async () => {
    const harness = setup();
    const url = `https://api.telegram.org/bot${TOKEN}/getUpdates`;
    harness.telegram.pollAnswers.push(
      unreachable(url),
      () => refusal(502),
      unreachable(url),
      () => refusal(500),
      unreachable(url),
      unreachable(url),
      () => ok([]),
      unreachable(url),
    );
    await started(harness);
    const steps = [
      [5_000, 2],
      [10_000, 3],
      [20_000, 4],
      [40_000, 5],
      [60_000, 6],
      // The poll that works is followed at once by the next, which fails.
      [60_000, 8],
      [5_000, 9],
    ] as const;
    for (const [wait, polls] of steps) {
      // The failure is read, and its wait set, before time moves.
      await settle();
      harness.clock.advance(wait - 1);
      await settle();
      expect(harness.telegram.polls()).toHaveLength(polls - (polls === 8 ? 2 : 1));
      harness.clock.advance(1);
      await until(() => harness.telegram.polls().length === polls);
    }
    expect(pollTimes(harness)).toEqual([
      0, 5_000, 15_000, 35_000, 75_000, 135_000, 195_000, 195_000, 200_000,
    ]);
    harness.leakCheck();
  });

  test("a failure is the bridge's problem, logged once, in words that hold no token", async () => {
    const harness = setup();
    const url = `https://api.telegram.org/bot${TOKEN}/getUpdates`;
    harness.telegram.pollAnswers.push(unreachable(url), unreachable(url));
    await started(harness);
    await until(() => harness.bridge.state().problem !== null);
    expect(harness.bridge.state()).toMatchObject({
      on: true,
      problem: "Telegram could not be reached: ECONNREFUSED",
    });
    harness.clock.advance(5_000);
    await until(() => harness.telegram.polls().length === 2);
    await settle();
    expect(harness.logs.filter((line) => line.includes("ECONNREFUSED"))).toHaveLength(1);
    harness.leakCheck();
  });

  test("a refused token (401 or 404) stops the bridge until the settings or the token change", async () => {
    for (const status of [401, 404]) {
      const harness = setup();
      harness.telegram.pollAnswers.push(() => refusal(status));
      await started(harness);
      await until(() => harness.bridge.state().problem !== null);
      expect(harness.bridge.state()).toMatchObject({
        on: false,
        problem: "Telegram refused the token",
      });
      harness.clock.advance(10 * 60_000);
      await settle();
      expect(harness.telegram.polls()).toHaveLength(1);
      harness.bridge.settingsChanged({ ...SETTINGS });
      await until(() => harness.telegram.polls().length === 2);
      expect(harness.bridge.state()).toMatchObject({ on: true, problem: null });
      harness.leakCheck();
    }
  });

  test("another program polling the bot (409) waits 60 s, and says so", async () => {
    const harness = setup();
    harness.telegram.pollAnswers.push(() => refusal(409));
    await started(harness);
    await until(() => harness.bridge.state().problem !== null);
    expect(harness.bridge.state().problem).toBe("Another program is reading this bot");
    harness.clock.advance(59_999);
    await settle();
    expect(harness.telegram.polls()).toHaveLength(1);
    harness.clock.advance(1);
    await until(() => harness.telegram.polls().length === 2);
  });

  test("too many requests (429) waits what Telegram asks, 60 s at most", async () => {
    const harness = setup();
    harness.telegram.pollAnswers.push(
      () => refusal(429, { parameters: { retry_after: 7 } }),
      () => refusal(429, { parameters: { retry_after: 600 } }),
    );
    await started(harness);
    await settle();
    harness.clock.advance(6_999);
    await settle();
    expect(harness.telegram.polls()).toHaveLength(1);
    harness.clock.advance(1);
    await until(() => harness.telegram.polls().length === 2);
    await settle();
    harness.clock.advance(59_999);
    await settle();
    expect(harness.telegram.polls()).toHaveLength(2);
    harness.clock.advance(1);
    await until(() => harness.telegram.polls().length === 3);
    expect(pollTimes(harness)).toEqual([0, 7_000, 67_000]);
  });
});

describe("a change", () => {
  test("of the settings aborts the running poll and starts again with them", async () => {
    const harness = setup();
    await started(harness);
    harness.bridge.settingsChanged({ ...SETTINGS, chat: "-3003" });
    await until(() => harness.telegram.polls().length === 2);
    harness.telegram.push(
      update({ from: { id: OWNER }, chat: { id: -3003, type: "group" }, text: "hi" }),
    );
    await until(() => harness.telegram.sent.length === 1);
    expect(harness.telegram.sent[0]?.chat).toBe(-3003);
    // The old chat is no longer heard.
    harness.telegram.push(inChat(OWNER, "hi"));
    await until(() => harness.bridge.state().dropped === 1);
  });

  test("that leaves no user, or settings that cannot be read, stops it", async () => {
    const harness = setup();
    await started(harness);
    harness.bridge.settingsChanged({ ...SETTINGS, users: [] });
    await settle();
    expect(harness.bridge.state().on).toBe(false);
    harness.bridge.settingsChanged(SETTINGS);
    await until(() => harness.telegram.polls().length === 2);
    harness.bridge.settingsChanged(null);
    await settle();
    expect(harness.bridge.state().on).toBe(false);
    harness.telegram.push(inChat(OWNER, "/task nobody hears this"));
    await settle();
    expect(harness.board).toMatchObject({ posted: [] });
  });

  test("stop aborts the poll, and nothing runs after it", async () => {
    const harness = setup();
    await started(harness);
    await harness.bridge.stop();
    harness.telegram.push(inChat(OWNER, "/task after the stop"));
    harness.clock.advance(10 * 60_000);
    await settle();
    expect(harness.telegram.polls()).toHaveLength(1);
    expect(harness.board).toMatchObject({ posted: [] });
  });
});

describe("the token's save and test", () => {
  test("a saved token is kept, never answered, and the bridge starts again with it", async () => {
    const store = memoryTelegramStore(NO_SAVED_TOKEN);
    const harness = setup({ store });
    await harness.bridge.ready;
    const state = await harness.bridge.save(`  ${OTHER_TOKEN} `);
    expect(state).toEqual({ on: true, source: "saved", problem: null, dropped: 0 });
    expect(JSON.stringify(state)).not.toContain(OTHER_TOKEN);
    expect(store.token).toEqual({ token: OTHER_TOKEN, unreadable: false });
    await until(() => harness.telegram.polls().length >= 1);
    expect(harness.telegram.polls()[0]?.url).toContain(OTHER_TOKEN);
    harness.leakCheck();
  });

  test("a token of another bot starts it as a first run: the old bot's offset means nothing to it", async () => {
    const store = memoryTelegramStore();
    const harness = setup({ store });
    await started(harness);
    await harness.bridge.save(OTHER_TOKEN);
    await until(() => harness.telegram.polls().length >= 2);
    expect(harness.telegram.polls()[1]).toMatchObject({ body: { offset: -1 } });
    expect(harness.telegram.polls()[1]?.url).toContain(OTHER_TOKEN);
  });

  test("an empty token removes the saved one, and the environment's serves again", async () => {
    const store = memoryTelegramStore();
    const harness = setup({ store, env: { TELEGRAM_BOT_TOKEN: OTHER_TOKEN } });
    await started(harness);
    expect(await harness.bridge.save("")).toMatchObject({ source: "env" });
    expect(store.token).toEqual(NO_SAVED_TOKEN);
    const none = setup({ store: memoryTelegramStore() });
    await started(none);
    expect(await none.bridge.save("  ")).toEqual({
      on: false,
      source: null,
      problem: null,
      dropped: 0,
    });
  });

  test("a token of another shape is refused in words that do not quote it", async () => {
    const store = memoryTelegramStore(NO_SAVED_TOKEN);
    const harness = setup({ store });
    const odd = `${TOKEN}/../sendMessage?x=`;
    await expect(harness.bridge.save(odd)).rejects.toThrow(
      "That is not a bot token: BotFather gives one as digits, a colon and letters",
    );
    await harness.bridge.save(odd).catch((error: Error) => {
      expect(error.message).not.toContain(TOKEN);
    });
    expect(store.token).toEqual(NO_SAVED_TOKEN);
  });

  test("the test asks who the bot is and writes to the chat", async () => {
    const harness = setup();
    await started(harness);
    expect(await harness.bridge.test()).toEqual({ ok: true, bot: "office_bot" });
    expect(harness.telegram.calls.map((call) => call.method)).toContain("getMe");
    expect(harness.telegram.sent).toEqual([
      { chat: String(CHAT), text: "The office is connected.", messageId: 1000 },
    ]);
  });

  test("the test says why it cannot work, and what Telegram refused, without the token", async () => {
    const none = setup({ store: memoryTelegramStore(NO_SAVED_TOKEN) });
    expect(await none.bridge.test()).toEqual({
      ok: false,
      problem: "No bot token: save one, or set TELEGRAM_BOT_TOKEN",
    });
    const noChat = setup({ settings: { ...SETTINGS, chat: "" } });
    expect(await noChat.bridge.test()).toEqual({ ok: false, problem: "Set the chat id first" });
    const refused = setup({ settings: { ...SETTINGS, users: [] } });
    refused.telegram.sendAnswers.push(() => refusal(400));
    expect(await refused.bridge.test()).toEqual({
      ok: false,
      problem:
        "Telegram refused the message (HTTP 400): check the chat id, and that the bot is in that chat",
    });
    refused.leakCheck();
  });
});
