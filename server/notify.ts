import type { Notice } from "../shared/notify.js";
import { isTokenSafe } from "../shared/settings.js";

export const NOTIFY_TIMEOUT_MS = 10_000;

export type NotifyResult = { ok: true } | { ok: false; problem: string };

export interface NotifierPorts {
  /** The owner's webhook address; empty for none. */
  url(): string;
  fetchFn?: typeof fetch;
  log(message: string): void;
}

export interface Notifier {
  /** Sends one message. Never rejects, and never names the address: it may hold a key. */
  send(notice: Notice): Promise<NotifyResult>;
}

// Only these labels leave a failed request: its message may hold the address.
const NETWORK_ERRORS = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function reason(error: unknown): string {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "it did not answer in 10 seconds";
  }
  const cause: unknown = error instanceof Error ? error.cause : undefined;
  const code = (cause as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && NETWORK_ERRORS.has(code) ? code : "the request failed";
}

/**
 * Posts what the office raises to one address as JSON, so the owner hears of it with no office
 * open. The plugin SDK has no notification of its own for a server.
 */
export function createNotifier(ports: NotifierPorts): Notifier {
  return {
    async send(notice) {
      const url = ports.url().trim();
      if (url === "") return { ok: false, problem: "No webhook address is set" };
      if (!isTokenSafe(url)) {
        return {
          ok: false,
          problem: "The webhook address is not https (plain http only on this machine)",
        };
      }
      let problem: string;
      try {
        const response = await (ports.fetchFn ?? fetch)(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(notice),
          redirect: "error",
          signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
        });
        if (response.ok) return { ok: true };
        problem = `The webhook answered ${response.status}`;
      } catch (error) {
        problem = `The webhook could not be reached: ${reason(error)}`;
      }
      ports.log(`[office] notify (${notice.kind}): ${problem}`);
      return { ok: false, problem };
    },
  };
}
