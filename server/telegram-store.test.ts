import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  createTelegramStore,
  NO_SAVED_TOKEN,
  SENT_KEEP,
  telegramToken,
  type TelegramKept,
} from "./telegram-store.js";

const TOKEN = "123456789:AAH-secret_token_value_0123456789abcd";
const OTHER = "987654321:BBH-other_token_value_0123456789abcd";

let directory = "";
let logs: string[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "office-telegram-"));
  logs = [];
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const tokenFile = () => join(directory, "office", "telegram.json");
const stateFile = () => join(directory, "office", "telegram-state.json");

function store() {
  return createTelegramStore({
    tokenFile: tokenFile(),
    stateFile: stateFile(),
    log: (message) => logs.push(message),
  });
}

test("no file is no saved token and no state", async () => {
  expect(await store().loadToken()).toEqual(NO_SAVED_TOKEN);
  expect(await store().loadState()).toBeNull();
  expect(logs).toEqual([]);
});

test("a saved token is written for its owner only, read back, and removed by saving none", async () => {
  await store().saveToken(TOKEN);
  expect((await stat(tokenFile())).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(tokenFile(), "utf8"))).toEqual({ version: 1, token: TOKEN });
  expect(await store().loadToken()).toEqual({ token: TOKEN, unreadable: false });
  await store().saveToken(null);
  await expect(stat(tokenFile())).rejects.toThrow();
  expect(await store().loadToken()).toEqual(NO_SAVED_TOKEN);
  // Removing what is not there is no failure.
  await store().saveToken(null);
});

test("an unreadable token file is no token, said without its contents, and never a crash", async () => {
  await mkdir(join(directory, "office"), { recursive: true });
  await writeFile(tokenFile(), `{"version":1,"token":"${TOKEN}"`);
  expect(await store().loadToken()).toEqual({ token: null, unreadable: true });
  await writeFile(tokenFile(), JSON.stringify({ version: 2, token: TOKEN }));
  expect(await store().loadToken()).toEqual({ token: null, unreadable: true });
  expect(logs.join("\n")).not.toContain(TOKEN);
  expect(logs).toHaveLength(2);
  // A folder where the file should be cannot be read either.
  await rm(tokenFile());
  await mkdir(tokenFile());
  expect(await store().loadToken()).toEqual({ token: null, unreadable: true });
  expect(logs.join("\n")).not.toContain(TOKEN);
});

test("the token in use: the saved one, else TELEGRAM_BOT_TOKEN, else none", () => {
  const env = { TELEGRAM_BOT_TOKEN: ` ${OTHER} ` };
  expect(telegramToken({ token: TOKEN, unreadable: false }, env)).toEqual({
    token: TOKEN,
    source: "saved",
    problem: null,
  });
  expect(telegramToken(NO_SAVED_TOKEN, env)).toEqual({
    token: OTHER,
    source: "env",
    problem: null,
  });
  expect(telegramToken(NO_SAVED_TOKEN, {})).toEqual({ token: null, source: null, problem: null });
  expect(telegramToken(NO_SAVED_TOKEN, { TELEGRAM_BOT_TOKEN: "  " })).toEqual({
    token: null,
    source: null,
    problem: null,
  });
});

test("a token of another shape is none, with a problem that does not quote it", () => {
  const unreadable = telegramToken(
    { token: null, unreadable: true },
    { TELEGRAM_BOT_TOKEN: OTHER },
  );
  expect(unreadable).toEqual({
    token: null,
    source: null,
    problem: "The saved Telegram token cannot be read: save it again",
  });
  const odd = `${TOKEN}/../x`;
  expect(telegramToken({ token: odd, unreadable: false }, {})).toEqual({
    token: null,
    source: null,
    problem: "The saved Telegram token cannot be read: save it again",
  });
  const fromEnv = telegramToken(NO_SAVED_TOKEN, { TELEGRAM_BOT_TOKEN: odd });
  expect(fromEnv).toEqual({
    token: null,
    source: null,
    problem: "TELEGRAM_BOT_TOKEN is not a bot token",
  });
});

const KEPT: TelegramKept = {
  version: 1,
  offset: 41,
  sent: [{ messageId: 7, postId: "p3" }],
  taskTimes: [1_000],
};

test("the state is saved and read back", async () => {
  await store().saveState(KEPT);
  expect(await store().loadState()).toEqual(KEPT);
  expect(JSON.parse(await readFile(stateFile(), "utf8"))).toEqual(KEPT);
});

test("an unreadable state file starts fresh, and is logged as unreadable", async () => {
  await mkdir(join(directory, "office"), { recursive: true });
  await writeFile(stateFile(), "{ not json");
  expect(await store().loadState()).toBeNull();
  await writeFile(stateFile(), JSON.stringify({ ...KEPT, offset: "x" }));
  expect(await store().loadState()).toBeNull();
  expect(logs).toHaveLength(2);
});

test("a state file with more pairs than are kept is cut to the newest", async () => {
  const sent = Array.from({ length: SENT_KEEP + 5 }, (_, index) => ({
    messageId: index,
    postId: `p${index}`,
  }));
  await mkdir(join(directory, "office"), { recursive: true });
  await writeFile(stateFile(), JSON.stringify({ ...KEPT, sent }));
  const loaded = await store().loadState();
  expect(loaded?.sent).toHaveLength(SENT_KEEP);
  expect(loaded?.sent[0]).toEqual({ messageId: 5, postId: "p5" });
});
