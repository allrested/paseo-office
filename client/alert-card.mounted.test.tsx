/**
 * @vitest-environment jsdom
 */
// The card of something the office noticed, mounted: each kind offers its own act, the act sends
// what it says to whom it says, and the alert is dismissed once it is done.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Alert } from "../shared/alerts.js";
import type { Machine } from "../shared/contracts.js";
import { AlertCard } from "./alert-card.js";
import { useOfficeStyles } from "./styles.js";

vi.mock("@getpaseo/plugin/client/ui", () => {
  const Modal = (props: { title: string; open: boolean; children: ReactNode }) =>
    props.open ? createElement("section", { "aria-label": props.title }, props.children) : null;
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  const TextInput = (props: {
    accessibilityLabel: string;
    value: string;
    onChangeText(text: string): void;
  }) =>
    createElement("input", {
      "aria-label": props.accessibilityLabel,
      value: props.value,
      onChange: (event: { target: { value: string } }) => props.onChangeText(event.target.value),
    });
  return { Modal, Icon: () => null, TextInput };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const send = vi.fn(async (_agentId: string, _text: string, _options?: object) => undefined);
const cancel = vi.fn(async (_agentId: string) => undefined);
const respond = vi.fn(async () => undefined);
const onDismiss = vi.fn(async () => undefined);
const onClose = vi.fn();
const ACTIONS = { send, cancel, respond };
const nameOf = (agentId: string) => `Agent ${agentId}`;
const MACHINE = {
  agents: [{ agentId: "b", ports: [5173] }],
} as unknown as Machine;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  for (const mock of [send, cancel, onDismiss, onClose]) mock.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function Card({ alert }: { alert: Alert | null }) {
  const styles = useOfficeStyles(THEME, false, false);
  return (
    <AlertCard
      alert={alert}
      nameOf={nameOf}
      machine={MACHINE}
      actions={ACTIONS}
      styles={styles}
      onClose={onClose}
      onDismiss={onDismiss}
    />
  );
}
const show = (alert: Alert | null) => act(async () => root.render(<Card alert={alert} />));
const buttons = () =>
  [...container.querySelectorAll<HTMLElement>("button[aria-label]")].map((button) =>
    button.getAttribute("aria-label"),
  );
const press = (label: string) =>
  act(async () => {
    container.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!.click();
  });
const alertOf = (patch: Partial<Alert> & Pick<Alert, "kind">): Alert => ({
  id: "x",
  at: 0,
  agentId: "a",
  title: "Title",
  detail: "Detail",
  ...patch,
});

test("a loop can be stopped, or given a hint that joins the turn", async () => {
  await show(alertOf({ kind: "loop" }));
  expect(buttons()).toEqual(["Send a hint", "Stop", "Dismiss"]);
  await press("Stop");
  expect(cancel).toHaveBeenCalledWith("a");
  expect(onDismiss).toHaveBeenCalledTimes(1);

  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Hint for the agent"]',
  )!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, " Use the fake clock ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await press("Send a hint");
  expect(send).toHaveBeenCalledWith("a", "Use the fake clock", { activeTurnBehavior: "steer" });
});

test("a clash tells both agents about each other", async () => {
  await show(
    alertOf({ kind: "clash", otherAgentId: "b", title: "Agent a and Agent b are in app.ts" }),
  );
  await press("Tell both");
  expect(send.mock.calls.map(([to, text]) => [to, String(text).includes("app.ts")])).toEqual([
    ["a", true],
    ["b", true],
  ]);
  expect(String(send.mock.calls[0]?.[1])).toContain("Agent b");
  expect(String(send.mock.calls[1]?.[1])).toContain("Agent a");
});

test("a taken port names who holds it, when the host's readings say", async () => {
  await show(alertOf({ kind: "port", port: 5173 }));
  await press("Tell the agent");
  expect(send).toHaveBeenCalledWith(
    "a",
    expect.stringContaining("port 5173 is held by another session's server (Agent b)"),
    { activeTurnBehavior: "steer" },
  );
});

test("failing checks go to a resting agent as a prompt, and to nobody when none rests", async () => {
  await show(alertOf({ kind: "checks", detail: "test, lint" }));
  await press("Fix it");
  expect(send).toHaveBeenCalledWith("a", expect.stringContaining("(test, lint)"), undefined);

  const { agentId: _nobody, ...unowned } = alertOf({ kind: "checks" });
  await show(unowned);
  expect(buttons()).toEqual(["Dismiss"]);
  expect(container.textContent).toContain("No agent of this workspace is resting now.");
});

test("a refused call can only be dismissed, and no alert shows no card", async () => {
  await show(alertOf({ kind: "refused" }));
  expect(buttons()).toEqual(["Dismiss"]);
  await press("Dismiss");
  expect(onDismiss).toHaveBeenCalledTimes(1);
  await show(null);
  expect(container.textContent).toBe("");
});
