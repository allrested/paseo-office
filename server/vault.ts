import { z } from "zod";
import type { OfficeAgent } from "../shared/contracts.js";
import { agentTitle } from "../shared/model.js";
import { LOBBY } from "../shared/names.js";
import {
  VAULT_HITS_MAX,
  VAULT_MESSAGES_MAX,
  VAULT_TALKS_MAX,
  VAULT_TEXT_MAX,
  VaultMessageSchema,
  promptReport,
  searchWords,
  snippetOf,
  type PromptReport,
  type VaultHit,
  type VaultTalk,
} from "../shared/vault.js";
import { errorMessage } from "./errors.js";
import type { DirectoryView } from "./hub.js";

/** How many of an agent's newest timeline items are read after each of its turns. */
export const VAULT_TAIL_LIMIT = 80;

export const TalkSchema = z.object({
  name: z.string(),
  team: z.string(),
  /** The last timeline sequence number read: what comes after is new. */
  seq: z.number(),
  messages: z.array(VaultMessageSchema),
});
export type Talk = z.output<typeof TalkSchema>;

export const VaultFileSchema = z.object({
  version: z.literal(1),
  talks: z.record(z.string(), TalkSchema),
});
export type VaultFile = z.output<typeof VaultFileSchema>;

/** A timeline entry as the vault reads it: when, where in the timeline, and the item. */
export interface VaultEntry {
  at: number;
  seq: number;
  item: { type: string; text?: unknown };
}

export interface VaultPorts {
  /** The newest entries of an agent's timeline, oldest first. */
  tail(agentId: string): Promise<readonly VaultEntry[]>;
  /** Whether the owner has turned the vault on; off, nothing is read or kept. */
  on(): boolean;
  /** One conversation as it is now; the caller writes it when it sees fit. */
  save(agentId: string, talk: Talk): void;
  /** A conversation the vault no longer keeps. */
  drop(agentId: string): void;
  log(message: string): void;
}

export interface Vault {
  /** The office as the directory reports it; an agent seen for the first time, or whose turn ended, is read. */
  view(view: DirectoryView | null): void;
  search(query: string): VaultHit[];
  talk(agentId: string): VaultTalk | null;
  /** The prompts sent since `from` against the prompt helper's rules. */
  report(from: number): PromptReport;
  /** Resolves when every read asked for so far has ended. */
  settled(): Promise<void>;
}

function cut(text: string): string {
  return text.length > VAULT_TEXT_MAX ? `${text.slice(0, VAULT_TEXT_MAX - 1)}…` : text;
}

function lastAt(talk: Talk): number {
  return talk.messages.at(-1)?.at ?? 0;
}

/**
 * What was said in each conversation, kept on the host after the agent is gone: the prompts and
 * the replies, not the tool calls. It reads an agent's timeline when it first sees the agent and
 * after each of its turns, so it holds what was said while an office was open.
 */
export function createVault(ports: VaultPorts, kept: VaultFile | null): Vault {
  const talks = new Map<string, Talk>(Object.entries(kept?.talks ?? {}));
  const resting = new Map<string, boolean>();
  let chain: Promise<void> = Promise.resolve();

  function saved(agentId: string, talk: Talk): void {
    ports.save(agentId, talk);
    if (talks.size <= VAULT_TALKS_MAX) return;
    const oldest = [...talks].sort((a, b) => lastAt(a[1]) - lastAt(b[1]));
    for (const [id] of oldest.slice(0, talks.size - VAULT_TALKS_MAX)) {
      talks.delete(id);
      ports.drop(id);
    }
  }

  async function read(agent: OfficeAgent, team: string): Promise<void> {
    const entries = await ports.tail(agent.id);
    const talk = talks.get(agent.id) ?? { name: "", team, seq: -1, messages: [] };
    let added = false;
    for (const entry of entries) {
      const { type, text } = entry.item;
      if (entry.seq <= talk.seq) continue;
      talk.seq = entry.seq;
      if ((type !== "user_message" && type !== "assistant_message") || typeof text !== "string") {
        continue;
      }
      if (text.trim() === "") continue;
      const role = type === "user_message" ? "user" : "assistant";
      talk.messages.push({ at: entry.at, role, text: cut(text) });
      added = true;
    }
    if (!added) return;
    talk.name = agentTitle(agent);
    talk.team = team;
    if (talk.messages.length > VAULT_MESSAGES_MAX) {
      talk.messages = talk.messages.slice(-VAULT_MESSAGES_MAX);
    }
    talks.set(agent.id, talk);
    saved(agent.id, talk);
  }

  return {
    view(view) {
      if (view === null || !ports.on()) {
        // Seen again later, each agent is read again: what it said meanwhile is then new.
        resting.clear();
        return;
      }
      const teams = new Map(view.workspaces.map((workspace) => [workspace.id, workspace.name]));
      for (const agent of view.agents) {
        const rests = agent.status === "idle" || agent.status === "error";
        const before = resting.get(agent.id);
        resting.set(agent.id, rests);
        if (before !== undefined && !(rests && !before)) continue;
        const team = (agent.workspaceId && teams.get(agent.workspaceId)) || LOBBY;
        chain = chain
          .then(() => read(agent, team))
          .catch((error: unknown) =>
            ports.log(`[office] history of ${agent.id}: ${errorMessage(error)}`),
          );
      }
    },
    search(query) {
      const words = searchWords(query);
      const hits: VaultHit[] = [];
      for (const [agentId, talk] of talks) {
        for (const message of talk.messages) {
          const snippet = snippetOf(message.text, words);
          if (snippet === null) continue;
          const { at, role } = message;
          hits.push({ agentId, name: talk.name, team: talk.team, at, role, snippet });
        }
      }
      return hits.sort((a, b) => b.at - a.at).slice(0, VAULT_HITS_MAX);
    },
    talk(agentId) {
      const talk = talks.get(agentId);
      if (talk === undefined) return null;
      return { agentId, name: talk.name, team: talk.team, messages: talk.messages };
    },
    report(from) {
      const prompts: string[] = [];
      for (const talk of talks.values()) {
        for (const message of talk.messages) {
          if (message.role === "user" && message.at >= from) prompts.push(message.text);
        }
      }
      return promptReport(prompts);
    },
    settled: () => chain,
  };
}
