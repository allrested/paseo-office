import chat, { type ChatWords } from "./upstream/chat.js";
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

function find(key: string): ChatWords | undefined {
  if (key === "people.director") return DIRECTOR;
  if (Object.hasOwn(OURS, key)) return OURS[key];
  if (!key.startsWith(CHAT_PREFIX)) return undefined;
  let found: ChatWords | undefined = chat;
  for (const part of key.slice(CHAT_PREFIX.length).split(".")) {
    if (found === undefined || typeof found === "string" || isList(found)) return undefined;
    found = found[part];
  }
  return found;
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

function translate(key: string, vars?: object | null): string;
function translate(key: string, vars: object | null, as: "list"): string[];
function translate(key: string, vars?: object | null, as?: "list"): string | string[] {
  const words = find(key);
  if (as === "list") {
    if (typeof words === "string") return [words];
    if (words === undefined || !isList(words)) return [];
    return words.filter((item): item is string => typeof item === "string");
  }
  const values = Object.fromEntries(Object.entries(vars ?? {}));
  const text = line(words, values);
  return text === undefined ? key : fill(text, values);
}

/**
 * The engine's `tr` over upstream's English `chat` area, with the stand-in's rules: an array is
 * one of its lines at random, a one/other pair is chosen by `n`, `{name}` is filled from `vars`,
 * and an unknown key gives the key. Upstream's emoji stay: the scene strips them for its speech
 * bubbles, which the chat does not have.
 */
export const chatT: Translate = translate;
