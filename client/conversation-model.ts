import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

/**
 * One line of a session's conversation. Reasoning, todo lists, compaction markers and plugin
 * items have no row on purpose: the conversation shows what the owner and the agent said, one
 * line per tool call, and anything that went wrong.
 */
export type ConversationRow =
  | { kind: "you"; key: string; text: string }
  | { kind: "agent"; key: string; text: string }
  | { kind: "tool"; key: string; text: string }
  | { kind: "notice"; key: string; text: string; tone: "muted" | "danger" };

/** One timeline entry as the hook keeps it: the item and the sequence number it arrived with. */
export interface TimelineEntry {
  seq: number;
  item: AgentTimelineItem;
}

type ToolCall = Extract<AgentTimelineItem, { type: "tool_call" }>;

/** A tool line is cut here, ellipsis included. */
const TOOL_LINE_MAX = 120;

/** What a tool call acted on: a command, a path, a query, a URL. Empty when it has no such thing. */
function toolTarget(detail: ToolCall["detail"]): string {
  switch (detail.type) {
    case "shell":
      return detail.command;
    case "read":
    case "edit":
    case "write":
      return detail.filePath;
    case "search":
      return detail.query;
    case "fetch":
      return detail.url;
    case "sub_agent":
      return detail.description ?? "";
    case "plain_text":
      return detail.label ?? detail.text ?? "";
    default:
      return "";
  }
}

function toolHead(item: ToolCall): string {
  if (item.status === "failed") return `${item.name} failed`;
  if (item.status === "canceled") return `${item.name} canceled`;
  return item.name;
}

/** A tool call as one line: its name and a short summary, never its input or output in full. */
export function toolLine(item: ToolCall): string {
  const target = toolTarget(item.detail).replace(/\s+/g, " ").trim();
  const line = `${toolHead(item).replace(/\s+/g, " ").trim()}${target ? `: ${target}` : ""}`;
  return line.length > TOOL_LINE_MAX ? `${line.slice(0, TOOL_LINE_MAX - 1).trimEnd()}…` : line;
}

function rowFor(entry: TimelineEntry): ConversationRow | null {
  const { item } = entry;
  const key = String(entry.seq);
  switch (item.type) {
    case "user_message":
      return item.text.trim() ? { kind: "you", key, text: item.text } : null;
    case "assistant_message":
      return item.text.trim() ? { kind: "agent", key, text: item.text } : null;
    case "tool_call":
      return { kind: "tool", key, text: toolLine(item) };
    case "error":
      return item.message.trim()
        ? { kind: "notice", key, text: item.message, tone: "danger" }
        : null;
    case "notification":
      return item.message.trim()
        ? {
            kind: "notice",
            key,
            text: item.message,
            tone: item.level === "error" ? "danger" : "muted",
          }
        : null;
    default:
      return null;
  }
}

/** A repeat of a call keeps the detail it knew when the repeat says "unknown", as the server's page does. */
function mergedCall(earlier: ToolCall, later: ToolCall): ToolCall {
  const detail = later.detail.type === "unknown" ? earlier.detail : later.detail;
  return { ...earlier, ...later, detail };
}

/**
 * The rows of a timeline, in order. A page comes merged from the server and live events do not,
 * so the same merging is done here: the streamed pieces of one assistant message are one row (a
 * piece with no messageId continues the message right before it), and a tool call's updates are
 * one row, rewritten in place from the newest.
 */
export function conversationRows(entries: readonly TimelineEntry[]): ConversationRow[] {
  const rows: ConversationRow[] = [];
  const calls = new Map<string, { index: number; item: ToolCall }>();
  // Whether the row at the end of `rows` is an assistant message the next piece may continue,
  // and its messageId.
  let open = false;
  let openMessageId: string | null = null;
  for (const entry of entries) {
    const { item } = entry;
    const last = rows[rows.length - 1];
    if (
      open &&
      item.type === "assistant_message" &&
      (item.messageId === undefined || item.messageId === openMessageId) &&
      last?.kind === "agent"
    ) {
      last.text += item.text;
      continue;
    }
    const known = item.type === "tool_call" ? calls.get(item.callId) : undefined;
    if (known && item.type === "tool_call") {
      const merged = mergedCall(known.item, item);
      calls.set(item.callId, { index: known.index, item: merged });
      rows[known.index] = { kind: "tool", key: rows[known.index].key, text: toolLine(merged) };
      open = false;
      continue;
    }
    const row = rowFor(entry);
    open = row?.kind === "agent" && item.type === "assistant_message";
    openMessageId = open && item.type === "assistant_message" ? (item.messageId ?? null) : null;
    if (row) {
      if (item.type === "tool_call") calls.set(item.callId, { index: rows.length, item });
      rows.push(row);
    }
  }
  return rows;
}
