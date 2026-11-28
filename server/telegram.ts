import { z } from "zod";
import { cappedText, TrackerProblem } from "./incidents-http.js";
import { NETWORK_ERRORS } from "./notify.js";

/** How long Telegram holds a poll open when nothing comes. */
export const POLL_SECONDS = 25;
/** A poll's own limit: Telegram's hold and some time for the answer. */
export const POLL_TIMEOUT_MS = 35_000;
const CALL_TIMEOUT_MS = 30_000;

/**
 * A bot's token as BotFather gives it. It goes into the address's path, so nothing else is taken:
 * a slash or a question mark would point the request, and the token, somewhere else.
 */
export const BOT_TOKEN = /^\d{1,20}:[A-Za-z0-9_-]{20,100}$/;

/** Why a call failed, so the bridge knows whether to wait, stop, or say so. */
export type TelegramFailure =
  | "network"
  | "timeout"
  | "token"
  | "conflict"
  | "rate"
  | "server"
  | "refused"
  | "shape"
  | "aborted";

/**
 * Why Telegram could not be asked. The token is in every address, so the message is always one
 * of the office's own: never Telegram's words, an address, or the error a request threw.
 */
export class TelegramProblem extends Error {
  readonly failure: TelegramFailure;
  /** With `rate`: the seconds Telegram asked for, or null when it named none. */
  readonly retryAfterS: number | null;

  constructor(message: string, failure: TelegramFailure, retryAfterS: number | null = null) {
    super(message);
    this.name = "TelegramProblem";
    this.failure = failure;
    this.retryAfterS = retryAfterS;
  }
}

/** A message as the bridge reads it; a field Telegram left out or sent in another shape is null. */
export interface IncomingMessage {
  messageId: number;
  from: { id: number; isBot: boolean } | null;
  chat: { id: number; type: string } | null;
  text: string | null;
  /** The message it answers, by id. */
  replyTo: number | null;
}

/** One update; `message` is null for every other kind (an edit, a channel post, a button). */
export interface TelegramUpdate {
  updateId: number;
  message: IncomingMessage | null;
}

export interface TelegramApi {
  /** Waits up to `timeoutS` for updates from `offset` (none: from the oldest unconfirmed). */
  getUpdates(
    input: { offset: number | null; timeoutS: number },
    signal: AbortSignal,
  ): Promise<TelegramUpdate[]>;
  /** Sends plain text; resolves the sent message's id. */
  sendMessage(chatId: string | number, text: string): Promise<number>;
  /** The bot's username. */
  getMe(): Promise<string>;
}

const UpdateSchema = z.object({ update_id: z.number().int() });
const MessageSchema = z.object({
  message_id: z.number().int().catch(0),
  from: z.object({ id: z.number().int(), is_bot: z.boolean() }).optional().catch(undefined),
  chat: z.object({ id: z.number().int(), type: z.string() }).optional().catch(undefined),
  text: z.string().optional().catch(undefined),
  reply_to_message: z.object({ message_id: z.number().int() }).optional().catch(undefined),
});
const AnswerSchema = z.object({ ok: z.literal(true), result: z.unknown() });
const RetrySchema = z.object({
  parameters: z.object({ retry_after: z.number().int().positive() }),
});
const SentSchema = z.object({ message_id: z.number().int() });
const BotSchema = z.object({ username: z.string() });

const NO_MESSAGE: Omit<IncomingMessage, "messageId"> = {
  from: null,
  chat: null,
  text: null,
  replyTo: null,
};

function readMessage(raw: unknown): IncomingMessage {
  const parsed = MessageSchema.safeParse(raw);
  if (!parsed.success) return { messageId: 0, ...NO_MESSAGE };
  const { message_id, from, chat, text, reply_to_message } = parsed.data;
  return {
    messageId: message_id,
    from: from === undefined ? null : { id: from.id, isBot: from.is_bot },
    chat: chat === undefined ? null : { id: chat.id, type: chat.type },
    text: text ?? null,
    replyTo: reply_to_message?.message_id ?? null,
  };
}

/** Each update that has an id; one without cannot be confirmed, so it is passed over. */
function readUpdates(result: unknown): TelegramUpdate[] {
  if (!Array.isArray(result)) throw shape();
  return result.flatMap((raw: unknown): TelegramUpdate[] => {
    const parsed = UpdateSchema.safeParse(raw);
    if (!parsed.success) return [];
    const message =
      typeof raw === "object" && raw !== null && "message" in raw ? readMessage(raw.message) : null;
    return [{ updateId: parsed.data.update_id, message }];
  });
}

function shape(): TelegramProblem {
  return new TelegramProblem("Telegram answered in a shape the office does not read", "shape");
}

/** A failed request's error says nothing safe but its code: its text holds the address. */
function unreachable(error: unknown, timeoutMs: number): TelegramProblem {
  if (error instanceof Error && error.name === "TimeoutError") {
    return new TelegramProblem(`Telegram did not answer in ${timeoutMs / 1000} s`, "timeout");
  }
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  const code = (cause as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && NETWORK_ERRORS.has(code)
    ? new TelegramProblem(`Telegram could not be reached: ${code}`, "network")
    : new TelegramProblem("Telegram could not be reached", "network");
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/** What a refusal of a message says: the chat is the likely cause. */
const SEND_REFUSALS: Record<number, string> = {
  400: "Telegram refused the message (HTTP 400): check the chat id, and that the bot is in that chat",
  403: "Telegram refused the message (HTTP 403): the bot may not write to that chat",
};

function refusal(method: string, status: number, body: unknown): TelegramProblem {
  if (status >= 300 && status < 400) {
    return new TelegramProblem(`Telegram answered with a redirect (HTTP ${status})`, "refused");
  }
  if (status === 401 || status === 404) {
    return new TelegramProblem("Telegram refused the token", "token");
  }
  if (status === 409) return new TelegramProblem("Another program is reading this bot", "conflict");
  if (status === 429) {
    const retry = RetrySchema.safeParse(body);
    const after = retry.success ? retry.data.parameters.retry_after : null;
    return new TelegramProblem("Telegram asked the office to wait", "rate", after);
  }
  if (status >= 500) return new TelegramProblem(`Telegram answered HTTP ${status}`, "server");
  const said = method === "sendMessage" ? SEND_REFUSALS[status] : undefined;
  return new TelegramProblem(said ?? `Telegram refused the request (HTTP ${status})`, "refused");
}

/** Talks to the Bot API with `token`. Every call rejects with a `TelegramProblem` only. */
export function createTelegramApi(token: string, fetchFn: typeof fetch = fetch): TelegramApi {
  async function call(
    method: string,
    body: Record<string, unknown>,
    timeoutMs: number,
    stop?: AbortSignal,
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(timeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        // A redirect would carry the token, which is in the path, to wherever it points.
        redirect: "manual",
        signal: stop === undefined ? timeout : AbortSignal.any([stop, timeout]),
      });
      text = await cappedText("Telegram", response);
    } catch (error) {
      if (stop?.aborted) throw new TelegramProblem("The poll was stopped", "aborted");
      if (error instanceof TrackerProblem) {
        throw new TelegramProblem("Telegram answered with too much data", "server");
      }
      throw unreachable(timeout.aborted ? new DOMException("", "TimeoutError") : error, timeoutMs);
    }
    const parsedBody = parseBody(text);
    if (!response.ok) throw refusal(method, response.status, parsedBody);
    const answer = AnswerSchema.safeParse(parsedBody);
    if (!answer.success) throw shape();
    return answer.data.result;
  }

  return {
    async getUpdates({ offset, timeoutS }, signal) {
      const body = {
        ...(offset === null ? {} : { offset }),
        timeout: timeoutS,
        allowed_updates: ["message"],
      };
      return readUpdates(await call("getUpdates", body, POLL_TIMEOUT_MS, signal));
    },
    async sendMessage(chatId, text) {
      // Plain text: no parse mode, so nothing in a task's text is read as markup.
      const body = { chat_id: chatId, text, disable_web_page_preview: true };
      const sent = SentSchema.safeParse(await call("sendMessage", body, CALL_TIMEOUT_MS));
      if (!sent.success) throw shape();
      return sent.data.message_id;
    },
    async getMe() {
      const bot = BotSchema.safeParse(await call("getMe", {}, CALL_TIMEOUT_MS));
      if (!bot.success) throw shape();
      return bot.data.username;
    },
  };
}
