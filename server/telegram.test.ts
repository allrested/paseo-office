import { expect, test } from "vitest";
import { BOT_TOKEN, createTelegramApi, POLL_SECONDS, TelegramProblem } from "./telegram.js";

const TOKEN = "123456789:AAH-secret_token_value_0123456789abcd";

interface Call {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function setup(answer: (call: Call) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const call = { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> };
    calls.push(call);
    return answer(call);
  }) as unknown as typeof fetch;
  return { api: createTelegramApi(TOKEN, fetchFn), calls };
}

const ok = (result: unknown, status = 200) =>
  new Response(JSON.stringify({ ok: true, result }), { status });
const refused = (status: number, extra: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({ ok: false, error_code: status, description: `x ${TOKEN}`, ...extra }),
    {
      status,
    },
  );

/** Every way a failure can be said, so a test can look for the token in all of them. */
async function failure(run: () => Promise<unknown>): Promise<TelegramProblem> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(TelegramProblem);
    const problem = error as TelegramProblem;
    expect(`${problem.message} ${String(problem.stack)} ${JSON.stringify(problem)}`).not.toContain(
      TOKEN,
    );
    expect(problem.cause).toBeUndefined();
    return problem;
  }
  throw new Error("expected a failure");
}

test("a bot token is digits, a colon and the secret; nothing that could change the address", () => {
  expect(BOT_TOKEN.test(TOKEN)).toBe(true);
  for (const bad of [
    "",
    "123",
    "abc:defghijklmnopqrstuvwxyz",
    `${TOKEN}/x`,
    `${TOKEN}?a`,
    ` ${TOKEN}`,
  ]) {
    expect(BOT_TOKEN.test(bad), bad).toBe(false);
  }
});

test("getUpdates long-polls for messages only, from the offset, and reads each update", async () => {
  const { api, calls } = setup(() =>
    ok([
      {
        update_id: 7,
        message: {
          message_id: 41,
          from: { id: 5, is_bot: false, first_name: "Ann" },
          chat: { id: -100, type: "supergroup" },
          text: "hello",
          reply_to_message: { message_id: 40 },
        },
      },
      { update_id: 8, edited_message: { message_id: 41 } },
      { update_id: 9, message: { message_id: 42, chat: { id: 5, type: "private" } } },
      { update_id: 10, message: "nonsense" },
      { nothing: true },
    ]),
  );
  const updates = await api.getUpdates(
    { offset: 7, timeoutS: POLL_SECONDS },
    new AbortController().signal,
  );
  expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
  expect(calls[0]?.body).toEqual({ offset: 7, timeout: 25, allowed_updates: ["message"] });
  expect(calls[0]?.init).toMatchObject({ method: "POST", redirect: "manual" });
  expect(updates).toEqual([
    {
      updateId: 7,
      message: {
        messageId: 41,
        from: { id: 5, isBot: false },
        chat: { id: -100, type: "supergroup" },
        text: "hello",
        replyTo: 40,
      },
    },
    { updateId: 8, message: null },
    {
      updateId: 9,
      message: {
        messageId: 42,
        from: null,
        chat: { id: 5, type: "private" },
        text: null,
        replyTo: null,
      },
    },
    {
      updateId: 10,
      message: { messageId: 0, from: null, chat: null, text: null, replyTo: null },
    },
  ]);
});

test("with no offset none is sent", async () => {
  const { api, calls } = setup(() => ok([]));
  await api.getUpdates({ offset: null, timeoutS: 0 }, new AbortController().signal);
  expect(calls[0]?.body).toEqual({ timeout: 0, allowed_updates: ["message"] });
});

test("sendMessage sends plain text with no link preview and answers the message's id", async () => {
  const { api, calls } = setup(() => ok({ message_id: 77, chat: { id: -100 } }));
  expect(await api.sendMessage("-100", "p1 needs you")).toBe(77);
  expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
  expect(calls[0]?.body).toEqual({
    chat_id: "-100",
    text: "p1 needs you",
    disable_web_page_preview: true,
  });
  expect(calls[0]?.body).not.toHaveProperty("parse_mode");
});

test("getMe answers the bot's username", async () => {
  const { api } = setup(() => ok({ id: 1, is_bot: true, username: "office_bot" }));
  expect(await api.getMe()).toBe("office_bot");
});

test("each refusal is said in the office's own words, never Telegram's or the token", async () => {
  const signal = new AbortController().signal;
  const poll = (response: Response) =>
    failure(() => setup(() => response).api.getUpdates({ offset: 1, timeoutS: 25 }, signal));
  expect(await poll(refused(401))).toMatchObject({
    failure: "token",
    message: "Telegram refused the token",
  });
  expect(await poll(refused(404))).toMatchObject({ failure: "token" });
  expect(await poll(refused(409))).toMatchObject({
    failure: "conflict",
    message: "Another program is reading this bot",
  });
  expect(await poll(refused(429, { parameters: { retry_after: 12 } }))).toMatchObject({
    failure: "rate",
    retryAfterS: 12,
  });
  expect(await poll(refused(429))).toMatchObject({ failure: "rate", retryAfterS: null });
  expect(await poll(refused(502))).toMatchObject({
    failure: "server",
    message: "Telegram answered HTTP 502",
  });
  expect(
    await poll(new Response("", { status: 302, headers: { location: "https://x.test" } })),
  ).toMatchObject({
    failure: "refused",
    message: "Telegram answered with a redirect (HTTP 302)",
  });
  expect(await poll(new Response("<html>"))).toMatchObject({
    failure: "shape",
    message: "Telegram answered in a shape the office does not read",
  });
  expect(await poll(refused(400))).toMatchObject({
    failure: "refused",
    message: "Telegram refused the request (HTTP 400)",
  });
  const send = (response: Response) =>
    failure(() => setup(() => response).api.sendMessage("-100", "hi"));
  expect((await send(refused(400))).message).toBe(
    "Telegram refused the message (HTTP 400): check the chat id, and that the bot is in that chat",
  );
  expect((await send(refused(403))).message).toBe(
    "Telegram refused the message (HTTP 403): the bot may not write to that chat",
  );
});

test("a request that fails is said by its code alone: its error holds the address, and so the token", async () => {
  const signal = new AbortController().signal;
  const thrown = (error: unknown) =>
    failure(() =>
      setup(() => {
        throw error;
      }).api.getUpdates({ offset: 1, timeoutS: 25 }, signal),
    );
  const coded = Object.assign(
    new TypeError(`fetch failed https://api.telegram.org/bot${TOKEN}/getUpdates`),
    {
      cause: Object.assign(new Error(`connect ECONNREFUSED ${TOKEN}`), { code: "ECONNREFUSED" }),
    },
  );
  expect(await thrown(coded)).toMatchObject({
    failure: "network",
    message: "Telegram could not be reached: ECONNREFUSED",
  });
  const odd = Object.assign(new Error(`bad ${TOKEN}`), { cause: { code: `X${TOKEN}` } });
  expect(await thrown(odd)).toMatchObject({
    failure: "network",
    message: "Telegram could not be reached",
  });
  expect(await thrown(new DOMException(`slow ${TOKEN}`, "TimeoutError"))).toMatchObject({
    failure: "timeout",
    message: "Telegram did not answer in 35 s",
  });
});

test("an aborted poll is said as stopped", async () => {
  const controller = new AbortController();
  const { api } = setup(
    (call) =>
      new Promise<Response>((_resolve, reject) => {
        call.init.signal?.addEventListener("abort", () =>
          reject(new DOMException(`aborted ${TOKEN}`, "AbortError")),
        );
      }),
  );
  const polling = failure(() => api.getUpdates({ offset: 1, timeoutS: 25 }, controller.signal));
  controller.abort();
  expect(await polling).toMatchObject({ failure: "aborted" });
});

test("an answer over 5,000,000 bytes is refused without reading it all", async () => {
  const big = new Response("x", { headers: { "content-length": "5000001" } });
  expect(await failure(() => setup(() => big).api.getMe())).toMatchObject({
    failure: "server",
    message: "Telegram answered with too much data",
  });
});
