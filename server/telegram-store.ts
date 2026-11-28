import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { TelegramState } from "../shared/contracts.js";
import { BOT_TOKEN } from "./telegram.js";

/** The newest messages the bridge sent that a reply can answer, each with its task. */
export const SENT_KEEP = 200;
/** The most `/task` times kept: the hour's cap needs no more. */
const TASK_TIMES_KEEP = 100;

const SavedTokenFileSchema = z.object({ version: z.literal(1), token: z.string() });

/** The saved token, or none; `unreadable` when a file is there and cannot be read. */
export interface SavedToken {
  token: string | null;
  unreadable: boolean;
}

export const NO_SAVED_TOKEN: SavedToken = { token: null, unreadable: false };

const KeptSchema = z.object({
  version: z.literal(1),
  /** The bot the offset and the pairs belong to: the digits before the token's colon. */
  bot: z.string().nullable().catch(null),
  /** The next update to ask for; null before the first run threw away what was waiting. */
  offset: z.number().int().nullable(),
  /**
   * Each message the bridge sent about a task, in its chat: a message id is its chat's own. Pairs
   * from before they kept their chat cannot be told apart, so a file with one keeps none.
   */
  sent: z
    .array(
      z.object({
        chat: z.string().max(40),
        messageId: z.number().int(),
        postId: z.string().max(40),
      }),
    )
    .catch([])
    .transform((sent) => sent.slice(-SENT_KEEP)),
  /** When each task of the last hour was posted from Telegram, epoch ms. */
  taskTimes: z.array(z.number()).transform((times) => times.slice(-TASK_TIMES_KEEP)),
});
export type TelegramKept = z.output<typeof KeptSchema>;

export interface TelegramStore {
  /** Never rejects: a file that cannot be read is no token. */
  loadToken(): Promise<SavedToken>;
  /** Null removes the saved token. Rejects when the write fails. */
  saveToken(token: string | null): Promise<void>;
  /** Never rejects: a missing or unreadable file is a fresh start. */
  loadState(): Promise<TelegramKept | null>;
  /** Rejects when the write fails. */
  saveState(state: TelegramKept): Promise<void>;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** The token in use, where it comes from, and why there is none when something is wrong. */
export type TokenInUse =
  | { token: string; source: NonNullable<TelegramState["source"]>; problem: null }
  | { token: null; source: null; problem: string | null };

const UNREADABLE = "The saved Telegram token cannot be read: save it again";

/**
 * The saved token, else `TELEGRAM_BOT_TOKEN`, else none. A saved token that cannot be read is
 * none, not the environment's: the owner saved one, and should hear it is broken.
 */
export function telegramToken(saved: SavedToken, env: NodeJS.ProcessEnv): TokenInUse {
  if (saved.unreadable) return { token: null, source: null, problem: UNREADABLE };
  if (saved.token !== null) {
    return BOT_TOKEN.test(saved.token)
      ? { token: saved.token, source: "saved", problem: null }
      : { token: null, source: null, problem: UNREADABLE };
  }
  const fromEnv = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  if (fromEnv === "") return { token: null, source: null, problem: null };
  return BOT_TOKEN.test(fromEnv)
    ? { token: fromEnv, source: "env", problem: null }
    : { token: null, source: null, problem: "TELEGRAM_BOT_TOKEN is not a bot token" };
}

/**
 * The token and the bridge's state, each in a file of its own. Both are written for their owner
 * only, and replaced whole so the mode is always that.
 */
export function createTelegramStore(options: {
  tokenFile: string;
  stateFile: string;
  log(message: string): void;
}): TelegramStore {
  const { tokenFile, stateFile, log } = options;
  let temp = 0;

  async function write(file: string, data: unknown): Promise<void> {
    temp += 1;
    const tempFile = `${file}.tmp-${temp}`;
    await mkdir(dirname(file), { recursive: true });
    try {
      await writeFile(tempFile, `${JSON.stringify(data)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(tempFile, file);
    } catch (error) {
      await rm(tempFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** The file's JSON; undefined when there is none, null when it cannot be read. */
  async function readJson(file: string): Promise<unknown> {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (isMissing(error)) return undefined;
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  return {
    async loadToken() {
      const json = await readJson(tokenFile);
      if (json === undefined) return NO_SAVED_TOKEN;
      const parsed = SavedTokenFileSchema.safeParse(json);
      if (parsed.success) return { token: parsed.data.token, unreadable: false };
      // Only that it is unreadable: a parse error's message quotes the file, which holds the token.
      log(`[office] ${tokenFile} is unreadable; the Telegram bridge has no token until a save`);
      return { token: null, unreadable: true };
    },
    async saveToken(token) {
      if (token === null) {
        await rm(tokenFile, { force: true });
        return;
      }
      await write(tokenFile, { version: 1, token });
    },
    async loadState() {
      const json = await readJson(stateFile);
      if (json === undefined) return null;
      const parsed = KeptSchema.safeParse(json);
      if (parsed.success) return parsed.data;
      log(`[office] ${stateFile} is unreadable; the Telegram bridge starts afresh`);
      return null;
    },
    saveState: (state) => write(stateFile, state),
  };
}
