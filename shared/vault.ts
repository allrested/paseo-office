import { z } from "zod";
import { coach } from "./upstream/prompt-coach.js";

/** The most characters of a message the vault keeps, of messages per conversation, and of conversations. */
export const VAULT_TEXT_MAX = 2000;
export const VAULT_MESSAGES_MAX = 300;
export const VAULT_TALKS_MAX = 200;
/** The most hits a search answers with: the newest. */
export const VAULT_HITS_MAX = 40;

export const VaultMessageSchema = z.object({
  /** Epoch ms. */
  at: z.number(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
});
export type VaultMessage = z.output<typeof VaultMessageSchema>;

export const VaultHitSchema = z.object({
  agentId: z.string(),
  name: z.string(),
  team: z.string(),
  at: z.number(),
  role: z.enum(["user", "assistant"]),
  /** The words around the first match, on one line. */
  snippet: z.string(),
});
export type VaultHit = z.output<typeof VaultHitSchema>;

export const VaultTalkSchema = z.object({
  agentId: z.string(),
  name: z.string(),
  team: z.string(),
  messages: z.array(VaultMessageSchema),
});
export type VaultTalk = z.output<typeof VaultTalkSchema>;

/** The words of a search: lower case, none empty. Every one of them has to be in a message. */
export function searchWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
}

const SNIPPET_BEFORE = 50;
const SNIPPET_MAX = 160;

/** The text around its first match of `words`, on one line; null when a word is missing. */
export function snippetOf(text: string, words: readonly string[]): string | null {
  const lower = text.toLowerCase();
  if (words.length === 0 || !words.every((word) => lower.includes(word))) return null;
  const at = Math.min(...words.map((word) => lower.indexOf(word)));
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const cut = text
    .slice(start, start + SNIPPET_MAX)
    .replace(/\s+/g, " ")
    .trim();
  return `${start > 0 ? "…" : ""}${cut}${start + SNIPPET_MAX < text.length ? "…" : ""}`;
}

/** The prompt helper's rules a sent prompt can break; a photo's rule needs the draft, not the text. */
export const REPORT_RULES = ["tooShort", "vague", "dangling", "multi"] as const;
export type ReportRule = (typeof REPORT_RULES)[number];

export const RULE_TEXT: Readonly<Record<ReportRule, { title: string; advice: string }>> = {
  tooShort: {
    title: "Too short to act on",
    advice: "Say what result you want the session to produce.",
  },
  vague: { title: "No way to tell when it is done", advice: "Add what done looks like." },
  dangling: {
    title: "Points at something it does not name",
    advice: "Name the file, the section or the message you mean.",
  },
  multi: { title: "Several tasks in one message", advice: "Number the tasks, or send them apart." },
};

const RuleCountSchema = z.object({
  rule: z.enum(REPORT_RULES),
  count: z.number(),
  /** Up to three of the prompts, cut to a line. */
  examples: z.array(z.string()),
});

export const PromptReportSchema = z.object({
  /** The prompts read, and those no rule had anything to say about. */
  total: z.number(),
  clean: z.number(),
  rules: z.array(RuleCountSchema),
});
export type PromptReport = z.output<typeof PromptReportSchema>;

const EXAMPLE_MAX = 90;
const EXAMPLES = 3;

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > EXAMPLE_MAX ? `${line.slice(0, EXAMPLE_MAX - 1)}…` : line;
}

/**
 * The prompts against the prompt helper's rules: how many each rule speaks to, with examples.
 * The helper's own code decides, word lists and all; no model reads anything.
 */
export function promptReport(prompts: readonly string[]): PromptReport {
  const found = new Map<ReportRule, { count: number; examples: string[] }>();
  let clean = 0;
  for (const text of prompts) {
    const rules = new Set<ReportRule>();
    for (const hint of coach({ text, photos: 0, quoted: false })) {
      if (hint.id !== "photoBare") rules.add(hint.id);
    }
    if (rules.size === 0) clean += 1;
    for (const rule of rules) {
      const entry = found.get(rule) ?? { count: 0, examples: [] };
      entry.count += 1;
      if (entry.examples.length < EXAMPLES) entry.examples.push(oneLine(text));
      found.set(rule, entry);
    }
  }
  const rules = REPORT_RULES.flatMap((rule) => {
    const entry = found.get(rule);
    return entry === undefined ? [] : [{ rule, ...entry }];
  }).sort((a, b) => b.count - a.count);
  return { total: prompts.length, clean, rules };
}
