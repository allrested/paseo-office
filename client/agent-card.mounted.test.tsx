/**
 * @vitest-environment jsdom
 */
// The agent card's "Open session", mounted: it hands the agent to the office and the card closes.
// The sheet and its input are the host's, so plain stand-ins show what the card passed them.
import { act, createElement, useCallback, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeAgent } from "../shared/contracts.js";
import { AgentCard } from "./agent-card.js";
import { useOfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { TextInput } = await import("react-native");
  const Modal = (props: { title: string; open: boolean; children: ReactNode }) =>
    props.open ? createElement("section", { "aria-label": props.title }, props.children) : null;
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  return { Modal, TextInput };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const AGENT: OfficeAgent = {
  id: "a1",
  title: "Builder",
  provider: "claude",
  model: "opus",
  status: "idle",
  workspaceId: "w1",
  parentAgentId: null,
  permissions: [],
  createdAt: "2026-11-17T08:00:00.000Z",
};
const nothing = async () => undefined;
const ACTIONS: AgentActions = { send: nothing, respond: nothing, cancel: nothing };

let opened: string[];

function Harness({
  actions = ACTIONS,
  start = AGENT,
}: {
  actions?: AgentActions;
  start?: OfficeAgent;
}) {
  const styles = useOfficeStyles(THEME, false, false);
  const [agent, setAgent] = useState<OfficeAgent | null>(start);
  const close = useCallback(() => setAgent(null), []);
  const open = useCallback((agentId: string) => void opened.push(agentId), []);
  return (
    <AgentCard
      agent={agent}
      activity={null}
      actions={actions}
      onOpenSession={open}
      styles={styles}
      onClose={close}
    />
  );
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  opened = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));
const card = () => container.querySelector('section[aria-label="Builder"]');

test("Open session hands the agent to the office and closes the card", async () => {
  await act(async () => root.render(<Harness />));
  const button = container.querySelector<HTMLElement>('[aria-label="Open session"]');
  if (!button) throw new Error('Nothing is labelled "Open session"');
  await act(async () => button.click());
  await settle();

  expect(opened).toEqual(["a1"]);
  expect(card()).toBeNull();
});

const RUNNING: OfficeAgent = { ...AGENT, status: "running" };
const stopButton = () => container.querySelector('[aria-label="Stop"]');
const stopped: string[] = [];
const CAN_STOP: AgentActions = {
  ...ACTIONS,
  cancel: async (agentId) => void stopped.push(agentId),
};
const CANNOT_STOP: AgentActions = { ...ACTIONS, cancel: null };

test("a running agent can be stopped where the host can stop a turn", async () => {
  stopped.length = 0;
  await act(async () => root.render(<Harness actions={CAN_STOP} start={RUNNING} />));
  await act(async () => stopButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await settle();
  expect(stopped).toEqual(["a1"]);
});

test("a running agent has no Stop where the host cannot stop a turn", async () => {
  await act(async () => root.render(<Harness actions={CANNOT_STOP} start={RUNNING} />));
  expect(card()).not.toBeNull();
  expect(stopButton()).toBeNull();
});
