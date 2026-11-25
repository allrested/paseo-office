/**
 * @vitest-environment jsdom
 */
// The session panel, mounted: the conversation hook is a stand-in the test sets, and the actions
// are mocks the test reads. The host's scroller and input are plain stand-ins.
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ScrollViewProps } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi, type Mock } from "vitest";
import type { OfficeAgent } from "../shared/contracts.js";
import type { ConversationRow } from "./conversation-model.js";
import { SessionPanel, type SessionPanelProps } from "./session-panel.js";
import { useOfficeStyles } from "./styles.js";
import type { Conversation } from "./use-conversation.js";
import type { AgentActions } from "./use-agent-actions.js";

const metadataMock = vi.hoisted(() => {
  const setMetadata = vi.fn(async () => undefined);
  return { setMetadata, ref: vi.fn(() => ({ setMetadata })) };
});
vi.mock("@getpaseo/plugin/client", () => ({
  usePaseo: () => ({ agents: { ref: metadataMock.ref } }),
}));

let conversation: Conversation;
let asked: string[];
/** The keys of the rows drawn: `rowLabel` runs once each time a row draws. */
let drawn: string[];

vi.mock("./session-text.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./session-text.js")>();
  return {
    ...actual,
    rowLabel: (row: ConversationRow, name: string) => {
      drawn.push(row.key);
      return actual.rowLabel(row, name);
    },
  };
});

/** The host's "Gen-UI cards" setting, as the panel reads it. */
let uiCards: boolean;
vi.mock("./use-ui-cards.js", () => ({ useUiCards: () => uiCards }));

vi.mock("./use-conversation.js", () => ({
  useConversation: (agentId: string) => {
    asked.push(agentId);
    return conversation;
  },
}));

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { forwardRef, useImperativeHandle } = await import("react");
  const { TextInput, View } = await import("react-native");
  const ScrollView = forwardRef<unknown, ScrollViewProps & { children?: ReactNode }>(
    (props, ref) => {
      useImperativeHandle(ref, () => ({ scrollToEnd: () => undefined }));
      return createElement(View, null, props.children);
    },
  );
  const Markdown = ({ children }: { children: string }) =>
    createElement("div", { "data-markdown": "" }, children);
  const Body = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
  return {
    Modal: Object.assign(Body, { Content: Body }),
    ScrollView,
    TextInput,
    Markdown,
    Icon: () => null,
  };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
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

let send: Mock<AgentActions["send"]>;
let respond: Mock<AgentActions["respond"]>;
let cancel: Mock<(agentId: string) => Promise<void>>;
let onClose: Mock<() => void>;
let onOpenWorkspace: Mock<() => void>;
let container: HTMLElement;
let root: Root;

function ready(rows: ConversationRow[], extra: Partial<Conversation> = {}): Conversation {
  return {
    rows,
    status: "ready",
    error: null,
    hasEarlier: false,
    loadingEarlier: false,
    earlierFailed: false,
    loadEarlier: vi.fn(),
    retry: vi.fn(),
    ...extra,
  };
}

function Harness(props: Partial<SessionPanelProps>) {
  const layout = { compact: true, platform: "web" } as const;
  const styles = useOfficeStyles(THEME, layout.compact, false);
  // The surface keeps the reply's text; here the harness does, for as long as it stays mounted.
  const [text, setText] = useState("");
  return createElement(SessionPanel, {
    agent: AGENT,
    agentId: "a1",
    draft: { text, setText },
    room: "Acme shop",
    actions: { send, respond, cancel },
    styles,
    layout,
    onOpenWorkspace,
    onClose,
    ...props,
  });
}

const draw = (props: Partial<SessionPanelProps> = {}) =>
  act(async () => root.render(createElement(Harness, props)));

beforeEach(() => {
  asked = [];
  drawn = [];
  uiCards = false;
  conversation = ready([]);
  send = vi.fn(async () => undefined);
  respond = vi.fn(async () => undefined);
  cancel = vi.fn(async () => undefined);
  onClose = vi.fn();
  onOpenWorkspace = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  Reflect.deleteProperty(window, "matchMedia");
});

const maybe = (label: string) => container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
function labelled(label: string): HTMLElement {
  const found = maybe(label);
  if (!found) throw new Error(`Nothing is labelled "${label}"`);
  return found;
}
const press = (label: string) => act(async () => labelled(label).click());
const box = () => labelled("Message") as HTMLTextAreaElement;
const alerts = () =>
  [...container.querySelectorAll('[role="alert"]')].map((element) => element.textContent);

async function type(text: string): Promise<void> {
  const field = box();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function key(name: string, shiftKey = false): Promise<void> {
  const field = box();
  await act(async () => {
    field.focus();
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, shiftKey, bubbles: true, cancelable: true }),
    );
  });
}
const touchScreen = () =>
  (window.matchMedia = ((query: string) => ({
    matches: query === "(any-pointer: coarse)",
  })) as never);

test("the header shows the title, the room and the state; Open in workspace and Close press through", async () => {
  await draw();
  expect(asked).toEqual(["a1"]);
  expect(container.textContent).toContain("Builder");
  expect(container.textContent).toContain("Acme shop · Idle");
  await press("Open in workspace");
  expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
  await press("Close");
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("without a way to the workspace, Open in workspace is not drawn", async () => {
  await draw({ onOpenWorkspace: undefined });
  expect(maybe("Open in workspace")).toBeNull();
  expect(maybe("Close")).not.toBeNull();
});

test("the workspace dialog provides the close control for its embedded session", async () => {
  await draw({ hideClose: true, onOpenWorkspace: undefined });
  expect(maybe("Close")).toBeNull();
  expect(box().getAttribute("placeholder")).toBe("Message Builder");
});

test("session detail shows reported usage, filters live steps and opens a child without losing a draft", async () => {
  const onOpenSubagent = vi.fn();
  const child = { ...AGENT, id: "a2", parentAgentId: AGENT.id, title: "Check types" };
  conversation = ready([
    { kind: "agent", key: "1", text: "I’ll run the checks." },
    { kind: "tool", key: "2", text: "Running tsc" },
  ]);
  await draw({
    agent: {
      ...AGENT,
      model: "Sonnet",
      context: { usedTokens: 500, maxTokens: 1000 },
      costUsd: 1.25,
    },
    subagents: [child],
    onOpenSubagent,
  });
  expect(container.textContent).toContain("Sonnet");
  expect(container.textContent).toContain("50%");
  expect(container.textContent).toContain("$1.25");
  await type("Keep this draft");
  await press("Session steps");
  expect(maybe("Running tsc")).not.toBeNull();
  expect(maybe("Builder: I’ll run the checks.")).toBeNull();
  await press("Session subagents");
  await press("Open Check types, Idle");
  expect(onOpenSubagent).toHaveBeenCalledWith("a2");
  await press("Session chat");
  expect(maybe("Builder: I’ll run the checks.")).not.toBeNull();
  expect(box().value).toBe("Keep this draft");
});

test("rows draw in order; the two voices are told apart by name; a tool is one line", async () => {
  conversation = ready([
    { kind: "you", key: "1", text: "Fix the login" },
    { kind: "agent", key: "2", text: "On it" },
    { kind: "tool", key: "3", text: "Ran npm test" },
    { kind: "notice", key: "4", text: "Turn failed", tone: "danger" },
  ]);
  await draw();
  const you = labelled("You: Fix the login");
  const agent = labelled("Builder: On it");
  const tool = labelled("Ran npm test");
  const notice = labelled("Turn failed");
  const follows = (a: Node, b: Node) =>
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  expect(follows(you, agent) && follows(agent, tool) && follows(tool, notice)).toBe(true);
  expect(tool.textContent).toBe("Ran npm test");
  expect(getComputedStyle(tool.querySelector("div,span") ?? tool).whiteSpace).toBe("nowrap");
});

const UI_REPLY = [
  "Three threads are open.",
  "",
  "```ui",
  'Card("Review threads", [Table(["MR"], [["payme !27"]])])',
  "```",
  "",
  "```ui",
  'Card("Still coming", [',
].join("\n");

test("a reply's ui block is its source until Gen-UI cards is on, then a card with its title", async () => {
  conversation = ready([{ kind: "agent", key: "1", text: UI_REPLY }]);
  await draw();
  const markdown = () =>
    [...container.querySelectorAll("[data-markdown]")].map((element) => element.textContent);
  expect(markdown()).toEqual([UI_REPLY]);
  expect(container.textContent).not.toContain("Drawn in the workspace chat.");
  uiCards = true;
  await draw();
  // The prose stays Markdown; neither block's source is drawn.
  expect(markdown()).toEqual(["Three threads are open."]);
  const reply = container.textContent ?? "";
  expect(reply).toContain("Review threads");
  expect(reply).toContain("Drawn in the workspace chat.");
  // The second block is still streaming.
  expect(reply).toContain("Still coming");
  expect(reply).toContain("Being written...");
  expect(reply).not.toContain("Table(");
});

test("chat folds consecutive tool steps, leaves a failed call visible, and keeps the run open during updates", async () => {
  const tools: ConversationRow[] = [
    { kind: "tool", key: "1", text: "shell: npm test" },
    { kind: "tool", key: "2", text: "shell: git status" },
  ];
  const failure = {
    kind: "tool",
    key: "3",
    outcome: "failed",
    text: "shell failed: npm run build",
  } as const;
  conversation = ready([...tools, failure, { kind: "agent", key: "4", text: "**Build** failed." }]);
  await draw();
  expect(labelled("2 tool steps").getAttribute("aria-expanded")).toBe("false");
  expect(maybe("shell: npm test")).toBeNull();
  expect(maybe(failure.text)).not.toBeNull();
  expect(container.querySelector("[data-markdown]")?.textContent).toBe("**Build** failed.");
  await press("2 tool steps");
  expect(maybe("shell: npm test")).not.toBeNull();
  conversation = ready([...tools, { kind: "tool", key: "5", text: "shell: git diff" }, failure]);
  await draw();
  expect(labelled("3 tool steps").getAttribute("aria-expanded")).toBe("true");
  await press("3 tool steps");
  expect(maybe("shell: git diff")).toBeNull();
  await press("Session steps");
  expect(maybe("shell: git diff")).not.toBeNull();
  expect(maybe("3 tool steps")).toBeNull();
});

test("a complete Office lobby assignment shows its task and can disclose the original prompt", async () => {
  const text = [
    "The office assigned you lobby task p30 from the user.",
    "  Improve the workspace.",
    "  Keep the office open.",
    'Work on this task. When it is complete, use office_update with id "p30" and action "done". If you need input, leave it claimed and explain what you need.',
    "If the tool is unavailable and you have finished, put this exact line at the end of your reply: Completed office task p30 (assignment 31).",
  ].join("\n");
  conversation = ready([{ kind: "you", key: "1", text }]);
  await draw();
  expect(container.textContent).toContain("Improve the workspace.\nKeep the office open.");
  expect(container.textContent).not.toContain("office_update");
  await press("Lobby task p30, original message");
  expect(container.textContent).toContain(text);
  await press("Lobby task p30, original message");
  expect(container.textContent).not.toContain("office_update");
  conversation = ready([
    { kind: "you", key: "1", text: text.replace("(assignment 31).", "and more") },
  ]);
  await draw();
  expect(maybe("Lobby task p30, original message")).toBeNull();
  expect(container.textContent).toContain("office_update");
});

test("while loading it says so; an error is the sentence and a Retry", async () => {
  conversation = ready([], { status: "loading" });
  await draw();
  expect(container.textContent).toContain("Loading...");
  conversation = ready([], { status: "error", error: "Unable to read the conversation: offline" });
  await draw();
  expect(container.textContent).not.toContain("Loading...");
  expect(alerts()).toEqual(["Unable to read the conversation: offline"]);
  await press("Retry");
  expect(conversation.retry).toHaveBeenCalledTimes(1);
});

test("Show earlier is above the rows, loads, and is disabled while a page loads", async () => {
  conversation = ready([{ kind: "you", key: "1", text: "Hi" }], { hasEarlier: true });
  await draw();
  const earlier = labelled("Show earlier");
  expect(earlier.compareDocumentPosition(labelled("You: Hi"))).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  await press("Show earlier");
  expect(conversation.loadEarlier).toHaveBeenCalledTimes(1);
  conversation = ready([{ kind: "you", key: "1", text: "Hi" }], {
    hasEarlier: true,
    loadingEarlier: true,
  });
  await draw();
  expect(labelled("Show earlier").hasAttribute("disabled")).toBe(true);
});

test("an earlier page that could not be read is said above the rows", async () => {
  conversation = ready([{ kind: "you", key: "1", text: "Hi" }], {
    hasEarlier: true,
    earlierFailed: true,
  });
  await draw();
  expect(alerts()).toEqual(["Unable to read earlier messages. Try again."]);
  expect(maybe("Show earlier")).not.toBeNull();
});

test("a pending permission is answered above the composer, with the request's id", async () => {
  await draw({
    agent: {
      ...AGENT,
      permissions: [{ id: "p1", kind: "tool", title: "Run ls", detail: "ls -la" }],
    },
  });
  expect(container.textContent).toContain("Run ls");
  expect(labelled("Approve").compareDocumentPosition(box())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  await press("Approve");
  expect(respond).toHaveBeenCalledWith("a1", "p1", true);
  await press("Deny");
  expect(respond).toHaveBeenLastCalledWith("a1", "p1", false);
});

test("a waiting request that a send would deny is said by the box whatever is typed", async () => {
  const asking = {
    ...AGENT,
    permissions: [{ id: "p1", kind: "tool" as const, title: "Run ls" }],
  };
  await draw({ agent: asking });
  const line = () =>
    [...container.querySelectorAll("div, span")].some(
      (element) =>
        element.children.length === 0 &&
        element.textContent === "Sending denies the request above.",
    );
  expect(line()).toBe(true);
  await type("Not now");
  expect(line()).toBe(true);
  expect(box().placeholder).toBe("Message Builder");
  await draw({ agent: AGENT });
  expect(line()).toBe(false);
});

const PLAN = {
  id: "p2",
  kind: "plan" as const,
  title: "Plan ready",
  detail: "Move the ledger to the new table",
};

test("a plan or a question cannot be answered here: the panel says where, with its detail", async () => {
  await draw({ agent: { ...AGENT, permissions: [PLAN] } });
  expect(maybe("Approve")).toBeNull();
  expect(container.textContent).toContain("Plan ready");
  expect(container.textContent).toContain("Move the ledger to the new table");
  expect(container.textContent).toContain("Answer this in the workspace.");
});

test("with no way to the workspace the request says it cannot be answered here", async () => {
  await draw({ agent: { ...AGENT, permissions: [PLAN] }, onOpenWorkspace: undefined });
  expect(container.textContent).toContain("Plan ready");
  expect(container.textContent).not.toContain("Answer this in the workspace.");
  expect(container.textContent).toContain("This cannot be answered here.");
});

test("Send sends the trimmed text and clears the box; empty text sends nothing", async () => {
  await draw();
  await press("Send");
  expect(send).not.toHaveBeenCalled();
  await type("  Add tests  ");
  await press("Send");
  expect(send).toHaveBeenCalledWith("a1", "Add tests", { activeTurnBehavior: "steer" });
  expect(box().value).toBe("");
  expect(box().getAttribute("placeholder")).toBe("Message Builder");
});

test("a streamed piece redraws only the row that changed", async () => {
  const rows = (last: string): ConversationRow[] => [
    { kind: "you", key: "1", text: "Hi" },
    { kind: "tool", key: "2", text: "Bash: ls" },
    { kind: "agent", key: "3", text: last },
  ];
  conversation = ready(rows("Hel"));
  await draw();
  expect(drawn).toEqual(["1", "2", "3"]);
  drawn = [];
  // The rows are new objects each time the list is read: only a changed one may draw again.
  conversation = ready(rows("Hello"));
  await draw();
  expect(drawn).toEqual(["3"]);
  expect(container.textContent).toContain("Hello");
});

test("a send that fails shows its reason under the box and keeps the text", async () => {
  send.mockRejectedValueOnce(new Error("Host offline."));
  await draw();
  await type("Add tests");
  await press("Send");
  expect(box().value).toBe("Add tests");
  expect(alerts()).toEqual(["Unable to send: Host offline."]);
  expect(box().compareDocumentPosition(container.querySelector('[role="alert"]')!)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  await press("Send");
  expect(box().value).toBe("");
  expect(alerts()).toEqual([]);
});

test("Stop is drawn while the agent runs and the host can stop a turn", async () => {
  await draw();
  expect(maybe("Stop")).toBeNull();
  await draw({ agent: { ...AGENT, status: "running" }, actions: { send, respond, cancel: null } });
  expect(maybe("Stop")).toBeNull();
  await draw({ agent: { ...AGENT, status: "running" } });
  expect(box().getAttribute("placeholder")).toBe("Add to the running turn");
  await press("Stop");
  expect(cancel).toHaveBeenCalledWith("a1");
});

test("an agent the office does not list: the line and Close, no composer", async () => {
  await draw({ agent: null, room: null });
  expect(container.textContent).toContain("The office does not list this agent");
  expect(maybe("Message")).toBeNull();
  expect(maybe("Send")).toBeNull();
  await press("Close");
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("an agent the office does not list still has Open in workspace where the app gives one", async () => {
  await draw({ agent: null, room: null });
  await press("Open in workspace");
  expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
  await draw({ agent: null, room: null, onOpenWorkspace: undefined });
  expect(maybe("Open in workspace")).toBeNull();
  expect(maybe("Close")).not.toBeNull();
});

test("with a keyboard Enter sends and Shift+Enter does not", async () => {
  await draw();
  await type("hello");
  await key("Enter", true);
  expect(send).not.toHaveBeenCalled();
  await key("Enter");
  expect(send).toHaveBeenCalledWith("a1", "hello", { activeTurnBehavior: "steer" });
  expect(box().value).toBe("");
});

test("two Enter presses while a send is pending make one call", async () => {
  let finish: () => void = () => undefined;
  send.mockImplementationOnce(() => new Promise<void>((done) => void (finish = done)));
  await draw();
  await type("hello");
  await key("Enter");
  await key("Enter");
  expect(labelled("Sending...").hasAttribute("disabled")).toBe(true);
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => finish());
});

test("on a touch screen Enter is a new line and the Send button sends", async () => {
  touchScreen();
  await draw();
  await type("hello");
  await key("Enter");
  expect(send).not.toHaveBeenCalled();
  await press("Send");
  expect(send).toHaveBeenCalledWith("a1", "hello", { activeTurnBehavior: "steer" });
});

test("Customize agent saves the chosen profile and can restore the defaults", async () => {
  await draw({ agent: { ...AGENT, appearance: { name: "Ada" } } });
  await press("Customize agent");
  expect((labelled("Office display name") as HTMLInputElement).value).toBe("Ada");
  await press("Male");
  await press("headphones");
  await press("Teal");
  await press("Save appearance");
  expect(metadataMock.ref).toHaveBeenCalledWith(AGENT.id);
  expect(metadataMock.setMetadata).toHaveBeenLastCalledWith({
    "office.appearance": { name: "Ada", gender: "Male", avatar: "headphones", color: "Teal" },
  });
  expect(maybe("Office display name")).toBeNull();
  await draw({
    agent: { ...AGENT, appearance: { gender: "Female", avatar: "headphones", color: "Teal" } },
  });
  await press("Customize agent");
  await press("Automatic gender");
  await press("Initials");
  await press("Automatic color");
  await press("Save appearance");
  expect(metadataMock.setMetadata).toHaveBeenLastCalledWith({ "office.appearance": null });
});
