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
const STALLED: TaskAttentionRow[] = [
  {
    kind: "stalled",
    post: post(3, { board: "w1", text: "Write the docs" }),
    board: "Checkout",
    holder: "Tester",
    reason: null,
    cause: "idle",
  },
  {
    kind: "stalled",
    post: post(6, { text: "Run the audit" }),
    board: "Lobby",
    holder: "Builder",
    reason: null,
    cause: "error",
  },
];
const AT_HOME: TaskAttentionRow[] = [
  {
    kind: "stalled",
    post: post(8, { text: "Check the notes" }),
    board: "Lobby",
    holder: "Builder",
    reason: null,
    cause: "home",
  },
];
const DUTY_ROWS: TaskAttentionRow[] = [
  {
    kind: "blocked",
    post: post(9, {
      board: "duty",
      text: "Build\n\nRun the build",
      duty: { id: "build", day: "2026-11-28" },
      blocked: "Which branch?",
    }),
    board: "Duty board",
    holder: "Builder",
    reason: "Which branch?",
  },
  {
    kind: "stalled",
    post: post(10, {
      board: "duty",
      text: "Tidy\n\nPrune old branches",
      duty: { id: "tidy", day: "2026-11-28" },
    }),
    board: "Duty board",
    holder: "Tester",
    reason: null,
    cause: "idle",
  },
];
const MERGED: TaskAttentionRow[] = [
  {
    kind: "merged",
    post: post(4, { board: "w1", text: "Fix the ledger" }),
    board: "Checkout",
    holder: "Tester",
    reason: null,
    pullRequest: "#42 Fix the ledger total",
  },
  {
    kind: "merged",
    post: post(7, { text: "Ship it" }),
    board: "Lobby",
    holder: "Builder",
    reason: null,
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

test("a stalled row says why, offers Nudge, Reopen and Open board, and has no Answer field", async () => {
  await mount(<Harness rows={STALLED} />);
  expect(lines()).toEqual([
    "2 stalled",
    "Write the docs",
    "Tester is idle",
    "Checkout",
    "Nudge",
    "Reopen",
    "Open board",
    "Run the audit",
    "Builder stopped on an error",
    "Lobby",
    "Nudge",
    "Reopen",
    "Hand over",
    "Open board",
  ]);
  expect(allLabelled("Answer")).toHaveLength(0);
});

test("a claim whose holder is at home says so, with Nudge and Reopen, in the interface's language too", async () => {
  await mount(<Harness rows={AT_HOME} />);
  expect(lines()).toEqual([
    "1 stalled",
    "Check the notes",
    "Builder is at home",
    "Lobby",
    "Nudge",
    "Reopen",
    "Hand over",
    "Open board",
  ]);
  act(() => root.unmount());
  root = createRoot(container);
  sent.choice = "vi";
  await mount(
    <UiLanguage>
      <Harness rows={AT_HOME} />
    </UiLanguage>,
  );
  expect(lines()).not.toContain("Builder is at home");
  expect(lines().filter((line) => line.includes("Builder"))).toHaveLength(1);
});

test("Nudge posts the fixed status check as a reply under the task", async () => {
  await mount(<Harness rows={STALLED} />);
  await press("Nudge", 1);
  expect(sent.calls).toEqual([
    {
      board: "lobby",
      kind: "note",
      text: "Status check: finish with office_update done and a short result, or block with what you need.",
      replyTo: "p6",
    },
  ]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

test("Reopen reopens the task", async () => {
  await mount(<Harness rows={STALLED} />);
  await press("Reopen", 0);
  expect(sent.calls).toEqual([{ id: "p3", action: "reopen" }]);
});

test("a stalled row's words are in the interface's language", async () => {
  sent.choice = "vi";
  await mount(
    <UiLanguage>
      <Harness rows={STALLED} />
    </UiLanguage>,
  );
  expect(allLabelled("Nudge")).toHaveLength(0);
  expect(lines()).not.toContain("Tester is idle");
  expect(lines()).not.toContain("2 stalled");
});

test("a merged row says whose pull request is merged, offers Mark done and Open board, and has no Answer or Nudge", async () => {
  await mount(<Harness rows={MERGED} />);
  expect(lines()).toEqual([
    "2 merged",
    "Fix the ledger",
    "Tester's pull request is merged: #42 Fix the ledger total",
    "Checkout",
    "Mark done",
    "Open board",
    "Ship it",
    "Builder's pull request is merged",
    "Lobby",
    "Mark done",
    "Open board",
  ]);
  expect(allLabelled("Answer")).toHaveLength(0);
  expect(allLabelled("Nudge")).toHaveLength(0);
  expect(allLabelled("Reopen")).toHaveLength(0);
});

test("Mark done marks the task done and nothing else happens by itself", async () => {
  await mount(<Harness rows={MERGED} />);
  expect(sent.calls).toEqual([]);
  await press("Mark done", 1);
  expect(sent.calls).toEqual([{ id: "p7", action: "done" }]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

test("a merged row's words are in the interface's language", async () => {
  sent.choice = "vi";
  await mount(
    <UiLanguage>
      <Harness rows={MERGED} />
    </UiLanguage>,
  );
  expect(allLabelled("Mark done")).toHaveLength(0);
  expect(allLabelled(UI_VI["Mark done"])).toHaveLength(2);
  expect(lines()).not.toContain("2 merged");
  expect(lines().filter((line) => line.includes("pull request is merged"))).toEqual([]);
});

test("a duty's row names the duty board, and its Answer and Nudge post replies under the duty", async () => {
  await mount(<Harness rows={DUTY_ROWS} />);
  expect(lines()).toEqual([
    "1 needs you · 1 stalled",
    "Build…",
    "Builder needs: Which branch?",
    "Duty board",
    "Send",
    "Open board",
    "Tidy…",
    "Tester is idle",
    "Duty board",
    "Nudge",
    "Reopen",
    "Hand over",
    "Open board",
  ]);
  await type("Answer", "main");
  await press("Send");
  await press("Nudge");
  expect(sent.calls).toEqual([
    { board: "duty", kind: "note", text: "main", replyTo: "p9" },
    {
      board: "duty",
      kind: "note",
      text: "Status check: finish with office_update done and a short result, or block with what you need.",
      replyTo: "p10",
    },
  ]);
  await press("Open board", 0);
  expect(opened).toEqual(["duty"]);
});

test("a duty's row names the duty board in the interface's language", async () => {
  sent.choice = "vi";
  await mount(
    <UiLanguage>
      <Harness rows={DUTY_ROWS} />
    </UiLanguage>,
  );
  expect(lines()).not.toContain("Duty board");
  expect(lines().filter((line) => line === UI_VI["Duty board"])).toHaveLength(2);
});

test("a stalled row offers Hand over where the server would take it, not on a room's own task", async () => {
  await mount(<Harness rows={STALLED} />);
  // The room's own task (p3) has none; the lobby task (p6) has.
  expect(allLabelled("Hand over")).toHaveLength(1);
});

test("Hand over asks first, then hands the task over by its id and shows nothing more", async () => {
  await mount(<Harness rows={STALLED} />);
  await press("Hand over");
  expect(sent.calls).toEqual([]);
  expect(lines()).toContain(
    "Hand p6 over to an agent of another provider? Builder loses it, and a note says where it was left.",
  );
  await press("Hand over");
  expect(sent.calls).toEqual([{ id: "p6" }]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

test("Keep it closes the question and hands nothing over", async () => {
  await mount(<Harness rows={STALLED} />);
  await press("Hand over");
  await press("Keep it");
  expect(sent.calls).toEqual([]);
  expect(allLabelled("Keep it")).toHaveLength(0);
});

const BLOCKED_AND_MERGED = [...ROWS, ...MERGED];

test("a blocked or merged row has no Hand over", async () => {
  await mount(<Harness rows={BLOCKED_AND_MERGED} />);
  expect(allLabelled("Hand over")).toHaveLength(0);
});

const NOT_FOR_ROWS: TaskAttentionRow[] = [
  {
    kind: "stalled",
    post: post(11, { text: "Run the audit", notProvider: "codex" }),
    board: "Lobby",
    holder: "Builder",
    reason: null,
    cause: "idle",
  },
];

test("a row of a task handed over says not for the provider, by id here", async () => {
  await mount(<Harness rows={NOT_FOR_ROWS} />);
  expect(lines()).toContain("not for codex");
});
