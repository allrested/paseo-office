import { useCallback, useState } from "react";
import { useRpc, useSubscription } from "@getpaseo/plugin/client";
import { lifeSubscription, tenureRpc, type LifeEvent } from "../../shared/contracts.js";

const NO_INPUT = {};
export interface LifeState {
  life: LifeEvent | null;
  /** A farewell was held or an intern made permanent: tell the server, which answers with the list. */
  tell(op: { op: "farewell" | "official"; name: string }): void;
}

/** What the daily-life scenes are fed beyond the people: ages, the tenure list, the lift's servicing. */
export function useLife(): LifeState {
  const [life, setLife] = useState<LifeEvent | null>(null);
  const onEvent = useCallback((event: LifeEvent) => {
    setLife(event);
  }, []);
  const subscription = useSubscription(lifeSubscription, NO_INPUT, onEvent);
  const write = useRpc(tenureRpc);
  const tell = useCallback(
    (op: { op: "farewell" | "official"; name: string }) => {
      void write(op).catch(() => undefined);
    },
    [write],
  );
  const live = subscription.status !== "error" && subscription.status !== "closed";
  return { life: live ? life : null, tell };
}
