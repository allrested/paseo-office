/**
 * @vitest-environment jsdom
 */
// The Tasks card, mounted: the blocked tasks of every board, each with what its holder needs, an
// Answer field that posts a reply under the task, and Open board. The modal is the host's, so a
// plain stand-in shows what the card passed it; the board's own actions post through a recorder.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Post } from "../shared/contracts.js";
import { UI_VI } from "../shared/ui-words-vi.js";
import { useOfficeStyles } from "./styles.js";
import type { TaskAttentionRow } from "./task-attention.js";
import { TasksCard } from "./tasks-card.js";
import { UiLanguage } from "./ui-language.js";
import { useBoardActions } from "./use-board-actions.js";

/** What the board's RPCs were sent, in order. */
const sent = vi.hoisted(() => ({ calls: [] as unknown[], choice: "auto" }));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: () => async (input: unknown) => {
    sent.calls.push(input);
    return { ok: true };
  },
  useSettings: () => ({ status: "ready", values: { choice: sent.choice } }),
}));
vi.mock("./app-locale.js", () => ({ useAppLocale: () => "en" }));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { ScrollView, TextInput } = await import("react-native");
  const Modal = (props: { title: string; open: boolean; children: ReactNode }) =>
    props.open ? createElement("section", { "aria-label": props.title }, props.children) : null;
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  const Icon = () => null;
  return { Icon, Modal, ScrollView, TextInput };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

function post(seq: number, fields: Partial<Post>): Post {
  const at = `2026-11-28T09:00:${String(seq).padStart(2, "0")}.000Z`;
  return {
    id: `p${seq}`,
    seq,
    board: "lobby",
    kind: "task",
    text: `Task ${seq}`,
    author: "user",
    state: "claimed",
    claimedBy: "a1",
    createdAt: at,
    updatedAt: at,
    ...fields,
  };
}

const ROWS: TaskAttentionRow[] = [
  {
    kind: "blocked",
    post: post(2, { board: "w1", text: "Rotate the keys", blocked: "Which key store?" }),
    board: "Checkout",
    holder: "Tester",
    reason: "Which key store?",
  },
  {
    kind: "blocked",
    post: post(5, { text: "Deploy\nto staging\nand smoke test", blocked: "Which region?" }),
    board: "Lobby",
    holder: "Builder",
    reason: "Which region?",
  },
];
const NO_ROWS: TaskAttentionRow[] = [];

let opened: string[];
const openBoard = (roomId: string) => void opened.push(roomId);
const ignore = () => undefined;

function Harness({ rows = ROWS }: { rows?: TaskAttentionRow[] }) {
  const styles = useOfficeStyles(THEME, false, false);
  const actions = useBoardActions();
  return (
    <TasksCard
      rows={rows}
      open
      actions={actions}
      onOpenBoard={openBoard}
      styles={styles}
      onClose={ignore}
    />
  );
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  sent.calls = [];
  sent.choice = "auto";
  opened = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = (node: ReactNode) => act(async () => root.render(node));
const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

function allLabelled(label: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(`[aria-label="${label}"]`)];
}
function byLabel(label: string, index = 0): HTMLElement {
  const found = allLabelled(label)[index];
  if (!found) throw new Error(`Nothing is labelled "${label}"`);
  return found;
}
const isOff = (label: string, index = 0) =>
  byLabel(label, index).getAttribute("aria-disabled") === "true";

async function press(label: string, index = 0): Promise<void> {
  await act(async () => byLabel(label, index).click());
  await settle();
}

async function type(label: string, text: string, index = 0): Promise<void> {
  const field = byLabel(label, index);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function enter(label: string, index = 0): Promise<void> {
  const field = byLabel(label, index);
  await act(async () => {
    field.focus();
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await settle();
}

/** Every line of text shown, in order; a button's hidden width spacer is left out. */
function lines(): string[] {
  return [...container.querySelectorAll("*")]
    .filter((element) => element.childElementCount === 0 && element.textContent !== "")
    .filter((element) => element.closest('[aria-hidden="true"]') === null)
    .map((element) => element.textContent ?? "");
}

test("lists each blocked task with its holder's need, its board, Answer and Open board", async () => {
  await mount(<Harness />);
  expect(byLabel("Tasks").tagName).toBe("SECTION");
  expect(lines()).toEqual([
    "2 need you",
    "Rotate the keys",
    "Tester needs: Which key store?",
    "Checkout",
    "Send",
    "Open board",
    "Deploy\nto staging…",
    "Builder needs: Which region?",
    "Lobby",
    "Send",
    "Open board",
  ]);
  expect(allLabelled("Answer")).toHaveLength(2);
});

test("Answer waits for words, posts a reply under the task and clears the field", async () => {
  await mount(<Harness />);
  expect(isOff("Send", 1)).toBe(true);

  await type("Answer", "  eu-west-1  ", 1);
  expect(isOff("Send", 1)).toBe(false);
  await press("Send", 1);

  expect(sent.calls).toEqual([{ board: "lobby", kind: "note", text: "eu-west-1", replyTo: "p5" }]);
  expect((byLabel("Answer", 1) as HTMLInputElement).value).toBe("");
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

test("Enter sends the answer too", async () => {
  await mount(<Harness />);
  await type("Answer", "The vault");
  await enter("Answer");
  expect(sent.calls).toEqual([{ board: "w1", kind: "note", text: "The vault", replyTo: "p2" }]);
});

test("Open board leaves for the task's board", async () => {
  await mount(<Harness />);
  await press("Open board", 0);
  await press("Open board", 1);
  expect(opened).toEqual(["w1", "lobby"]);
});

test("shows nothing when no task needs you", async () => {
  await mount(<Harness rows={NO_ROWS} />);
  expect(container.innerHTML).toBe("");
});

test("its title, field and lines are in the interface's language", async () => {
  sent.choice = "vi";
  await mount(
    <UiLanguage>
      <Harness />
    </UiLanguage>,
  );
  expect(allLabelled(UI_VI.Tasks)).toHaveLength(1);
  expect(allLabelled(UI_VI.Answer)).toHaveLength(2);
  expect(allLabelled("Answer")).toHaveLength(0);
  expect(lines()).not.toContain("Tester needs: Which key store?");
});
