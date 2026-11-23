import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import type { Alert } from "../shared/alerts.js";
import { alertDismissRpc, alertsRpc } from "../shared/contracts.js";
import type { StripCard } from "./attention-strip.js";

const NO_ALERTS: readonly Alert[] = [];
/** The office's own reads are 5 s apart: asking every other one is soon enough. */
const EVERY_MS = 10_000;

export interface AlertsState {
  /** A card of the Attention strip for each alert, newest first. */
  cards: StripCard[];
  /** The alert whose card is open; null when none is, and once it is gone. */
  open: Alert | null;
  close(): void;
  /** Dismisses the open alert and closes its card. */
  dismiss(): Promise<void>;
}

/** What the office noticed, asked for while `live`, as cards that open one alert at a time. */
export function useAlerts(live: boolean): AlertsState {
  const ask = useRpc(alertsRpc);
  const drop = useRpc(alertDismissRpc);
  // Kept in a ref: the poll restarts when the office goes live, not when the call's identity changes.
  const asking = useRef(ask);
  asking.current = ask;
  const [alerts, setAlerts] = useState<readonly Alert[]>(NO_ALERTS);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    if (!live) {
      setAlerts(NO_ALERTS);
      return undefined;
    }
    let ended = false;
    const read = async () => {
      try {
        const answer = await asking.current({});
        if (!ended) setAlerts(answer.alerts);
      } catch {
        // (the host went away: the next reading says)
      }
    };
    void read();
    const timer = setInterval(() => void read(), EVERY_MS);
    return () => {
      ended = true;
      clearInterval(timer);
    };
  }, [live]);
  const cards = useMemo(
    () =>
      alerts.map(
        (alert): StripCard => ({
          title: alert.title,
          note: { text: alert.detail || "Open to act on it", tone: "warning" },
          onOpen: () => setOpenId(alert.id),
        }),
      ),
    [alerts],
  );
  const open = useMemo(() => alerts.find((alert) => alert.id === openId) ?? null, [alerts, openId]);
  const close = useCallback(() => setOpenId(null), []);
  const dismiss = useCallback(async () => {
    if (openId === null) return;
    const answer = await drop({ id: openId });
    setAlerts(answer.alerts);
    setOpenId(null);
  }, [drop, openId]);
  return { cards, open, close, dismiss };
}
