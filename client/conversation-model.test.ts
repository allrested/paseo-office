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

test("a piece without a messageId continues the assistant message before it, as the server's page does", () => {
  const rows = conversationRows(
    entries(
      { type: "assistant_message", text: "One " },
      { type: "assistant_message", text: "Two" },
      { type: "assistant_message", text: "!", messageId: "m1" },
      { type: "assistant_message", text: "?" },
    ),
  );
  // An id the run did not have starts a message; a piece with none continues whatever came before.
  expect(rows).toEqual([
    { kind: "agent", key: "1", text: "One Two" },
    { kind: "agent", key: "3", text: "!?" },
  ]);
});

test("a piece without a messageId after something else starts its own row", () => {
  const rows = conversationRows(
    entries(
      { type: "assistant_message", text: "A" },
      tool({ detail: { type: "shell", command: "ls" } }),
      { type: "assistant_message", text: "B" },
      { type: "reasoning", text: "hm" },
      { type: "assistant_message", text: "C" },
    ),
  );
  expect(rows.map((row) => row.text)).toEqual(["A", "Bash: ls", "B", "C"]);
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

test("running then completed with one call id is one row, with the completed text", () => {
  const rows = conversationRows(
    entries(
      { type: "user_message", text: "go" },
      tool({ status: "running", detail: { type: "shell", command: "npm test" } }),
      { type: "assistant_message", text: "Waiting." },
      tool({ status: "completed", detail: { type: "shell", command: "npm test" } }),
    ),
  );
  // The repeat rewrites the row where it was, under its first key.
  expect(rows).toEqual([
    { kind: "you", key: "1", text: "go" },
    { kind: "tool", key: "2", text: "Bash: npm test" },
    { kind: "agent", key: "3", text: "Waiting." },
  ]);
  const failed = conversationRows(
    entries(
      tool({ status: "running", detail: { type: "shell", command: "make" } }),
      tool({ status: "failed", error: "boom", detail: { type: "shell", command: "make" } }),
    ),
  );
  expect(failed).toEqual([
    { kind: "tool", key: "1", text: "Bash failed: make", outcome: "failed" },
  ]);
});

test("calls with different ids are different rows; a repeat with no detail keeps the earlier one", () => {
  const rows = conversationRows(
    entries(
      tool({ callId: "c1", detail: { type: "shell", command: "ls" } }),
      tool({ callId: "c2", detail: { type: "shell", command: "pwd" } }),
      tool({ callId: "c1", detail: { type: "unknown", input: null, output: null } }),
    ),
  );
  expect(rows.map((row) => row.text)).toEqual(["Bash: ls", "Bash: pwd"]);
});

/** Entries with the turn each belongs to: `[turnId, item]` pairs, numbered from 1. */
function turns(...pairs: [string | undefined, AgentTimelineItem][]): TimelineEntry[] {
  return pairs.map(([turnId, item], index) => ({ seq: index + 1, item, turnId }));
}

test("a call id used again in a later turn is a new row, not the earlier turn's call", () => {
  const call = (status: ToolCall["status"], command: string) =>
    tool({ callId: "c1", status, detail: { type: "shell", command } });
  const rows = conversationRows(
    turns(
      ["t1", call("completed", "npm test")],
      ["t2", call("running", "npm run lint")],
      ["t2", call("completed", "npm run lint")],
    ),
  );
  expect(rows).toEqual([
    { kind: "tool", key: "1", text: "Bash: npm test" },
    { kind: "tool", key: "2", text: "Bash: npm run lint" },
  ]);
});

test("the first piece of a new turn with no messageId starts a new row; the same turn continues", () => {
  const say = (text: string): AgentTimelineItem => ({ type: "assistant_message", text });
  const rows = conversationRows(
    turns(["t1", say("Done")], ["t1", say(" now.")], ["t2", say("Next")], ["t2", say(" step")]),
  );
  expect(rows).toEqual([
    { kind: "agent", key: "1", text: "Done now." },
    { kind: "agent", key: "3", text: "Next step" },
  ]);
});

test("pieces of one message id in different turns are different rows", () => {
  const say = (text: string): AgentTimelineItem => ({
    type: "assistant_message",
    text,
    messageId: "m1",
  });
  expect(conversationRows(turns(["t1", say("One")], ["t2", say("Two")])).map((r) => r.key)).toEqual(
    ["1", "2"],
  );
});

test("entries that carry no turn merge as before", () => {
  const say = (text: string): AgentTimelineItem => ({ type: "assistant_message", text });
  expect(conversationRows(turns([undefined, say("a")], [undefined, say("b")]))).toEqual([
    { kind: "agent", key: "1", text: "ab" },
  ]);
});

test("an image-only message reopened from Paseo keeps its attachments in order", () => {
  const imageUrls = ["file:///tmp/a.png", "file:///tmp/b.png"];
  const message = { type: "user_message" as const, text: "", imageUrls };
  expect(conversationRows(entries(message))).toEqual([
    { kind: "you", key: "1", text: "", imageUrls },
  ]);
});
