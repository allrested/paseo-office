import { lifeLine } from "../shared/life-lines.js";
import type { PluginTurnOutcome } from "@getpaseo/plugin/server";
import {
  CHAT_MESSAGE_MAX,
  GROUP_PHOTO_COUNT,
  CHAT_TEXT_MAX,
  ChatMessageSchema,
  type ChatChange,
  type ChatImage,
  type ChatMessage,
  type ChatRequest,
  type ChatResult,
  type ChatSnapshot,
  type OfficeAgent,
  type OfficeWorkspace,
  type Post,
} from "../shared/contracts.js";
import { agentTitle, waitingOnOf } from "../shared/model.js";
import {
  createChatEngine,
  type ChatEngine,
  type ChatMember,
  type EngineMessage,
  type Translate,
} from "../shared/upstream/chat-engine.js";
import type { ChatData, ChatStore } from "./chat-store.js";
import { isOfficePhoto } from "./group-photo.js";
import { errorMessage } from "./errors.js";
import type { DirectoryView } from "./hub.js";
import { autoGroupPrompt, matchingLobbyTaskAnswer } from "./chat-group.js";
import { NOTES_WRITER_TITLE } from "./notes-writer.js";
import type { Clock } from "./timers.js";

/** How often the engine's clock runs: the morning hello, the lunch poll, reminders. */
export const CHAT_CLOCK_MS = 30_000;
export const RECALL_WINDOW_MS = 2 * 60 * 1000;
export const ANSWER_MAX = 1200;
export const PROMPT_PREFIX = "Team chat message from you: ";

const DIRECTOR = "__director";
const USAGE_LIMIT =
  /usage limit|rate limit|quota|limit (?:reached|exceeded|resets)|out of (?:usage|credits)/i;
const NAME_CHAR = /[\p{L}\p{N}_-]/u;

/** A refreshed session could not accept an automatic group message. Nothing was sent. */
export class GroupSessionUnavailable extends Error {}

export interface ChatDelivery {
  group: boolean;
  messageId: string;
  sentAt: number;
}

export interface ChatServicePorts {
  lobbyPosts(): readonly Post[] | null;
  store: ChatStore;
  clock: Clock;
  tr: Translate;
  /** Sends a prompt that steers a running turn. */
  send(
    agentId: string,
    prompt: string,
    images?: ChatImage[],
    delivery?: ChatDelivery,
  ): Promise<void>;
  /** For a group request, verify the user's timeline message and read only the answer after it. */
  readTurn(
    agentId: string,
    turnId: string | null,
    group?: ChatDelivery,
    officeIds?: readonly string[],
  ): Promise<{
    privateTurn?: boolean;
    matches: boolean;
    text: string | null;
  }>;
  emit(change: ChatChange): void;
  log(message: string): void;
}

export interface ChatService {
  snapshot(): ChatSnapshot;
  /** The directory's view; null when it stops. The first view after null is a baseline and makes no lines. */
  view(view: DirectoryView | null): void;
  turnEnded(
    agent: { id: string },
    outcome: PluginTurnOutcome,
    turnId: string | null,
  ): Promise<void>;
  archived(agentId: string): void;
  /** Ends the waits of an agent closed mid-turn: its turn end never comes. */
  closed(agentId: string): void;
  request(input: ChatRequest): Promise<ChatResult>;
  /** Cancels the clock and the engine's timers and waits for the last save. */
  stop(): Promise<void>;
}

const STAFF_NAMES: Readonly<Record<string, string>> = {
  __director: "Director",
  __reception: "Receptionist",
  __hr: "HR",
  __cleaner: "Cleaner",
  __guard: "Security guard",
  __courier: "Courier",
  __accountant: "Accountant",
};
/** The staff the scene has on the floor speak in the chat under these names. */
export function staffNameOf(key: string, tr: Translate): string | null {
  if (key === DIRECTOR) return tr("people.director");
  return Object.hasOwn(STAFF_NAMES, key) ? (STAFF_NAMES[key] ?? null) : null;
}

export function isUsageLimit(message: string): boolean {
  return USAGE_LIMIT.test(message);
}

// Copied from packages/protocol/src/agent-attention-notification.ts findLatestAssistantMessageFromTimeline:
// a plugin cannot import the protocol package.
export function lastAssistantText(
  items: readonly { type: string; text?: unknown }[],
): string | null {
  const chunks: string[] = [];
  for (const item of items.toReversed()) {
    if (item.type === "assistant_message" && typeof item.text === "string") {
      chunks.push(item.text);
      continue;
    }
    if (chunks.length > 0) break;
  }
  const text = chunks.toReversed().join("").trim();
  return text === "" ? null : text;
}

export function clipAnswer(text: string): string {
  return text.length > ANSWER_MAX ? `${text.slice(0, ANSWER_MAX - 1).trimEnd()}…` : text;
}

// The engine's own `short`.
function short(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The members an `@name` in `text` names, in the order they come. Upstream's rule
 * (`text.includes("@" + name)`), except that a name followed by a name character, or inside a
 * longer member's name, does not count: `@Mjd-1` does not name `Mjd`.
 */
export function mentionedIds(
  text: string,
  members: readonly { id: string; name: string }[],
): string[] {
  const claimed: [number, number][] = [];
  const found = new Map<string, number>();
  for (const member of [...members].sort((a, b) => b.name.length - a.name.length)) {
    const needle = `@${member.name}`;
    for (let from = text.indexOf(needle); from !== -1; from = text.indexOf(needle, from + 1)) {
      const end = from + needle.length;
      if (end < text.length && NAME_CHAR.test(text.charAt(end))) continue;
      if (claimed.some(([start, stop]) => from < stop && end > start)) continue;
      claimed.push([from, end]);
      if (!found.has(member.id)) found.set(member.id, from);
    }
  }
  return [...found].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

function memberOf(agent: OfficeAgent, workspaces: readonly OfficeWorkspace[]): ChatMember {
  return {
    id: agent.id,
    name: agentTitle(agent),
    status: agent.status === "idle" ? "rest" : "work",
    task: agent.title?.trim() ?? "",
    project: workspaces.find((workspace) => workspace.id === agent.workspaceId)?.projectName ?? "",
  };
}

// Keep only the public fields that the chat can display.
function wireOf(message: EngineMessage): ChatMessage | null {
  const parsed = ChatMessageSchema.safeParse(message);
  return parsed.success ? parsed.data : null;
}

// Only a short social command goes to the scene's simulated conversation.
const SOCIAL_COMMAND =
  /^(?:(?:meeting|stand-?up)(?: now| again| at \d{1,2}(?::\d{2})?(?: ?[ap]m)?)?|milk tea|bubble tea|lunch|good job|well done|thanks|thank you|bye|goodbye|họp|trà sữa|tra sua|ăn trưa|cảm ơn|cám ơn|going home)[?!. ]*$/i;

function messageMode(
  text: string,
  hasTarget: boolean,
  replyTo?: string,
): "direct" | "social" | "group" {
  if (hasTarget || replyTo || /(?:^|\s)@[\p{L}\p{N}_-]/u.test(text)) return "direct";
  return SOCIAL_COMMAND.test(text) || !text ? "social" : "group";
}

function boardAnswer(text: string, lobbyPosts: ChatServicePorts["lobbyPosts"]): string | null {
  const question = text
    .toLowerCase()
    .replaceAll("’", "'")
    .replace(/^@director[,:]?\s+/i, "")
    .replace(/[?.!]+$/, "")
    .trim();
  let state: "done" | "claimed" | "open" | "remaining";
  if (
    /^(?:(?:what(?:'s| is| was| has been| got)|which tasks (?:are|were)) (?:already )?(?:done|finished|completed)|what (?:did (?:you|we|the team) (?:finish|complete)|have (?:you|we) (?:done|finished|completed)))(?: so far)?$/.test(
      question,
    )
  )
    state = "done";
  else if (
    /^(?:what(?:'s| is) (?:in progress|being worked on)|what are (?:you|we) working on)$/.test(
      question,
    )
  )
    state = "claimed";
  else if (/^what(?:'s| is) left(?: to do)?$/.test(question)) state = "remaining";
  else if (/^what(?:'s| is) (?:still )?open$/.test(question)) state = "open";
  else return null;
  const posts = lobbyPosts();
  if (!posts) return "The lobby board is unavailable right now.";
  const tasks = posts
    .filter(
      (p) => p.kind === "task" && (state === "remaining" ? p.state !== "done" : p.state === state),
    )
    .sort((a, b) => b.seq - a.seq);
  const label = {
    done: "marked done",
    claimed: "in progress",
    open: "open",
    remaining: "unfinished",
  }[state];
  if (!tasks.length) return `No lobby tasks are ${label}.`;
  const lines = tasks
    .slice(0, 5)
    .map((p) => `${p.id} — ${short(p.text.replace(/\s+/g, " "), 120)}`);
  return [
    `${tasks.length} lobby task${tasks.length === 1 ? "" : "s"} ${label}.`,
    ...lines,
    ...(tasks.length > 5 ? ["Showing the five most recently updated."] : []),
  ].join("\n");
}

interface Waiting {
  member: ChatMember;
  reply: { id: string; name: string; text: string };
  delivery: ChatDelivery;
}

function imageCountLabel(images: ChatImage[] | undefined): string {
  const count = images?.length ?? 0;
  if (!count) return "";
  return count === 1 ? "1 image" : `${count} images`;
}

const OK: ChatResult = { ok: true };
const NO_PERMISSIONS: ReadonlySet<string> = new Set();

export async function createChatService(ports: ChatServicePorts): Promise<ChatService> {
  const { clock, log, tr } = ports;
  const loaded = await ports.store.load();
  const roster = new Map<string, ChatMember>();
  const availableForGroup = new Set<string>();
  // The prompts waiting for an answer, by agent, in send order; never an empty list. In memory only.
  // Each ends by its own failure, a turn end, a close or an archive.
  const waiting = new Map<string, readonly Waiting[]>();
  const timers = new Set<() => void>();
  // The permission ids each agent had in the last view; null until the first view of an open office.
  let baseline: Map<string, ReadonlySet<string>> | null = null;
  // False while the engine is being made: it saves and emits from its constructor, before `engine` exists.
  let live = false;
  let stopped = false;
  let capture: EngineMessage[] | null = null;
  let acts = 0;
  let cancelClock: (() => void) | null = null;

  // One write at a time; while it runs only the newest conversation waits.
  let dirty: ChatData | null = null;
  let saving: Promise<void> | null = null;
  async function drain(): Promise<void> {
    try {
      while (dirty !== null) {
        const next = dirty;
        dirty = null;
        try {
          await ports.store.save(next);
        } catch (error) {
          log(`[office] chat save failed: ${errorMessage(error)}`);
        }
      }
    } finally {
      saving = null;
    }
  }
  function queueSave(data: unknown): void {
    // The engine hands over its own plain object and keeps changing it.
    dirty = structuredClone(data) as ChatData;
    saving ??= drain();
  }

  // An agent waiting for its answer stays a member, so its answer and its typing still resolve.
  const members = (): ChatMember[] => [
    ...roster.values(),
    ...[...waiting.values()]
      .map((entries) => entries[0].member)
      .filter((member) => !roster.has(member.id)),
  ];

  function emit(op: "add" | "update" | "typing" | "all", payload?: EngineMessage | string[]): void {
    if (!live) return;
    if (Array.isArray(payload)) {
      ports.emit({ op: "typing", names: payload });
      return;
    }
    if (payload !== undefined) {
      capture?.push(payload);
      const message = wireOf(payload);
      if (message !== null) ports.emit({ op: op === "update" ? "update" : "add", message });
      return;
    }
    ports.emit({ op: "all", messages: wireMessages(), pinned: engine.state.pinned });
  }

  const engine: ChatEngine = createChatEngine({
    tr,
    now: () => clock.now(),
    members,
    staffName: (key) => staffNameOf(key, tr),
    store: { load: () => loaded, save: queueSave },
    emit,
    act: (what) => {
      if (what !== "meeting") return;
      acts += 1;
      // The time keeps an id new after a restart, so a page that saw the last run's acts takes it.
      ports.emit({ op: "act", what, id: `${clock.now().toString(36)}-${acts}` });
    },
    // The engine calls the global clearTimeout on what this returns, which is a no-op for a cancel
    // function: a stale tick still fires and finds nothing due. They stop when the queue is empty.
    timer: (run, ms) => {
      const cancel = clock.setTimeout(() => {
        timers.delete(cancel);
        run();
      }, ms);
      timers.add(cancel);
      return cancel;
    },
  });
  live = true;

  function wireMessages(): ChatMessage[] {
    return engine.state.msgs.slice(-CHAT_MESSAGE_MAX).flatMap((message) => wireOf(message) ?? []);
  }

  function scheduleClock(): void {
    cancelClock = clock.setTimeout(() => {
      try {
        engine.clock();
      } catch (error) {
        log(`[office] chat clock failed: ${errorMessage(error)}`);
      }
      if (!stopped) scheduleClock();
    }, CHAT_CLOCK_MS);
  }
  scheduleClock();

  // A close or send failure can settle some of these prompts while the timeline is being read.
  // Reply only to waits that are still current, before removing the member from the engine.
  function finish(
    agentId: string,
    ended: readonly Waiting[],
    result: { answer: string } | { notice: string } | null,
  ): void {
    const current = waiting.get(agentId);
    if (!current) return;
    const pending = current.filter((entry) => ended.includes(entry));
    const newest = pending.at(-1);
    if (!newest) return;
    if (result && "answer" in result) {
      const allGroup = pending.every(({ reply }) => engine.byId(reply.id)?.tag === "group");
      engine.say(agentId, clipAnswer(result.answer), {
        now: true,
        long: true,
        reply: newest.reply,
        tag: allGroup ? "group-reply" : undefined,
      });
    } else if (result) {
      for (const entry of pending) {
        engine.say(DIRECTOR, `${entry.member.name}: ${result.notice}`, {
          now: true,
          long: true,
          reply: entry.reply,
          tag: "delivery",
        });
      }
    }
    const left = current.filter((entry) => !ended.includes(entry));
    if (left.length) waiting.set(agentId, left);
    else {
      engine.working(agentId, false);
      waiting.delete(agentId);
    }
  }

  function prompt(
    member: ChatMember,
    text: string,
    reply: Waiting["reply"],
    images?: ChatImage[],
    tryNext?: () => void,
  ): void {
    const delivery = {
      messageId: `office-chat-${reply.id}`,
      sentAt: clock.now(),
      group: !!tryNext,
    };
    const entry: Waiting = { member, reply, delivery };
    waiting.set(member.id, [...(waiting.get(member.id) ?? []), entry]);
    engine.working(member.id, true);
    ports.send(member.id, text, images, delivery).catch((error: unknown) => {
      if (tryNext && error instanceof GroupSessionUnavailable) {
        if (!waiting.get(member.id)?.includes(entry)) return;
        finish(member.id, [entry], null);
        tryNext();
        return;
      }
      finish(member.id, [entry], { notice: `Message delivery failed: ${errorMessage(error)}.` });
    });
  }

  function postMessage(
    input: Extract<ChatRequest, { op: "send" }>,
    text: string,
    sticker: number | null,
    imageLabel: string,
    mode: "social" | "group" | "direct",
  ) {
    const captured: EngineMessage[] = [];
    capture = captured;
    try {
      if (mode !== "social") {
        // A directed turn gets the session's actual answer. The engine's group send also
        // schedules simulated replies and interprets words like "meeting" as a scene action.
        const original = input.replyTo && engine.byId(input.replyTo);
        const reply =
          original && !original.recalled
            ? {
                id: original.id,
                name: original.name ?? tr("chat.you"),
                text: short(
                  original.text ||
                    original.poll?.q ||
                    tr(original.kind === "photo" ? "chat.photo" : "chat.sticker"),
                  90,
                ),
              }
            : null;
        const posted = imageLabel && input.text?.trim() ? `${text}\n(${imageLabel})` : text;
        engine.say("me", posted, {
          now: true,
          sticker,
          reply,
          tag: mode === "group" ? "group" : undefined,
        });
      } else {
        engine.send({ text, sticker, replyTo: input.replyTo ?? null });
      }
    } finally {
      capture = null;
    }
    return captured.find((message) => message.from === "me");
  }

  function recipients(
    input: Extract<ChatRequest, { op: "send" }>,
    text: string,
  ): ChatMember[] | null {
    if (input.to !== undefined) {
      const recipient = roster.get(input.to);
      return recipient ? [recipient] : null;
    }
    const team = members();
    const named = mentionedIds(text, team).flatMap(
      (id) => team.find((member) => member.id === id) ?? [],
    );
    if (named.length || !input.replyTo) return named;
    const original = engine.byId(input.replyTo);
    const author = original?.from && !original.recalled ? roster.get(original.from) : undefined;
    return author ? [author] : [];
  }

  function directorReply(
    text: string,
    quote: Waiting["reply"],
    tag?: "group-reply" | "delivery",
  ): void {
    engine.say(DIRECTOR, text, { now: true, long: true, reply: quote, tag });
  }

  function answerGroup(
    text: string,
    quote: Waiting["reply"],
    addressed: boolean,
    replyTo?: string,
  ): void {
    const toDirector =
      /^@director\b/i.test(text) || (replyTo && engine.byId(replyTo)?.from === DIRECTOR);
    if (addressed && !toDirector) {
      directorReply(
        "That recipient is unavailable. Choose a session in To to send it directly.",
        quote,
        "delivery",
      );
      return;
    }
    const answer =
      boardAnswer(text, ports.lobbyPosts) ??
      matchingLobbyTaskAnswer(text, ports.lobbyPosts(), (id) => roster.get(id)?.name);
    if (answer) {
      directorReply(answer, quote, addressed ? undefined : "group-reply");
      return;
    }
    if (addressed) {
      directorReply(
        "I can look up lobby tasks. Send to the whole group or choose a session in To for a conversation.",
        quote,
        "delivery",
      );
      return;
    }
    const candidates = [...availableForGroup];
    const groupPrompt = autoGroupPrompt(text, engine.state.msgs, quote.id);
    function tryNext(): void {
      while (candidates.length) {
        const id = candidates.shift()!;
        const member = roster.get(id);
        if (member && availableForGroup.has(id) && !waiting.has(id)) {
          prompt(member, groupPrompt, quote, undefined, tryNext);
          return;
        }
      }
      directorReply(
        "No session is available to answer the group right now. Choose a session in To to ask it directly.",
        quote,
        "delivery",
      );
    }
    tryNext();
  }

  function send(input: Extract<ChatRequest, { op: "send" }>): ChatResult {
    const imageLabel = imageCountLabel(input.images);
    if (imageLabel && !input.to) return { ok: false, error: "Choose a session to send images." };
    const text = (input.text ?? "").trim().slice(0, CHAT_TEXT_MAX) || imageLabel;
    const sticker = input.sticker ?? null;
    if (text === "" && sticker === null) return { ok: false, error: "There is nothing to send." };
    if (sticker !== null && tr("chat.stickers", null, "list")[sticker] === undefined) {
      return { ok: false, error: "There is no such sticker." };
    }
    const targets = recipients(input, text);
    if (!targets)
      return { ok: false, error: "That session has left the office. Choose another recipient." };
    const mode = messageMode(text, targets.length > 0, input.replyTo);
    const mine = postMessage(input, text, sticker, imageLabel, mode);
    if (mine === undefined) return { ok: false, error: "The message could not be posted." };
    const words = text || (sticker === null ? "" : tr("chat.stickers", null, "list")[sticker]);
    const quote = { id: mine.id, name: tr("chat.boss"), text: short(words, 90) };
    // Not awaited: a send that fails is a line in the chat, not an error of this call.
    for (const member of targets) prompt(member, PROMPT_PREFIX + words, quote, input.images);
    if (!targets.length && mode !== "social")
      answerGroup(text, quote, mode === "direct", input.replyTo);
    return OK;
  }

  function recall(id: string): ChatResult {
    const message = engine.byId(id);
    if (message?.from === "me" && clock.now() - message.at > RECALL_WINDOW_MS) {
      return { ok: false, error: "A message can be recalled for two minutes." };
    }
    engine.recall(id);
    return OK;
  }

  function life(input: Extract<ChatRequest, { op: "life" }>): ChatResult {
    const line = lifeLine(input.kind, input.vars, {
      resting: () => [...roster.values()].filter((m) => m.status === "rest").map((m) => m.id),
      name: (id) => roster.get(id)?.name ?? null,
      now: clock.now(),
    });
    if (line === null) return { ok: false, error: "There is no such line." };
    const text = tr(line.key, line.vars);
    if (text === line.key) return { ok: false, error: "There is no such line." };
    engine.say(line.from, text, line.options);
    if (line.extra)
      engine.say(line.extra.from, tr(line.extra.key), {
        delay: line.extra.delay,
        key: `${line.options.key}:${line.extra.key}`,
      });
    return OK;
  }

  return {
    snapshot: () => ({
      messages: wireMessages(),
      typing: [...engine.state.typing],
      ...(engine.state.pinned ? { pinned: engine.state.pinned } : {}),
    }),

    view(next) {
      availableForGroup.clear();
      if (next === null) {
        baseline = null;
        return;
      }
      const open = next.agents.filter((agent) => agent.status !== "closed");
      // The roster is set first: the engine looks the agent up for each event.
      roster.clear();
      const waitingOn = waitingOnOf(open);
      for (const agent of open) {
        roster.set(agent.id, memberOf(agent, next.workspaces));
        if (
          agent.status === "idle" &&
          !agent.parentAgentId &&
          !agent.permissions.length &&
          !waitingOn.has(agent.id) &&
          agent.title !== NOTES_WRITER_TITLE
        ) {
          availableForGroup.add(agent.id);
        }
      }
      const previous = baseline;
      baseline = new Map(
        open.map((agent) => [agent.id, new Set(agent.permissions.map((item) => item.id))]),
      );
      if (previous === null) return;
      for (const agent of open) {
        const had = previous.get(agent.id);
        if (had === undefined) {
          engine.onEvent(
            agent.parentAgentId === null
              ? { type: "start", sess: agent.id }
              : { type: "substart", sess: agent.parentAgentId, agent: true },
          );
        }
        for (const permission of agent.permissions) {
          if ((had ?? NO_PERMISSIONS).has(permission.id)) continue;
          engine.onEvent({ type: permission.kind === "question" ? "ask" : "wait", sess: agent.id });
        }
      }
    },

    async turnEnded(agent, outcome, turnId) {
      if (stopped) return;
      const consumed = waiting.get(agent.id);
      if (!consumed) {
        if (outcome.kind === "completed") engine.onEvent({ type: "stop", sess: agent.id });
        if (outcome.kind === "failed") {
          engine.onEvent({
            type: "fail",
            sess: agent.id,
            limit: isUsageLimit(outcome.error.message),
          });
        }
        return;
      }
      // An earlier turn's hook can arrive after a group responder was reserved. Only the
      // turn containing the group's SDK message id may answer or settle its wait.
      const groupEntry = consumed.find((entry) => entry.delivery.group);
      let text: string | null = null;
      if (outcome.kind === "completed" || groupEntry) {
        try {
          const turn = await ports.readTurn(
            agent.id,
            turnId,
            groupEntry?.delivery,
            consumed.map((entry) => entry.delivery.messageId),
          );
          if (!turn.matches) return;
          if (turn.privateTurn && outcome.kind === "completed") {
            finish(agent.id, consumed, {
              notice: "This turn also included a workspace message. Read the reply in the session.",
            });
            return;
          }
          text = turn.text;
        } catch (error) {
          finish(agent.id, consumed, { notice: "Office could not read the session’s reply." });
          log(`[office] chat could not read the answer of ${agent.id}: ${errorMessage(error)}`);
          return;
        }
      }
      if (outcome.kind === "canceled") {
        finish(agent.id, consumed, {
          notice: "The turn was canceled before a reply was available.",
        });
        return;
      }
      if (outcome.kind === "failed") {
        const message = isUsageLimit(outcome.error.message)
          ? "The provider reached its usage limit before the session could reply."
          : "The session failed before it could reply. Open the session for details.";
        finish(agent.id, consumed, { notice: message });
        return;
      }
      finish(
        agent.id,
        consumed,
        text === null ? { notice: "The turn ended without a text reply." } : { answer: text },
      );
    },

    archived(agentId) {
      availableForGroup.delete(agentId);
      const entries = waiting.get(agentId);
      const member = roster.get(agentId) ?? entries?.[0]?.member;
      if (entries)
        finish(agentId, entries, {
          notice: "The session was archived before a reply was available.",
        });
      roster.delete(agentId);
      if (member !== undefined) engine.onLeft(member.name);
    },

    closed(agentId) {
      availableForGroup.delete(agentId);
      const entries = waiting.get(agentId);
      if (entries)
        finish(agentId, entries, { notice: "The session closed before a reply was available." });
    },

    async request(input) {
      switch (input.op) {
        case "photo": {
          if (!isOfficePhoto(input.data))
            return { ok: false, error: "The office photo is not a valid 480 × 360 JPEG." };
          if (!engine.fresh(`office-photo:${input.requestId}`)) return OK;
          const pictures = engine.state.msgs.filter((message) => message.photo);
          for (const old of pictures.slice(
            0,
            Math.max(0, pictures.length + 1 - GROUP_PHOTO_COUNT),
          )) {
            old.photo = null;
            emit("update", old);
          }
          engine.photo(input.data);
          return OK;
        }
        case "life":
          return life(input);
        case "send":
          return send(input);
        case "react":
          engine.react(input.id, "me", input.emoji);
          return OK;
        case "vote":
          engine.vote(input.id, "me", input.index);
          return OK;
        case "poll":
          engine.poll("me", input.question, input.options);
          return OK;
        case "pin": {
          const message = engine.byId(input.id);
          if (!message || message.recalled || message.kind === "sys")
            return { ok: false, error: "This message cannot be pinned." };
          if (engine.state.pinned !== input.id) engine.pin(input.id, tr("chat.boss"));
          return OK;
        }
        case "rsvp":
          engine.rsvp(input.id, "me", input.yes);
          return OK;
        case "recall":
          return recall(input.id);
      }
    },

    async stop() {
      stopped = true;
      // The session may carry on, but this process can no longer forward its reply. Store the
      // notice with the original message, so a client that reconnects can still see it.
      for (const [id, entries] of waiting) {
        finish(id, entries, {
          notice: "Office stopped while waiting for a reply. Check the session for its answer.",
        });
      }
      live = false;
      cancelClock?.();
      for (const cancel of timers) cancel();
      timers.clear();
      await saving;
    },
  };
}
