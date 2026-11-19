import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePaseo } from "@getpaseo/plugin/client";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { failureText } from "./action-button.js";
import {
  conversationRows,
  type ConversationRow,
  type TimelineEntry,
} from "./conversation-model.js";

export interface Conversation {
  rows: ConversationRow[];
  /** "loading" until the first page arrived; "error" when it could not be read. */
  status: "loading" | "ready" | "error";
  error: string | null;
  /** True while there are earlier entries not loaded yet. */
  hasEarlier: boolean;
  loadingEarlier: boolean;
  /** True when the last earlier page could not be read; the next attempt clears it. */
  earlierFailed: boolean;
  loadEarlier(): void;
  retry(): void;
}

// No wholeTurns: it has no size limit, and a long turn would be read whole. The rows merge what the
// server merges, so a page that starts inside a turn reads right; Show earlier reads the rest.
const PAGE = { limit: 60 } as const;

/** An entry as held: a page entry covers seqStart..seqEnd (merged pieces), a live piece one number. */
interface Held extends TimelineEntry {
  end: number;
}

interface Cursor {
  epoch: string;
  seq: number;
}

/** The part of a timeline page this hook reads: `entries`, `epoch`, `startCursor`, `hasOlder`, `error`. */
interface Page {
  entries: readonly {
    seqStart: number;
    seqEnd: number;
    item: AgentTimelineItem;
    turnId?: string;
  }[];
  /** The numbering the page's sequence numbers belong to. */
  epoch: string;
  startCursor: Cursor | null;
  hasOlder: boolean;
  staleCursor: boolean;
  error: string | null;
}

interface State {
  agentId: string;
  held: Held[];
  /** The epoch the held numbers belong to; null until a page or a live piece names it. */
  epoch: string | null;
  status: Conversation["status"];
  error: string | null;
  /** Cursor of the earliest page read: the next earlier page is "before" it. */
  cursor: Cursor | null;
  hasEarlier: boolean;
  loadingEarlier: boolean;
  earlierFailed: boolean;
}

const fresh = (agentId: string): State => ({
  agentId,
  held: [],
  epoch: null,
  status: "loading",
  error: null,
  cursor: null,
  hasEarlier: false,
  loadingEarlier: false,
  earlierFailed: false,
});

function fromPage(page: Page): Held[] {
  return page.entries.map((e) => ({
    seq: e.seqStart,
    end: e.seqEnd,
    item: e.item,
    turnId: e.turnId,
  }));
}

/**
 * Adds a live piece in sequence order, unless a held entry already covers its number. A piece
 * past the last held entry, which is nearly always, is appended with no scan and no sort.
 */
function withLive(held: Held[], seq: number, item: AgentTimelineItem, turnId?: string): Held[] {
  const piece: Held = { seq, end: seq, item, turnId };
  const last = held[held.length - 1];
  if (last === undefined || seq > last.end) return held.concat(piece);
  if (held.some((h) => h.seq <= seq && seq <= h.end)) return held;
  let at = held.length;
  while (at > 0 && held[at - 1]!.seq > seq) at -= 1;
  return [...held.slice(0, at), piece, ...held.slice(at)];
}

function liveItem(
  event: unknown,
): { seq: number; item: AgentTimelineItem; turnId?: string; epoch?: string } | null {
  const message = event as {
    seq?: number;
    epoch?: string;
    event?: { type?: string; item?: AgentTimelineItem; turnId?: string };
  };
  if (message.event?.type !== "timeline" || !message.event.item) return null;
  if (typeof message.seq !== "number") return null;
  return {
    seq: message.seq,
    item: message.event.item,
    turnId: message.event.turnId,
    epoch: message.epoch,
  };
}

function checked(page: Page): Page {
  if (page.error) throw new Error(page.error);
  return page;
}

export function useConversation(agentId: string): Conversation {
  const paseo = usePaseo();
  const [state, setState] = useState<State>(() => fresh(agentId));
  const [attempt, setAttempt] = useState(0);
  const stateRef = useRef(state);
  const earlierRef = useRef<(() => void) | null>(null);

  const commit = useCallback((change: (current: State) => State) => {
    stateRef.current = change(stateRef.current);
    setState(stateRef.current);
  }, []);

  useEffect(() => {
    let alive = true;
    // Bumped whenever the latest page replaces what is held: an earlier page asked before it is stale.
    let generation = 0;
    commit(() => fresh(agentId));
    const timeline = paseo.agents.ref(agentId).timeline;

    const fail = (failure: unknown) => {
      if (!alive) return;
      commit((s) => ({
        ...s,
        status: "error",
        error: failureText("read the conversation", failure),
      }));
    };
    // `keepLive` keeps the live pieces held past the page's last entry: what came while the page was
    // read, or after a restored subscription. They are kept only when the page is of the epoch of
    // what is held: another epoch numbers the history afresh, so everything held is replaced. A
    // replacement says so too, and keeps none.
    const readLatest = async (keepLive: boolean) => {
      const page = checked((await timeline.refetch({ direction: "tail", ...PAGE })) as Page);
      if (!alive) return;
      generation += 1;
      const fromTail = fromPage(page);
      const pageEnd = fromTail.length === 0 ? -1 : fromTail[fromTail.length - 1]!.end;
      commit((s) => ({
        ...s,
        held:
          keepLive && (s.epoch === null || s.epoch === page.epoch)
            ? fromTail.concat(s.held.filter((h) => h.seq > pageEnd))
            : fromTail,
        epoch: page.epoch,
        status: "ready",
        error: null,
        cursor: page.startCursor,
        hasEarlier: page.hasOlder && page.startCursor !== null,
        loadingEarlier: false,
        earlierFailed: false,
      }));
    };
    const reread = (keepLive: boolean) => void readLatest(keepLive).catch(fail);

    const subscription = timeline.subscribe((event) => {
      if (!alive) return;
      const kind = (event as { event?: { type?: string } }).event?.type;
      if (kind === "replacement") return reread(false);
      if (kind === "subscription_restored") return reread(true);
      if (kind === "error") return fail((event as { event: { error: string } }).event.error);
      const piece = liveItem(event);
      if (piece)
        commit((s) => ({
          ...s,
          held: withLive(s.held, piece.seq, piece.item, piece.turnId),
          epoch: s.epoch ?? piece.epoch ?? null,
        }));
    });

    earlierRef.current = () => {
      const { cursor, hasEarlier, loadingEarlier } = stateRef.current;
      if (!alive || !hasEarlier || loadingEarlier || cursor === null) return;
      const asked = generation;
      commit((s) => ({ ...s, loadingEarlier: true, earlierFailed: false }));
      void (async () => {
        try {
          const page = checked(
            (await timeline.refetch({ direction: "before", cursor, ...PAGE })) as Page,
          );
          if (!alive || asked !== generation) return;
          // The cursor no longer matches the history: what the page holds is not what comes before.
          if (page.staleCursor) return reread(false);
          commit((s) => ({
            ...s,
            held: fromPage(page).concat(s.held),
            cursor: page.startCursor ?? s.cursor,
            hasEarlier: page.hasOlder && page.startCursor !== null,
            loadingEarlier: false,
          }));
        } catch {
          if (alive && asked === generation)
            commit((s) => ({ ...s, loadingEarlier: false, earlierFailed: true }));
        }
      })();
    };

    subscription.ready.then(() => readLatest(true)).catch(fail);
    return () => {
      alive = false;
      earlierRef.current = null;
      subscription();
    };
    // `paseo` is the one object the host keeps per installation, so this runs once per agent.
  }, [paseo, agentId, attempt, commit]);

  const view = state.agentId === agentId ? state : fresh(agentId);
  const rows = useMemo(() => conversationRows(view.held), [view.held]);
  const loadEarlier = useCallback(() => earlierRef.current?.(), []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return {
    rows,
    status: view.status,
    error: view.error,
    hasEarlier: view.hasEarlier,
    loadingEarlier: view.loadingEarlier,
    earlierFailed: view.earlierFailed,
    loadEarlier,
    retry,
  };
}
