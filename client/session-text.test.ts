import { expect, test } from "vitest";
import type { OfficeAgent } from "../shared/contracts.js";
import { UNLISTED_LINE, composerPlaceholder, rowLabel, statusLine } from "./session-text.js";

const AGENT: OfficeAgent = {
  id: "a1",
  title: "Builder",
  provider: "claude",
  model: null,
  status: "idle",
  workspaceId: "w1",
  parentAgentId: null,
  permissions: [],
  createdAt: "2026-11-19T08:00:00.000Z",
};
const running: OfficeAgent = { ...AGENT, status: "running" };

test("the status line is the agent's state, after its room when it has one", () => {
  expect(statusLine(AGENT, "Acme shop")).toBe("Acme shop · Idle");
  expect(statusLine(running, null)).toBe("Running");
  const asking = {
    ...AGENT,
    status: "idle",
    permissions: [{ id: "p1", kind: "tool", title: "Run ls" }],
  } as OfficeAgent;
  expect(statusLine(asking, null)).not.toBe("Idle");
});

test("the composer asks to add to a running turn, and otherwise to message the agent", () => {
  expect(composerPlaceholder(running)).toBe("Add to the running turn");
  expect(composerPlaceholder(AGENT)).toBe("Message Builder");
  // The warning that a send denies a waiting request is its own line, not part of the prompt.
  const asking = { ...running, permissions: [{ id: "p1", kind: "tool", title: "Run ls" }] };
  expect(composerPlaceholder(asking as OfficeAgent)).toBe("Add to the running turn");
  expect(composerPlaceholder({ ...AGENT, title: null })).toBe("Message Agent a1");
});

test("a row's accessible name starts with who spoke", () => {
  expect(rowLabel({ kind: "you", key: "k", text: "Hi" }, "Builder")).toBe("You: Hi");
  expect(rowLabel({ kind: "agent", key: "k", text: "Done" }, "Builder")).toBe("Builder: Done");
  expect(rowLabel({ kind: "tool", key: "k", text: "Ran ls" }, "Builder")).toBe("Ran ls");
  expect(rowLabel({ kind: "notice", key: "k", text: "Stopped", tone: "muted" }, "Builder")).toBe(
    "Stopped",
  );
});

test("an agent the office does not list has a line that is true of closed, archived and starting", () => {
  expect(UNLISTED_LINE).toBe(
    "The office does not list this agent: it may be closed, archived or still starting.",
  );
});
