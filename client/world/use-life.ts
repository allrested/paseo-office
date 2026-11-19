import { useCallback, useState } from "react";
import { useRpc, useSubscription } from "@getpaseo/plugin/client";
import { chatRpc, lifeSubscription, tenureRpc, type LifeEvent } from "../../shared/contracts.js";

const NO_INPUT = {};

export interface LifeState {
  /** What the staff scenes read beyond the people; null until the server has said, and after it stopped. */
  life: LifeEvent | null;
  /** A moment of the office's life for the team chat: the server words it. */
  say(kind: string, vars: Record<string, string>): void;
  /** A farewell was held or an intern made permanent: the server's ledger keeps it and answers with the list. */
  tell(op: { op: "farewell" | "official"; name: string }): void;
}

/** The 3D office's staff scenes, as the plugin's server feeds them and hears from them. */
export function useLife(): LifeState {
  const [life, setLife] = useState<LifeEvent | null>(null);
  const onEvent = useCallback((event: LifeEvent) => {
    setLife(event);
  }, []);
  const subscription = useSubscription(lifeSubscription, NO_INPUT, onEvent);
  const chat = useRpc(chatRpc);
  const write = useRpc(tenureRpc);
  // Neither waits nor reports: a line or a write that does not arrive is a scene that does not play.
  const say = useCallback(
    (kind: string, vars: Record<string, string>) => {
      void chat({ op: "life", kind, vars }).catch(() => undefined);
    },
    [chat],
  );
  const tell = useCallback(
    (op: { op: "farewell" | "official"; name: string }) => {
      void write(op).catch(() => undefined);
    },
    [write],
  );
  const live = subscription.status !== "error" && subscription.status !== "closed";
  return { life: live ? life : null, say, tell };
}
