/**
 * @vitest-environment jsdom
 */
// A task's result and its replies, mounted: on the to-do card the lobby and the kanban draw, and
// on a room's list row. The Reply field sends a note under the task.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Post } from "../shared/contracts.js";
import { PostWithActions } from "./board-sheet.js";
import { useOfficeStyles } from "./styles.js";
import { TaskCard } from "./task-card.js";
import { UiLanguage } from "./ui-language.js";
import { UI_VI } from "../shared/ui-words-vi.js";
import type { BoardActions } from "./use-board-actions.js";

/** The device's choice of language for the interface; "auto" follows the app's, English here. */
const language = vi.hoisted(() => ({ choice: "auto" }));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: () => async () => ({ ok: true }),
  useSettings: () => ({ status: "ready", values: { choice: language.choice } }),
}));
vi.mock("./app-locale.js", () => ({ useAppLocale: () => "en" }));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { ScrollView, TextInput } = await import("react-native");
  const Icon = () => null;
  return { Icon, ScrollView, TextInput };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

function post(seq: number, fields: Partial<Post>): Post {
  const at = `2026-11-17T09:00:${String(seq).padStart(2, "0")}.000Z`;
  return {
    id: `p${seq}`,
    seq,
    board: "w1",
    kind: "task",
    text: `To-do ${seq}`,
    author: "user",
    state: "open",
    createdAt: at,
    updatedAt: at,
    ...fields,
  };
}

const LONG = `${"The build passed on every target, and the release notes are in the PR. ".repeat(3)}Done.`;
const TASK = post(1, { text: "Ship the release", state: "done", result: "Shipped 1.4.2" });
const REPLIES = [
  post(2, { kind: "note", state: undefined, replyTo: "p1", author: "a1", text: "Which tag?" }),
  post(3, { kind: "note", state: undefined, replyTo: "p1", text: "v1.4.2" }),
];

/** The replies sent, as "p1: text". */
let replied: string[];
/** Set to make the host refuse the reply. */
let refusal: Error | null;
/** While set, a reply waits for it: the host has not answered yet. */
let answer: Promise<void> | null;

const ACTIONS: BoardActions = {
  post: async () => undefined,
  reply: async (task, text) => {
    replied.push(`${task.id}: ${text}`);
    await answer;
    if (refusal) throw refusal;
  },
  markDone: async () => undefined,
  reopen: async () => undefined,
  remove: async () => undefined,
  clearDone: async () => undefined,
  setWakesPaused: async () => undefined,
};
const nameOf = (author: string) => (author === "user" ? "You" : `Agent ${author}`);

const NO_REPLIES: Post[] = [];

function Card({ task = TASK, replies = REPLIES }: { task?: Post; replies?: Post[] }) {
  const styles = useOfficeStyles(THEME, false, false);
  return <TaskCard post={task} replies={replies} name={nameOf} actions={ACTIONS} styles={styles} />;
}

function Row({ item, replies = REPLIES }: { item: Post; replies?: Post[] }) {
  const styles = useOfficeStyles(THEME, false, false);
  return (
    <PostWithActions
      post={item}
      replies={replies}
      name={nameOf}
      actions={ACTIONS}
      styles={styles}
    />
  );
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  language.choice = "auto";
  replied = [];
  refusal = null;
  answer = null;
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

function byLabel(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`Nothing is labelled "${label}"`);
  return found;
}
const has = (label: string) => container.querySelector(`[aria-label="${label}"]`) !== null;
const isOff = (label: string) => byLabel(label).getAttribute("aria-disabled") === "true";

async function press(label: string): Promise<void> {
  await act(async () => byLabel(label).click());
  await settle();
}

async function enter(label: string): Promise<void> {
  const field = byLabel(label);
  await act(async () => {
    field.focus();
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await settle();
}

async function type(label: string, text: string): Promise<void> {
  const field = byLabel(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Every line of text shown, in order; a button's hidden width spacer is left out. */
function lines(): string[] {
  return [...container.querySelectorAll("*")]
    .filter((element) => element.childElementCount === 0 && element.textContent !== "")
    .filter((element) => element.closest('[aria-hidden="true"]') === null)
    .map((element) => element.textContent ?? "");
}

test("a done task's card shows its result, then its replies oldest first, then Reply", async () => {
  await mount(<Card />);

  expect(lines()).toEqual([
    "Ship the release",
    "Result",
    "Shipped 1.4.2",
    "Agent a1 · Which tag?",
    "You · v1.4.2",
    "Reply",
  ]);
  expect(has("More")).toBe(false);
  expect(has("Write a reply")).toBe(false);
});

test("a task with no result and no replies has only its Reply button under it", async () => {
  await mount(<Card task={post(1, { text: "Rotate keys" })} replies={NO_REPLIES} />);
  expect(lines()).toEqual(["Rotate keys", "Reply"]);
});

test("a long result shows its start, and More and Less show the whole of it and fold it again", async () => {
  await mount(<Card task={post(1, { state: "done", result: LONG })} replies={NO_REPLIES} />);
  const start = `${LONG.slice(0, 160).trimEnd()}…`;
  expect(lines()).toContain(start);
  expect(lines()).not.toContain(LONG);
  expect(byLabel("More").getAttribute("aria-expanded")).toBe("false");

  await press("More");
  expect(lines()).toContain(LONG);
  expect(lines()).not.toContain(start);
  expect(byLabel("Less").getAttribute("aria-expanded")).toBe("true");

  await press("Less");
  expect(lines()).toContain(start);
});

test("the thread's buttons are named in the interface's language", async () => {
  language.choice = "vi";
  await mount(
    <UiLanguage>
      <Card task={post(1, { state: "done", result: LONG })} />
    </UiLanguage>,
  );
  expect(has(UI_VI.Reply)).toBe(true);
  expect(has(UI_VI.More)).toBe(true);
  await press(UI_VI.More);
  expect(has(UI_VI.Less)).toBe(true);
  expect(has("Reply")).toBe(false);
});

test("Reply opens the field; Send waits for words and sends the reply under the task", async () => {
  await mount(<Card />);
  await press("Reply");
  expect(isOff("Send")).toBe(true);

  await type("Write a reply", "  Tagged it  ");
  expect(isOff("Send")).toBe(false);
  await press("Send");

  expect(replied).toEqual(["p1: Tagged it"]);
  expect((byLabel("Write a reply") as HTMLInputElement).value).toBe("");
});

test("Enter sends too, and Send is off while the reply is on its way", async () => {
  let release: () => void = () => undefined;
  answer = new Promise((done) => {
    release = done;
  });
  await mount(<Card />);
  await press("Reply");
  await type("Write a reply", "On it");
  await enter("Write a reply");

  expect(replied).toEqual(["p1: On it"]);
  expect(isOff("Send")).toBe(true);
  await enter("Write a reply");
  expect(replied).toEqual(["p1: On it"]);

  await act(async () => release());
  await settle();
  expect(isOff("Send")).toBe(true);
});

test("a refused reply says why and keeps its words", async () => {
  refusal = new Error("Task p1 is gone");
  await mount(<Card />);
  await press("Reply");
  await type("Write a reply", "Still there?");
  await press("Send");

  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Unable to send: Task p1 is gone",
  );
  expect((byLabel("Write a reply") as HTMLInputElement).value).toBe("Still there?");
});

test("a room's list row draws a task's result and replies, and replies under it", async () => {
  await mount(<Row item={post(1, { text: "Ship the release", result: "Shipped 1.4.2" })} />);

  const shown = lines();
  expect(shown.slice(shown.indexOf("Ship the release"))).toEqual([
    "Ship the release",
    "Result",
    "Shipped 1.4.2",
    "Agent a1 · Which tag?",
    "You · v1.4.2",
    "Reply",
    "Mark done",
    "Delete",
  ]);
  await press("Reply");
  await type("Write a reply", "Thanks");
  await enter("Write a reply");
  expect(replied).toEqual(["p1: Thanks"]);
});

test("a note's row has no thread and no Reply", async () => {
  await mount(
    <Row item={post(4, { kind: "note", state: undefined, text: "Freeze" })} replies={NO_REPLIES} />,
  );
  expect(has("Reply")).toBe(false);
  expect(lines()).not.toContain("Result");
});

const BLOCKED = post(5, {
  text: "Rotate keys",
  state: "claimed",
  claimedBy: "a1",
  blocked: "Which key store?",
});

test("a blocked task's card says what it needs above its thread, answered by Reply", async () => {
  await mount(<Card task={BLOCKED} replies={NO_REPLIES} />);
  expect(lines()).toEqual([
    "Rotate keys",
    "claimed by Agent a1",
    "Needs you: Which key store?",
    "Reply",
  ]);
  await press("Reply");
  await type("Write a reply", "The vault");
  await press("Send");
  expect(replied).toEqual(["p5: The vault"]);
});

test("a blocked task's list row says what it needs above its thread", async () => {
  await mount(<Row item={BLOCKED} replies={NO_REPLIES} />);
  const shown = lines();
  expect(shown.slice(shown.indexOf("Needs you: Which key store?"))).toEqual([
    "Needs you: Which key store?",
    "Reply",
    "Mark done",
    "Delete",
  ]);
});

const CLAIMED = post(5, { text: "Rotate keys", state: "claimed", claimedBy: "a1" });

test("a task that is not blocked has no Needs you line", async () => {
  await mount(<Card task={CLAIMED} replies={NO_REPLIES} />);
  expect(lines().some((line) => line.startsWith("Needs you"))).toBe(false);
});
