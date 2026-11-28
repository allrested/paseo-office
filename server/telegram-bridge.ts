import { stallCause, waitingOn, type StallCause } from "../shared/board-rules.js";
import {
  DUTY,
  LOBBY,
  POST_TEXT_MAX,
  USER_AUTHOR,
  type AgentStatus,
  type Post,
  type TelegramState,
} from "../shared/contracts.js";
import type { Notice } from "../shared/notify.js";
import type { INTAKE_LANDS } from "../shared/settings.js";
import { errorMessage } from "./errors.js";
import { cutMarked } from "./intake-service.js";
import type { Office } from "./office.js";
import { oneLine } from "./prompt-text.js";
import {
  BOT_TOKEN,
  createTelegramApi,
  POLL_SECONDS,
  TelegramProblem,
  type IncomingMessage,
  type TelegramApi,
  type TelegramUpdate,
} from "./telegram.js";
import {
  NO_SAVED_TOKEN,
  SENT_KEEP,
  telegramToken,
  type SavedToken,
  type TelegramKept,
  type TelegramStore,
  type TokenInUse,
} from "./telegram-store.js";
import type { Clock } from "./timers.js";

/** How often a claim is looked at for a stall. */
export const STALL_CHECK_MS = 60_000;
/** The longest message sent; Telegram takes 4,096. */
export const MESSAGE_MAX = 3_500;
/** A task's text on a message's second line. */
const TASK_LINE_MAX = 200;
/** The most tasks posted from Telegram in an hour, by everyone. */
export const TASKS_PER_HOUR = 20;
const HOUR_MS = 60 * 60_000;
/** `/board`'s lines, each with its text cut to this. */
const BOARD_LINES = 20;
const BOARD_TEXT_MAX = 80;
/** A failed poll waits this long, doubling up to the most. */
export const BACKOFF_MS = 5_000;
export const BACKOFF_MAX_MS = 60_000;

/** How a stalled message says why. */
const STALLED_HOW: Record<StallCause, string> = {
  error: "stopped on an error",
  home: "is at home",
  idle: "is idle",
};

const HELP = "Reply to a task's message to answer it, or use /task or /board.";
const GONE = "That task is no longer on the board.";
const USAGE = "Usage: /task <what to do>";
const TOO_MANY = "Too many tasks this hour: wait a little.";
const CONNECTED = "The office is connected.";
const STATE_UNSAVED = "The Telegram bridge's state could not be saved";
const FAILED = "The Telegram bridge failed: see the office's log";

/** The host settings the bridge follows. */
export interface TelegramSettings {
  chat: string;
  users: readonly string[];
  needs: boolean;
  stalled: boolean;
  done: boolean;
  incidents: boolean;
  plan: boolean;
  lands: (typeof INTAKE_LANDS)[number];
}

/** The board as the bridge uses it: it reads, and posts as the user. */
export type TelegramBoard = Pick<Office, "allPosts" | "post" | "label">;

/** An agent as the directory last reported it. */
export interface DirectoryAgent {
  status: AgentStatus;
  title: string | null;
}

export type TelegramTestResult = { ok: true; bot: string } | { ok: false; problem: string };

export interface TelegramBridgeDeps {
  store: TelegramStore;
  /** The daemon's environment: `TELEGRAM_BOT_TOKEN` serves when no token is saved. */
  env: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  clock: Clock;
  board: TelegramBoard;
  /** The agents by id while the directory is open; null while it is not. */
  agents(): ReadonlyMap<string, DirectoryAgent> | null;
  /** The state for clients, each time it changes. */
  changed(state: TelegramState): void;
  log(message: string): void;
}

export interface TelegramBridge {
  /** Settles once the token and the state are read; never rejects. */
  ready: Promise<void>;
  /** Null while the settings cannot be read: the bridge stops. */
  settingsChanged(settings: TelegramSettings | null): void;
  /** After any board's change: what is newly blocked or done is told. */
  boardChanged(): void;
  /** A notice the webhook gets; incidents and plan warnings go out by their switches. */
  tell(notice: Notice): void;
  /** Saves the token (empty removes it); rejects for one of another shape. */
  save(token: string): Promise<TelegramState>;
  test(): Promise<TelegramTestResult>;
  state(): TelegramState;
  stop(): Promise<void>;
}

/** What a post was when last looked at: the events are its changes. */
interface Seen {
  blocked: string | undefined;
  done: boolean;
}

// Control characters but the newline and the tab: what a message may carry onto a board.
const CONTROL = /[^\P{Cc}\n\t]/gu;
// `/task`, `/task@bot`, with what follows.
const COMMAND = /^\/([A-Za-z]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/;

/** Text from Telegram as a post takes it: no control characters, trimmed, cut to a post's limit. */
function cleaned(text: string): string {
  const plain = text.replace(CONTROL, "").trim();
  if (plain.length <= POST_TEXT_MAX) return plain;
  const last = plain.charCodeAt(POST_TEXT_MAX - 1);
  return plain.slice(0, last >= 0xd800 && last <= 0xdbff ? POST_TEXT_MAX - 1 : POST_TEXT_MAX);
}

/** The bot's own number, the part of the token before the colon; it is no secret. */
function botOf(token: string): string {
  return token.split(":")[0] ?? "";
}

/** How `/board` names a lobby task's state, in the order it lists them. */
const BOARD_STATES = ["needs you", "in progress", "waiting", "to do", "backlog"] as const;
type BoardState = (typeof BOARD_STATES)[number];

function boardState(post: Post, posts: readonly Post[]): BoardState {
  if (post.state === "claimed") return post.blocked === undefined ? "in progress" : "needs you";
  if (post.backlog) return "backlog";
  return waitingOn(post, posts).length > 0 ? "waiting" : "to do";
}

/**
 * The office in a Telegram chat. Out: a task that needs the owner, a stalled claim, a task done,
 * an incident and a plan warning. In: a reply that answers a task, `/task` and `/board`, from the
 * listed users only, in the configured chat or a private chat with each. A message that reaches
 * an agent can make it act with the agent's permissions, so anything else is dropped unheard.
 * The token is in every address Telegram is called at: no address, and no error a request threw,
 * reaches a log line, a problem or the state.
 */
export function createTelegramBridge(deps: TelegramBridgeDeps): TelegramBridge {
  const { store, clock, board } = deps;
  let settings: TelegramSettings | null = null;
  let saved: SavedToken = NO_SAVED_TOKEN;
  let inUse: TokenInUse = telegramToken(NO_SAVED_TOKEN, {});
  let kept: TelegramKept = { version: 1, bot: null, offset: null, sent: [], taskTimes: [] };
  // The bot's username, from getMe when the poll starts; null while unknown.
  let username: string | null = null;
  let loaded = false;
  let stopped = false;
  let dropped = 0;
  let pollProblem: string | null = null;
  let sendProblem: string | null = null;
  // The poll that runs, and what it runs with; a change of either starts another.
  let running: { key: string; controller: AbortController } | null = null;
  let lastLoop: Promise<void> = Promise.resolve();
  // Set when Telegram refused the token: no poll until the token or the settings change.
  let refused = false;
  let sending: Promise<void> = Promise.resolve();
  let saving: Promise<void> = Promise.resolve();
  let saves: Promise<unknown> = Promise.resolve();
  // Null until the first look: what is already blocked, done or stalled then is not told.
  let seen: Map<string, Seen> | null = null;
  let stalled: Set<string> | null = null;
  let published = "";
  let logged: string | null = null;
  let cancelCheck: (() => void) | null = null;

  /** A line for the log with any token taken out, should one ever reach it. */
  function say(line: string): void {
    let safe = line;
    for (const token of [saved.token, inUse.token]) {
      if (token) safe = safe.split(token).join("<token>");
    }
    deps.log(safe);
  }

  function state(): TelegramState {
    return {
      on: running !== null,
      source: inUse.source,
      problem: pollProblem ?? sendProblem ?? inUse.problem,
      dropped,
    };
  }

  function publish(): void {
    const next = state();
    const text = JSON.stringify(next);
    if (text === published) return;
    published = text;
    deps.changed(next);
  }

  function setPollProblem(problem: string | null): void {
    pollProblem = problem;
    if (problem !== null && problem !== logged) say(`[office] telegram: ${problem}`);
    logged = problem;
    publish();
  }

  /** Keeps `next` and writes it; writes go one at a time, each the newest. */
  function keep(next: TelegramKept): Promise<void> {
    kept = next;
    const write = saving.then(() => store.saveState(kept));
    saving = write.catch(() => undefined);
    return write;
  }

  /** Waits `ms` on the office's clock; an abort ends the wait at once. */
  function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const cancel = clock.setTimeout(done, ms);
      function done(): void {
        cancel();
        signal.removeEventListener("abort", done);
        resolve();
      }
      signal.addEventListener("abort", done, { once: true });
    });
  }

  /** What the poll runs with: the token, the chat and the users; null when one is missing. */
  function wantedKey(): string | null {
    if (inUse.token === null || settings === null) return null;
    if (settings.chat === "" || settings.users.length === 0) return null;
    return JSON.stringify([inUse.token, settings.chat, settings.users]);
  }

  /** Starts, stops or restarts the poll to match the token and the settings. */
  function follow(): void {
    if (!loaded || stopped) return;
    const key = refused ? null : wantedKey();
    if (running?.key === key) {
      publish();
      return;
    }
    if (running !== null) {
      running.controller.abort();
      running = null;
    }
    pollProblem = null;
    if (key !== null && inUse.token !== null) {
      const controller = new AbortController();
      const token = inUse.token;
      running = { key, controller };
      // One poll at a time: the next starts once the one before has ended.
      lastLoop = lastLoop
        .then(() => poll(token, controller))
        .catch((error: unknown) => say(`[office] telegram poll failed: ${errorMessage(error)}`));
    }
    watchStalls();
    publish();
  }

  /** Before a poll's first call: the kept state is this bot's, and its name is known. */
  async function begin(token: string, api: TelegramApi): Promise<void> {
    // Another bot's updates are numbered apart and its messages are not ours to answer: its
    // offset and pairs go, and it starts as a first run.
    const bot = botOf(token);
    if (kept.bot !== bot) {
      try {
        await keep({ ...kept, bot, offset: null, sent: [] });
      } catch (error) {
        say(`[office] telegram: ${errorMessage(error)}`);
      }
    }
    // The name a command for this bot carries. Best effort: without it only bare commands count.
    username = null;
    try {
      username = await api.getMe();
    } catch {
      username = null;
    }
  }

  async function poll(token: string, controller: AbortController): Promise<void> {
    const { signal } = controller;
    const api = createTelegramApi(token, deps.fetchFn);
    let backoff = BACKOFF_MS;
    await begin(token, api);
    while (!signal.aborted) {
      try {
        if (kept.offset === null) {
          // A first run: what waited before the bridge was set up is thrown away, not acted on.
          const waiting = await api.getUpdates({ offset: -1, timeoutS: 0 }, signal);
          const last = waiting.at(-1);
          await keep({ ...kept, offset: last === undefined ? 0 : last.updateId + 1 });
          continue;
        }
        const updates = await api.getUpdates(
          { offset: kept.offset, timeoutS: POLL_SECONDS },
          signal,
        );
        backoff = BACKOFF_MS;
        if (pollProblem !== null) setPollProblem(null);
        for (const update of updates) {
          if (signal.aborted) return;
          const offset = kept.offset ?? 0;
          if (update.updateId < offset) continue;
          // Saved before it is acted on: a crash in the middle loses this one, and repeats none.
          await keep({ ...kept, offset: update.updateId + 1 });
          await handle(update, api);
        }
      } catch (error) {
        if (signal.aborted) return;
        if (!(error instanceof TelegramProblem)) {
          say(`[office] telegram: ${errorMessage(error)}`);
          setPollProblem(FAILED);
          await sleep(backoff, signal);
          backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
          continue;
        }
        setPollProblem(error.message);
        if (error.failure === "token") {
          // Asking again cannot help: the owner must save another token or change the settings.
          refused = true;
          if (running?.controller === controller) running = null;
          watchStalls();
          publish();
          return;
        }
        if (error.failure === "conflict") {
          await sleep(BACKOFF_MAX_MS, signal);
        } else if (error.failure === "rate") {
          await sleep(
            Math.min((error.retryAfterS ?? backoff / 1000) * 1000, BACKOFF_MAX_MS),
            signal,
          );
        } else {
          await sleep(backoff, signal);
          backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
        }
      }
    }
  }

  /** Whether the message is heard: a listed person, in the chat or a private chat of their own. */
  function heard(message: IncomingMessage, current: TelegramSettings): boolean {
    const { from, chat, text } = message;
    if (text === null || from === null || chat === null || from.isBot) return false;
    if (!current.users.includes(String(from.id))) return false;
    if (String(chat.id) === current.chat) return true;
    return chat.type === "private" && chat.id === from.id;
  }

  async function handle(update: TelegramUpdate, api: TelegramApi): Promise<void> {
    const { message } = update;
    // Only messages are asked for; any other kind that comes anyway is not one to count.
    if (message === null) return;
    const current = settings;
    if (current === null || !heard(message, current) || message.chat === null) {
      // Never logged: who wrote, where, and what, are the stranger's.
      dropped += 1;
      publish();
      return;
    }
    const answer = await answerTo(message, current);
    // A command for another bot is left to it, unanswered, so two bots do not both speak.
    if (answer === null) return;
    await send(api, message.chat.id, answer.text, answer.postId);
  }

  async function answerTo(
    message: IncomingMessage,
    current: TelegramSettings,
  ): Promise<{ text: string; postId?: string } | null> {
    // A forwarded message carries someone else's words on a listed user's hands.
    if (message.forwarded) return { text: HELP };
    const text = (message.text ?? "").trim();
    const command = COMMAND.exec(text);
    if (command !== null && command[2] !== undefined) {
      const ours = username !== null && command[2].toLowerCase() === username.toLowerCase();
      if (!ours) return null;
    }
    if (command?.[1] === "task") return postTask(cleaned(command[3] ?? ""), current);
    if (command?.[1] === "board") return { text: boardText() };
    if (message.replyTo !== null) return reply(message);
    return { text: HELP };
  }

  async function reply(message: IncomingMessage): Promise<{ text: string; postId?: string }> {
    // A message id is its chat's own: the same number in another chat is another message.
    const chat = String(message.chat?.id);
    const pair = kept.sent.findLast(
      (sent) => sent.chat === chat && sent.messageId === message.replyTo,
    );
    const task = board.allPosts()?.find((post) => post.id === pair?.postId && post.kind === "task");
    if (task === undefined) return { text: GONE };
    const result = await board.post({
      board: task.board,
      kind: "note",
      text: cleaned(message.text ?? ""),
      replyTo: task.id,
    });
    return result.ok
      ? { text: `Posted under ${task.id}.`, postId: task.id }
      : { text: result.error };
  }

  async function postTask(
    text: string,
    current: TelegramSettings,
  ): Promise<{ text: string; postId?: string }> {
    if (text === "") return { text: USAGE };
    const now = clock.now();
    const recent = kept.taskTimes.filter((at) => at > now - HOUR_MS);
    if (recent.length >= TASKS_PER_HOUR) return { text: TOO_MANY };
    const held = current.lands !== "todo";
    const result = await board.post({
      board: LOBBY,
      kind: "task",
      text,
      ...(held ? { backlog: true } : {}),
    });
    if (!result.ok) return { text: result.error };
    await keep({ ...kept, taskTimes: [...recent, now] });
    const { id } = result.post;
    return { text: held ? `Posted ${id} to the backlog.` : `Posted ${id}.`, postId: id };
  }

  function boardText(): string {
    const posts = board.allPosts() ?? [];
    const open = posts.filter(
      (post) => post.board === LOBBY && post.kind === "task" && post.state !== "done",
    );
    const rows = open
      .map((post) => ({ post, shown: boardState(post, posts) }))
      .sort(
        (left, right) =>
          BOARD_STATES.indexOf(left.shown) - BOARD_STATES.indexOf(right.shown) ||
          left.post.seq - right.post.seq,
      );
    const count = (shown: BoardState) => rows.filter((row) => row.shown === shown).length;
    const head =
      `Lobby: ${count("in progress")} in progress, ${count("needs you")} needs you, ` +
      `${count("waiting")} waiting, ${count("to do")} to do, ${count("backlog")} in the backlog`;
    const lines = rows
      .slice(0, BOARD_LINES)
      .map(
        ({ post, shown }) =>
          `${post.id} ${shown}: ${cutMarked(oneLine(post.text), BOARD_TEXT_MAX)}`,
      );
    return [head, ...lines].join("\n");
  }

  /**
   * Sends one message, after the ones before it. A failure is not tried again: it is the bridge's
   * problem until a message goes through. `postId` keeps the message, so a reply answers the task.
   */
  function send(
    api: TelegramApi | null,
    chatId: string | number,
    text: string,
    postId?: string,
  ): Promise<void> {
    const run = sending.then(() => deliver(api, chatId, text, postId));
    sending = run;
    return run;
  }

  async function deliver(
    api: TelegramApi | null,
    chatId: string | number,
    text: string,
    postId: string | undefined,
  ): Promise<void> {
    const token = inUse.token;
    if (stopped || token === null) return;
    try {
      const messageId = await (api ?? createTelegramApi(token, deps.fetchFn)).sendMessage(
        chatId,
        cutMarked(text, MESSAGE_MAX),
      );
      sendProblem = null;
      if (postId !== undefined) {
        const sent = { chat: String(chatId), messageId, postId };
        await keep({ ...kept, sent: [...kept.sent, sent].slice(-SENT_KEEP) });
      }
    } catch (error) {
      sendProblem = error instanceof TelegramProblem ? error.message : STATE_UNSAVED;
      say(`[office] telegram send: ${sendProblem}`);
    }
    publish();
  }

  /** A message to the configured chat, while the bridge runs. */
  function announce(text: string, postId?: string): void {
    if (running === null || settings === null) return;
    void send(null, settings.chat, text, postId);
  }

  /** An agent by the directory's title, else the board's name; the user is the owner. */
  function nameOf(agentId: string | undefined): string {
    if (agentId === undefined || agentId === USER_AUTHOR) return "the owner";
    return deps.agents()?.get(agentId)?.title || board.label(agentId);
  }

  function taskMessage(post: Post, first: string): string {
    return `${post.id} ${first}\n${cutMarked(oneLine(post.text), TASK_LINE_MAX)}`;
  }

  /**
   * The tasks of every board whose changes are told. A lobby task and its copy on the holder's
   * board are one task: the copy is left out while its lobby task is there.
   */
  function told(posts: readonly Post[]): Post[] {
    const lobby = new Set(posts.filter((post) => post.board === LOBBY).map((post) => post.id));
    return posts.filter(
      (post) =>
        post.kind === "task" &&
        !(post.board !== LOBBY && post.link !== undefined && lobby.has(post.link)),
    );
  }

  function boardChanged(): void {
    if (stopped) return;
    const posts = board.allPosts();
    if (posts === null) return;
    const next = new Map<string, Seen>();
    for (const post of told(posts)) {
      const now: Seen = {
        blocked: post.state === "claimed" ? post.blocked : undefined,
        done: post.state === "done",
      };
      next.set(post.id, now);
      const before = seen?.get(post.id);
      if (seen === null) continue;
      if (now.blocked !== undefined && now.blocked !== before?.blocked && settings?.needs) {
        const asked = `needs you — ${nameOf(post.claimedBy)}: ${oneLine(now.blocked)}`;
        announce(taskMessage(post, asked), post.id);
      }
      // A duty done is no news: the pretend ones are acted out every day.
      if (now.done && before?.done !== true && post.board !== DUTY && settings?.done) {
        const result = post.result === undefined ? "no result given" : oneLine(post.result);
        announce(taskMessage(post, `done by ${nameOf(post.claimedBy)}: ${result}`), post.id);
      }
    }
    seen = next;
  }

  /** A claim, by its holder and since when: a new claim of the same task is a new stall. */
  const claimKey = (post: Post) => JSON.stringify([post.id, post.claimedBy, post.claimedAt]);

  function checkStalls(): void {
    const agents = deps.agents();
    const posts = board.allPosts();
    // Without the directory the holders' statuses are unknown: nothing is told or forgotten.
    if (agents === null || posts === null) return;
    const now = clock.now();
    const holder = (agentId: string) => {
      const status = agents.get(agentId)?.status;
      return status === "closed" ? "home" : status;
    };
    const next = new Set<string>();
    for (const post of told(posts)) {
      const cause = stallCause(post, now, holder);
      if (cause === null) continue;
      const key = claimKey(post);
      next.add(key);
      if (stalled === null || stalled.has(key) || !settings?.stalled) continue;
      const how = STALLED_HOW[cause];
      announce(taskMessage(post, `is stalled — ${nameOf(post.claimedBy)} ${how}`), post.id);
    }
    stalled = next;
  }

  function scheduleCheck(): void {
    cancelCheck = clock.setTimeout(() => {
      try {
        checkStalls();
      } catch (error) {
        say(`[office] telegram stall check failed: ${errorMessage(error)}`);
      }
      scheduleCheck();
    }, STALL_CHECK_MS);
  }

  /**
   * The stall checks run while the bridge does. Each start looks at once without telling, so what
   * stalled while it was off is not told when it comes on, and what stalls next is.
   */
  function watchStalls(): void {
    const on = running !== null && !stopped;
    if (on && cancelCheck === null) {
      stalled = null;
      try {
        checkStalls();
      } catch (error) {
        say(`[office] telegram stall check failed: ${errorMessage(error)}`);
      }
      scheduleCheck();
    } else if (!on && cancelCheck !== null) {
      cancelCheck();
      cancelCheck = null;
    }
  }

  const ready = (async () => {
    try {
      saved = await store.loadToken();
      inUse = telegramToken(saved, deps.env);
      const loadedState = await store.loadState();
      if (loadedState !== null) kept = loadedState;
    } catch (error) {
      say(`[office] the Telegram bridge failed to start: ${errorMessage(error)}`);
    }
    loaded = true;
    boardChanged();
    follow();
    publish();
  })();

  return {
    ready,
    settingsChanged(next) {
      settings = next;
      // A change of the settings is a reason to try a refused token again.
      refused = false;
      follow();
    },
    boardChanged,
    tell(notice) {
      const wanted =
        (notice.kind === "incident" && settings?.incidents) ||
        (notice.kind === "plan" && settings?.plan);
      if (wanted) announce(notice.text);
    },
    save(token) {
      const run = saves.then(async () => {
        await ready;
        const typed = token.trim();
        if (typed !== "" && !BOT_TOKEN.test(typed)) {
          throw new Error(
            "That is not a bot token: BotFather gives one as digits, a colon and letters",
          );
        }
        await store.saveToken(typed === "" ? null : typed);
        saved = typed === "" ? NO_SAVED_TOKEN : { token: typed, unreadable: false };
        inUse = telegramToken(saved, deps.env);
        // A token of another bot starts as a first run: the poll sees the kept bot differ.
        refused = false;
        sendProblem = null;
        follow();
        publish();
        return state();
      });
      saves = run.catch(() => undefined);
      return run;
    },
    async test() {
      await ready;
      const token = inUse.token;
      if (token === null) {
        return {
          ok: false,
          problem: inUse.problem ?? "No bot token: save one, or set TELEGRAM_BOT_TOKEN",
        };
      }
      if (settings === null || settings.chat === "") {
        return { ok: false, problem: "Set the chat id first" };
      }
      const api = createTelegramApi(token, deps.fetchFn);
      try {
        const bot = await api.getMe();
        await api.sendMessage(settings.chat, CONNECTED);
        return { ok: true, bot };
      } catch (error) {
        if (error instanceof TelegramProblem) return { ok: false, problem: error.message };
        throw error;
      }
    },
    state,
    async stop() {
      stopped = true;
      cancelCheck?.();
      cancelCheck = null;
      running?.controller.abort();
      running = null;
      await lastLoop;
      await sending;
      await saving;
    },
  };
}
