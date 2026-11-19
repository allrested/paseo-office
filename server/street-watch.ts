import type { StreetEvent } from "../shared/contracts.js";
import type { DirectoryView } from "./hub.js";
import type { Exec } from "./repo-age.js";
import type { Clock } from "./timers.js";

export const TAG_INTERVAL = 60_000;
const VERSION_INTERVAL = 5 * 60_000;

export function streetReaders(exec: Exec) {
  async function read(command: string, args: string[], cwd: string) {
    try {
      return (
        await exec(command, args, {
          cwd,
          timeout: 5_000,
          maxBuffer: 1 << 20,
          env: {
            ...process.env,
            GIT_OPTIONAL_LOCKS: "0",
            CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
          },
        })
      ).stdout.trim();
    } catch {
      return null;
    }
  }
  return {
    async tags(folder: string) {
      const output = await read(
        "git",
        ["for-each-ref", "--sort=-creatordate", "--format=%(refname:strip=2)", "refs/tags"],
        folder,
      );
      return output === null ? null : new Set(output.split("\n").filter(Boolean));
    },
    async version() {
      const output = await read("claude", ["--version"], process.cwd());
      return /^(\d+\.\d+\.\d+)(?:\s+\(Claude Code\))?$/i.exec(output ?? "")?.[1] ?? null;
    },
  };
}

interface Subscriber {
  push(event: StreetEvent): Promise<void>;
  signal: AbortSignal;
}
type Version = Extract<StreetEvent, { type: "claude" }>["reading"];
/** Only mounted streets subscribe. The first successful read of each folder establishes its baseline. */
export function createStreetWatch(
  readers: ReturnType<typeof streetReaders>,
  clock: Clock,
  log: (message: string) => void,
) {
  const listeners = new Map<Subscriber, () => void>();
  let folders = new Map<string, { tags: Set<string> | null }>();
  let version: Version = null,
    lastKnown: string | null = null;
  let nextVersion = 0,
    epoch = 0,
    cancel: (() => void) | undefined;
  function send(to: Subscriber, event: StreetEvent) {
    void to.push(event).catch((error) => log("Street event failed: " + String(error)));
  }
  function publish(event: StreetEvent) {
    for (const sub of listeners.keys()) send(sub, event);
  }
  async function readVersion(mine: number) {
    const current = await readers.version();
    if (mine !== epoch) return;
    nextVersion = clock.now() + VERSION_INTERVAL;
    if (current === (version?.version ?? null)) return;
    let at = 0;
    if (current && lastKnown && current.localeCompare(lastKnown, "en", { numeric: true }) > 0)
      at = clock.now();
    version = current ? { version: current, at } : null;
    if (current) lastKnown = current;
    publish({ type: "claude", reading: version });
  }
  async function poll(mine: number) {
    if (clock.now() >= nextVersion) await readVersion(mine);
    if (mine !== epoch) return;
    const announced = new Set<string>();
    for (const [folder, state] of folders) {
      if (mine !== epoch) return;
      const tags = await readers.tags(folder);
      if (!tags || mine !== epoch || folders.get(folder) !== state) continue;
      const previous = state.tags;
      if (previous) {
        // Like the booth's own queue, carry at most the newest three from a bulk tag import.
        const added = [...tags]
          .filter((tag) => !previous.has(tag))
          .slice(0, 3)
          .toReversed();
        for (const tag of added)
          if (!announced.has(tag)) {
            announced.add(tag);
            publish({ type: "release", tag });
          }
      }
      state.tags = tags;
    }
    if (mine === epoch) cancel = clock.setTimeout(() => void poll(mine), TAG_INTERVAL);
  }
  function idle() {
    epoch++;
    cancel?.();
    cancel = undefined;
    nextVersion = 0;
    version = null;
    lastKnown = null;
    for (const state of folders.values()) state.tags = null;
  }
  return {
    view(view: DirectoryView | null) {
      const paths = new Set(
        view?.agents.flatMap((agent) => {
          const folder = agent.workspaceId && view.folders?.[agent.workspaceId];
          return folder && agent.status !== "closed" ? [folder] : [];
        }),
      );
      folders = new Map([...paths].map((path) => [path, folders.get(path) ?? { tags: null }]));
    },
    attach(sub: Subscriber) {
      if (sub.signal.aborted) return Promise.resolve();
      return new Promise<void>((resolve) => {
        function close() {
          listeners.delete(sub);
          sub.signal.removeEventListener("abort", close);
          if (!listeners.size) idle();
          resolve();
        }
        listeners.set(sub, close);
        sub.signal.addEventListener("abort", close, { once: true });
        send(sub, { type: "claude", reading: version });
        if (listeners.size === 1) void poll(epoch);
      });
    },
    stop() {
      for (const close of listeners.values()) close();
    },
  };
}
