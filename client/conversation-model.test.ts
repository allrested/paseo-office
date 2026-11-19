import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { expect, test } from "vitest";
import { conversationRows, toolLine, type TimelineEntry } from "./conversation-model.js";

type ToolCall = Extract<AgentTimelineItem, { type: "tool_call" }>;

function entries(...items: AgentTimelineItem[]): TimelineEntry[] {
  return items.map((item, index) => ({ seq: index + 1, item }));
}

function tool(overrides: Partial<ToolCall> & Pick<ToolCall, "detail">): ToolCall {
  return {
    type: "tool_call",
    callId: "c1",
    name: "Bash",
    status: "completed",
    error: null,
    ...overrides,
  } as ToolCall;
}

test("a user message is a you row and an assistant message an agent row", () => {
  const rows = conversationRows(
    entries(
      { type: "user_message", text: "Fix SHOP-12" },
      { type: "assistant_message", text: "On it." },
    ),
  );
  expect(rows).toEqual([
    { kind: "you", key: "1", text: "Fix SHOP-12" },
    { kind: "agent", key: "2", text: "On it." },
  ]);
});

test("assistant pieces with the same messageId are one row, keyed by the first seq", () => {
  const rows = conversationRows(
    entries(
      { type: "assistant_message", text: "Hel", messageId: "m1" },
      { type: "assistant_message", text: "lo", messageId: "m1" },
      { type: "assistant_message", text: "Next", messageId: "m2" },
    ),
  );
  expect(rows).toEqual([
    { kind: "agent", key: "1", text: "Hello" },
    { kind: "agent", key: "3", text: "Next" },
  ]);
});

test("assistant messages without a messageId do not join", () => {
  const rows = conversationRows(
    entries({ type: "assistant_message", text: "One" }, { type: "assistant_message", text: "Two" }),
  );
  expect(rows.map((row) => row.text)).toEqual(["One", "Two"]);
});

test("a run is broken by an item between its pieces", () => {
  const rows = conversationRows(
    entries(
      { type: "assistant_message", text: "A", messageId: "m1" },
      { type: "user_message", text: "hey" },
      { type: "assistant_message", text: "B", messageId: "m1" },
    ),
  );
  expect(rows.map((row) => row.kind)).toEqual(["agent", "you", "agent"]);
});

test("reasoning, todo, compaction and plugin items give no row", () => {
  const rows = conversationRows(
    entries(
      { type: "reasoning", text: "thinking about it" },
      { type: "todo", items: [{ text: "step", completed: false }] },
      { type: "compaction", status: "completed" },
      {
        type: "plugin",
        id: "p1",
        pluginId: "acme",
        kind: "x",
        version: 1,
        data: null,
      },
    ),
  );
  expect(rows).toEqual([]);
});

test("a tool call is one tool row", () => {
  const rows = conversationRows(entries(tool({ detail: { type: "shell", command: "npm test" } })));
  expect(rows).toEqual([{ kind: "tool", key: "1", text: "Bash: npm test" }]);
});

test("a tool line names the target of each kind of call", () => {
  expect(
    toolLine(
      tool({
        name: "Read",
        detail: { type: "read", filePath: "/srv/acme/a.ts" },
      }),
    ),
  ).toBe("Read: /srv/acme/a.ts");
  expect(toolLine(tool({ name: "Grep", detail: { type: "search", query: "TODO" } }))).toBe(
    "Grep: TODO",
  );
  expect(
    toolLine(
      tool({
        name: "Fetch",
        detail: { type: "fetch", url: "https://acme.test" },
      }),
    ),
  ).toBe("Fetch: https://acme.test");
  expect(
    toolLine(
      tool({
        name: "Mystery",
        detail: { type: "unknown", input: 1, output: 2 },
      }),
    ),
  ).toBe("Mystery");
});

test("a failed or canceled call says so", () => {
  const failed = tool({
    status: "failed",
    error: "boom",
    detail: { type: "shell", command: "make" },
  });
  expect(toolLine(failed)).toBe("Bash failed: make");
  const canceled = tool({
    status: "canceled",
    detail: { type: "shell", command: "make" },
  });
  expect(toolLine(canceled)).toBe("Bash canceled: make");
});

test("a tool line is one line of at most 120 characters", () => {
  const line = toolLine(
    tool({
      detail: { type: "shell", command: `echo a\n  b ${"x".repeat(300)}` },
    }),
  );
  expect(line).not.toMatch(/[\r\n]/);
  expect(line.length).toBeLessThanOrEqual(120);
  expect(line.endsWith("…")).toBe(true);
  expect(line.startsWith("Bash: echo a b ")).toBe(true);
});

test("an error is a danger notice and a notification's tone follows its level", () => {
  const rows = conversationRows(
    entries(
      { type: "error", message: "It broke" },
      { type: "notification", level: "error", message: "Quota" },
      { type: "notification", level: "warning", message: "Slow" },
      { type: "notification", level: "info", message: "FYI" },
    ),
  );
  expect(rows).toEqual([
    { kind: "notice", key: "1", text: "It broke", tone: "danger" },
    { kind: "notice", key: "2", text: "Quota", tone: "danger" },
    { kind: "notice", key: "3", text: "Slow", tone: "muted" },
    { kind: "notice", key: "4", text: "FYI", tone: "muted" },
  ]);
});

test("empty text gives no row", () => {
  const rows = conversationRows(
    entries(
      { type: "user_message", text: "" },
      { type: "assistant_message", text: "  \n" },
      { type: "error", message: "" },
    ),
  );
  expect(rows).toEqual([]);
});

test("rows keep the entries' order and keys are unique", () => {
  const rows = conversationRows(
    entries(
      { type: "user_message", text: "a" },
      { type: "assistant_message", text: "b", messageId: "m" },
      { type: "assistant_message", text: "c", messageId: "m" },
      tool({ detail: { type: "shell", command: "ls" } }),
      { type: "error", message: "e" },
    ),
  );
  expect(rows.map((row) => row.kind)).toEqual(["you", "agent", "tool", "notice"]);
  expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
});
