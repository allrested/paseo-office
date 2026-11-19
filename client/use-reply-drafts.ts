import { useCallback, useEffect, useMemo, useState, type SetStateAction } from "react";

/** What is typed in each open session's reply box, by agent id. */
export interface ReplyDrafts {
  texts: ReadonlyMap<string, string>;
  /** Takes an updater as well: a send that returns keeps what was typed while it was away. */
  setText(agentId: string, next: SetStateAction<string>): void;
}

/**
 * The reply boxes' text, the surface's as the chat's is: a tab switch or a dismissed phone sheet
 * keeps a half-typed reply. A session that is no longer open loses its draft, however it was closed.
 */
export function useReplyDrafts(open: readonly string[]): ReplyDrafts {
  const [texts, setTexts] = useState<ReadonlyMap<string, string>>(new Map());
  const setText = useCallback((agentId: string, next: SetStateAction<string>) => {
    setTexts((current) => {
      const before = current.get(agentId) ?? "";
      const after = typeof next === "function" ? next(before) : next;
      if (after === before) return current;
      const map = new Map(current);
      if (after === "") map.delete(agentId);
      else map.set(agentId, after);
      return map;
    });
  }, []);
  useEffect(() => {
    setTexts((current) => {
      const kept = [...current].filter(([agentId]) => open.includes(agentId));
      return kept.length === current.size ? current : new Map(kept);
    });
  }, [open]);
  return useMemo(() => ({ texts, setText }), [texts, setText]);
}
