import chat, { type ChatWords } from "./upstream/chat.js";
import { chatId } from "./chat-id.js";
import { chatInternational } from "./chat-international.js";
import type { ChatCulture } from "./settings.js";
import type { Translate } from "./upstream/chat-engine.js";

// Upstream's English name for the director (vendor/my-office/src/i18n/locales/en/people.js).
const DIRECTOR = "Director";
const CHAT_PREFIX = "chat.";

// Array.isArray does not narrow a readonly array.
function isList(words: ChatWords): words is readonly ChatWords[] {
  return Array.isArray(words);
}

// Lines the chat says that upstream words with a company's name: the office's own wording instead.
const OURS: Readonly<Record<string, readonly string[]>> = {
  "chat.life.pickleDone": [
    "Court time’s up 😆 {share} each 💸",
    "Tonight’s court was {share} each 🏓",
  ],
  "chat.life.nhauInvite": ["A few cans tonight, everyone? 🍻"],
  "chat.life.nhauYes": ["I’m in!", "Count me in 🙋", "Save me a seat", "Ok, the Ba Khía place"],
  "chat.life.nhauCheers": ["Một hai ba dô 🍻"],
  "chat.life.nhauNoDrive": ["If you’ve had a drink, don’t drive 🚕"],
  "chat.life.nhauRide": ["Ridely’s on its way"],
  "chat.life.parcel": [
    "{name}, a parcel for you 📦 come down for it",
    "The courier’s here with {name}’s parcel 📦",
  ],
};

/** What the chat's people write for a culture; a key a culture lacks reads the next one's. */
const LINES: Readonly<Record<ChatCulture, readonly Readonly<Record<string, ChatWords>>[]>> = {
  international: [chatInternational, OURS],
  indonesian: [],
  vietnamese: [OURS],
};
const DIRECTORS: Readonly<Record<ChatCulture, string>> = {
  international: DIRECTOR,
  indonesian: "Direktur",
  vietnamese: DIRECTOR,
};

function within(words: ChatWords | undefined, path: string): ChatWords | undefined {
  let found = words;
  for (const part of path.split(".")) {
    if (found === undefined || typeof found === "string" || isList(found)) return undefined;
    found = found[part];
  }
  return found;
}

function find(key: string, culture: ChatCulture): ChatWords | undefined {
  if (key === "people.director") return DIRECTORS[culture];
  for (const lines of LINES[culture]) if (Object.hasOwn(lines, key)) return lines[key];
  if (!key.startsWith(CHAT_PREFIX)) return undefined;
  const path = key.slice(CHAT_PREFIX.length);
  // Indonesian has what people write; the rest of the area stays upstream's English.
  const local = culture === "indonesian" ? within(chatId, path) : undefined;
  if (local !== undefined) return local;
  return Object.hasOwn(OURS, key) ? OURS[key] : within(chat, path);
}

function fill(text: string, values: Readonly<Record<string, unknown>>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined || value === null ? whole : String(value);
  });
}

function line(
  words: ChatWords | undefined,
  values: Readonly<Record<string, unknown>>,
): string | undefined {
  if (words === undefined || typeof words === "string") return words;
  if (isList(words)) return line(words[Math.floor(Math.random() * words.length)], values);
  // This English dictionary only pluralizes counts. Mobile clients can lack Intl.PluralRules.
  const chosen = Math.abs(Number(values.n)) === 1 ? (words.one ?? words.other) : words.other;
  return typeof chosen === "string" ? chosen : undefined;
}

/**
 * The engine's `tr` for a culture, with the stand-in's rules: an array is one of its lines at
 * random, a one/other pair is chosen by `n`, `{name}` is filled from `vars`, and an unknown key
 * gives the key. Upstream's emoji stay: the scene strips them for its speech bubbles, which the
 * chat does not have.
 */
export function chatWords(culture: ChatCulture): Translate {
  function translate(key: string, vars?: object | null): string;
  function translate(key: string, vars: object | null, as: "list"): string[];
  function translate(key: string, vars?: object | null, as?: "list"): string | string[] {
    const words = find(key, culture);
    if (as === "list") {
      if (typeof words === "string") return [words];
      if (words === undefined || !isList(words)) return [];
      return words.filter((item): item is string => typeof item === "string");
    }
    const values = Object.fromEntries(Object.entries(vars ?? {}));
    const text = line(words, values);
    return text === undefined ? key : fill(text, values);
  }
  return translate;
}

/** The chat's words where no host setting is at hand: the default culture's. */
export const chatT: Translate = chatWords("international");
