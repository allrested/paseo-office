import { useCallback, useEffect, useMemo, useState, type SetStateAction } from "react";
import { NO_REPLY_IMAGES, type ReplyImages } from "./reply-send.js";

/** What is typed in each open session's reply box, and the images attached to it, by agent id. */
export interface ReplyDrafts {
  texts: ReadonlyMap<string, string>;
  images: ReadonlyMap<string, ReplyImages>;
  setImages(agentId: string, next: SetStateAction<ReplyImages>): void;
  /** Takes an updater as well: a send that returns keeps what was typed while it was away. */
  setText(agentId: string, next: SetStateAction<string>): void;
}

/**
 * The reply boxes' text and images, the surface's as the chat's are: a tab switch or a dismissed
 * phone sheet keeps a half-typed reply and what is attached. A session that is no longer open
 * loses its draft, however it was closed.
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
  const [images, setImageMap] = useState<ReadonlyMap<string, ReplyImages>>(new Map());
  const setImages = useCallback((agentId: string, next: SetStateAction<ReplyImages>) => {
    setImageMap((current) => {
      const before = current.get(agentId) ?? NO_REPLY_IMAGES;
      const after = typeof next === "function" ? next(before) : next;
      if (after === before) return current;
      const map = new Map(current);
      if (after.length === 0) map.delete(agentId);
      else map.set(agentId, after);
      return map;
    });
  }, []);
  useEffect(() => {
    setTexts((current) => {
      const kept = [...current].filter(([agentId]) => open.includes(agentId));
      return kept.length === current.size ? current : new Map(kept);
    });
    setImageMap((current) => {
      const kept = [...current].filter(([agentId]) => open.includes(agentId));
      return kept.length === current.size ? current : new Map(kept);
    });
  }, [open]);
  return useMemo(
    () => ({ texts, setText, images, setImages }),
    [texts, setText, images, setImages],
  );
}
