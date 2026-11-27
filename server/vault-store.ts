import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { errorMessage } from "./errors.js";
import type { Timers } from "./timers.js";
import { TalkSchema, VaultFileSchema, type Talk, type VaultFile } from "./vault.js";

const TalkFileSchema = z.object({ version: z.literal(1), agentId: z.string(), talk: TalkSchema });

/**
 * The vault's folder, office/vault/: one file per conversation, so a turn's end writes that
 * conversation and not every conversation kept.
 */
export interface VaultStore {
  /** Every conversation kept; an earlier version's vault.json is moved into the folder first. */
  load(): Promise<VaultFile | null>;
  /** The conversation as it is when written, at most once per `ms`. */
  save(agentId: string, talk: Talk): void;
  drop(agentId: string): void;
  /** Writes what waits now. */
  flush(): Promise<void>;
}

export function createVaultStore(
  directory: string,
  legacyFile: string,
  timers: Timers,
  log: (message: string) => void,
  ms = 30_000,
): VaultStore {
  /** What waits to be written: a conversation, or null for one to delete. */
  const waiting = new Map<string, Talk | null>();
  let cancel: (() => void) | null = null;
  let writing: Promise<void> = Promise.resolve();
  let temp = 0;

  const fileOf = (agentId: string) => join(directory, `${encodeURIComponent(agentId)}.json`);

  async function write(agentId: string, talk: Talk | null): Promise<void> {
    const file = fileOf(agentId);
    if (talk === null) {
      await rm(file, { force: true });
      return;
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    temp += 1;
    const tempFile = `${file}.tmp-${temp}`;
    try {
      const text = `${JSON.stringify({ version: 1, agentId, talk })}\n`;
      await writeFile(tempFile, text, { encoding: "utf8", mode: 0o600 });
      await rename(tempFile, file);
    } catch (error) {
      await rm(tempFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  function flush(): Promise<void> {
    cancel?.();
    cancel = null;
    // Copied now: the vault keeps adding to the conversations it handed over.
    const batch = [...waiting].map(([id, talk]) => [id, structuredClone(talk)] as const);
    waiting.clear();
    for (const [agentId, talk] of batch) {
      writing = writing
        .then(() => write(agentId, talk))
        .catch((error: unknown) =>
          log(
            `[office] a conversation of the history vault could not be saved: ${errorMessage(error)}`,
          ),
        );
    }
    return writing;
  }

  function soon(): void {
    cancel ??= timers.setTimeout(() => void flush(), ms);
  }

  async function readFolder(): Promise<VaultFile["talks"] | null> {
    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      return null;
    }
    const talks: VaultFile["talks"] = {};
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const parsed = TalkFileSchema.safeParse(
          JSON.parse(await readFile(join(directory, name), "utf8")),
        );
        if (parsed.success) talks[parsed.data.agentId] = parsed.data.talk;
      } catch {
        // A file that cannot be read is one conversation lost, not the vault.
      }
    }
    return talks;
  }

  async function readLegacy(): Promise<VaultFile["talks"] | null> {
    try {
      const parsed = VaultFileSchema.safeParse(JSON.parse(await readFile(legacyFile, "utf8")));
      return parsed.success ? parsed.data.talks : null;
    } catch {
      return null;
    }
  }

  return {
    async load() {
      const talks = (await readFolder()) ?? {};
      const legacy = await readLegacy();
      if (legacy !== null) {
        // The folder's own copy is the newer one where both hold a conversation.
        for (const [agentId, talk] of Object.entries(legacy)) {
          if (talks[agentId] !== undefined) continue;
          await write(agentId, talk);
          talks[agentId] = talk;
        }
        await rm(legacyFile, { force: true });
      }
      return Object.keys(talks).length === 0 ? null : { version: 1, talks };
    },
    save(agentId, talk) {
      waiting.set(agentId, talk);
      soon();
    },
    drop(agentId) {
      waiting.set(agentId, null);
      soon();
    },
    flush,
  };
}
