/**
 * @vitest-environment jsdom
 */
// The History card, mounted: a search lists what was found and opens a conversation, the report
// tab shows the week's prompts against the rules, and a vault that is off says how to turn it on.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { VaultCard } from "./vault-card.js";
import { useOfficeStyles } from "./styles.js";

const rpc = vi.hoisted(() => ({ search: vi.fn(), talk: vi.fn(), report: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: ({ name }: { name: string }) => {
    if (name === "office.vault.search.request") return rpc.search;
    return name === "office.vault.talk.request" ? rpc.talk : rpc.report;
  },
}));
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
const AT = Date.parse("2026-11-23T09:30:00");
const HIT = {
  agentId: "a",
  name: "Builder",
  team: "shop-api",
  at: AT,
  role: "user" as const,
  snippet: "Fix the login bug",
};

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  rpc.search.mockReset().mockResolvedValue({ on: true, hits: [HIT] });
  rpc.talk.mockReset().mockResolvedValue({
    talk: {
      agentId: "a",
      name: "Builder",
      team: "shop-api",
      messages: [
        { at: AT, role: "user", text: "Fix the login bug in auth.ts" },
        { at: AT + 60_000, role: "assistant", text: "Fixed." },
      ],
    },
  });
  rpc.report.mockReset().mockResolvedValue({
    on: true,
    report: {
      total: 4,
      clean: 3,
      rules: [{ rule: "vague", count: 1, examples: ["make it better"] }],
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const onClose = () => undefined;
function Card() {
  const styles = useOfficeStyles(THEME, false, false);
  return <VaultCard open styles={styles} onClose={onClose} />;
}
const press = (label: string) =>
  act(async () => {
    container.querySelector<HTMLElement>(`button[aria-label^="${label}"]`)!.click();
  });
async function type(text: string) {
  const input = container.querySelector<HTMLInputElement>(
    'input[aria-label="Search the history"]',
  )!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("a search lists what was found, and a hit opens its conversation", async () => {
  await act(async () => root.render(<Card />));
  await type(" login bug ");
  await press("Find");
  expect(rpc.search).toHaveBeenCalledWith({ query: "login bug" });
  expect(container.textContent).toContain("You: Fix the login bug");
  await press("Builder");
  expect(rpc.talk).toHaveBeenCalledWith({ agentId: "a" });
  expect(container.textContent).toContain("Fix the login bug in auth.ts");
  expect(container.textContent).toContain("Fixed.");
  await press("Back");
  expect(container.textContent).toContain("You: Fix the login bug");
});

test("nothing found, and a vault that is off, are said", async () => {
  await act(async () => root.render(<Card />));
  rpc.search.mockResolvedValue({ on: true, hits: [] });
  await type("zebra");
  await press("Find");
  expect(container.textContent).toContain("Nothing in the vault has “zebra”.");
  rpc.search.mockResolvedValue({ on: false, hits: [] });
  await press("Find");
  expect(container.textContent).toContain("The history vault is off.");
});

test("the prompt report shows how many prompts were clean and what each rule found", async () => {
  await act(async () => root.render(<Card />));
  await press("Prompt report");
  expect(container.textContent).toContain("3 of 4 prompts had nothing to improve");
  expect(container.textContent).toContain("No way to tell when it is done: 1");
  expect(container.textContent).toContain("“make it better”");
});
