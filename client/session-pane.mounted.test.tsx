/**
 * @vitest-environment jsdom
 */
// The session pane is given its own agent, so a change to another agent does not draw it again.
// The conversation hook is a stand-in whose calls count the panel's draws.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ScrollViewProps } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeAgent } from "../shared/contracts.js";
import type { OfficeModel } from "../shared/model.js";
import { NO_REPLY_IMAGES } from "./reply-send.js";
import { SessionPane, sessionOf, type SessionPaneProps } from "./session-pane.js";
import { useOfficeStyles } from "./styles.js";

let draws: number;

vi.mock("./use-ui-cards.js", () => ({ useUiCards: () => false }));

vi.mock("./use-conversation.js", () => ({
  useConversation: () => {
    draws += 1;
    return {
      rows: [],
      status: "ready",
      error: null,
      hasEarlier: false,
      loadingEarlier: false,
      earlierFailed: false,
      loadEarlier: () => undefined,
      retry: () => undefined,
    };
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
  return { ScrollView, TextInput, Icon: () => null };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const layout = { compact: true, platform: "web" } as const;

const agent = (id: string, status: OfficeAgent["status"] = "idle"): OfficeAgent => ({
  id,
  title: `Agent ${id}`,
  provider: "claude",
  model: null,
  status,
  workspaceId: "w1",
  parentAgentId: null,
  permissions: [],
  createdAt: "2026-11-19T08:00:00.000Z",
});

const actions = { send: async () => undefined, respond: async () => undefined, cancel: null };
const context = { actions, showWorkspace: undefined, closeSession: () => undefined };

let container: HTMLElement;
let root: Root;

type Shown = Pick<SessionPaneProps, "agent" | "room"> & {
  reply?: string;
  context?: SessionPaneProps["context"];
};

const setReply = () => undefined;
const setReplyImages = () => undefined;

function Harness({ reply = "", ...props }: Shown) {
  const styles = useOfficeStyles(THEME, layout.compact, false);
  return createElement(SessionPane, {
    agentId: "a1",
    reply,
    setReply,
    replyImages: NO_REPLY_IMAGES,
    setReplyImages,
    context,
    styles,
    layout,
    ...props,
  });
}
const draw = (props: Shown) => act(async () => root.render(createElement(Harness, props)));

beforeEach(() => {
  draws = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("an agent that came again unchanged does not draw the pane; a change to its own does", async () => {
  await draw({ agent: agent("a1"), room: "Acme shop" });
  expect(draws).toBe(1);
  // The office's agents come as new objects with every update, the other agents' changes included.
  await draw({ agent: agent("a1"), room: "Acme shop" });
  expect(draws).toBe(1);
  await draw({ agent: agent("a1", "running"), room: "Acme shop" });
  expect(draws).toBe(2);
  await draw({ agent: agent("a1", "running"), room: "Acme shop" });
  await draw({ agent: agent("a1", "running"), room: "Acme lab" });
  expect(draws).toBe(3);
});

test("a tab opened before its agent is listed becomes the normal panel when the agent appears", async () => {
  const withNavigation = { ...context, showWorkspace: vi.fn() };
  const box = () => container.querySelector('[aria-label="Message"]');
  const open = () => container.querySelector('[aria-label="Open in workspace"]');
  const show = (listed: OfficeAgent | null) =>
    act(async () =>
      root.render(createElement(Harness, { agent: listed, room: null, context: withNavigation })),
    );
  await show(null);
  expect(container.textContent).toContain("The office does not list this agent");
  expect(open()).not.toBeNull();
  expect(box()).toBeNull();
  await show(agent("a1"));
  expect(container.textContent).not.toContain("does not list");
  expect(box()).not.toBeNull();
  expect(open()).not.toBeNull();
});

test("a change to the reply's text draws the pane", async () => {
  await draw({ agent: agent("a1"), room: null });
  await draw({ agent: agent("a1"), room: null, reply: "half" });
  expect(draws).toBe(2);
});

test("sessionOf reads one agent and its room off the model", () => {
  const model = {
    agents: new Map([["a1", agent("a1")]]),
    home: new Map([["h1", { ...agent("h1"), status: "closed" }]]),
    roomOfAgent: new Map([
      ["a1", "r1"],
      ["h1", "r1"],
    ]),
    rooms: [{ id: "r1", name: "Acme shop" }],
  } as unknown as OfficeModel;
  expect(sessionOf(model, "a1")).toEqual({ agent: agent("a1"), room: "Acme shop" });
  // An agent at home is a session too: its panel opens, and a reply brings it back.
  expect(sessionOf(model, "h1")).toEqual({
    agent: { ...agent("h1"), status: "closed" },
    room: "Acme shop",
  });
  expect(sessionOf(model, "gone")).toEqual({ agent: null, room: null });
});
