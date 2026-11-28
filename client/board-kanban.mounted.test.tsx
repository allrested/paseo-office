/**
 * @vitest-environment jsdom
 */
// The board as a kanban, mounted: side by side when it is wide, stacked and folding when narrow.
// The scroller and the icon are the host's, so plain stand-ins show what the board asked of them.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Post } from "../shared/contracts.js";
import { KanbanBoard } from "./board-kanban.js";
import { useOfficeStyles } from "./styles.js";
import type { BoardActions } from "./use-board-actions.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { TextInput, View } = await import("react-native");
  const ScrollView = (props: { horizontal?: boolean; children: ReactNode }) =>
    createElement(
      "div",
      { "data-scroll": props.horizontal ? "horizontal" : "vertical" },
      createElement(View, null, props.children),
    );
  const Icon = () => null;
  return { Icon, ScrollView, TextInput };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
// jsdom lays nothing out: react-native-web reads a view's layout through a ResizeObserver, and this
// one reports what a test says, when it says it.
let resized: (entries: Array<{ target: Element }>) => void = () => {
  throw new Error("No view has asked for its layout");
};
/** The views that asked for their layout, in order. */
let observed: Element[] = [];
vi.stubGlobal(
  "ResizeObserver",
  class {
    constructor(callback: (entries: Array<{ target: Element }>) => void) {
      resized = callback;
    }
    observe(target: Element) {
      observed.push(target);
    }
    unobserve() {}
    disconnect() {}
  },
);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

function post(seq: number, fields: Partial<Post>): Post {
  const at = `2026-11-17T09:00:${String(seq).padStart(2, "0")}.000Z`;
  return {
    id: `p${seq}`,
    seq,
    board: "lobby",
    kind: "task",
    text: `To-do ${seq}`,
    author: "user",
    state: "open",
    createdAt: at,
    updatedAt: at,
    ...fields,
  };
}

const BOARD: Post[] = [
  post(1, { text: "Rotate keys" }),
  post(2, { text: "Check the build", state: "claimed", claimedBy: "a1" }),
  post(3, { text: "Update the README", state: "done" }),
  post(4, { kind: "note", state: undefined, text: "The demo is on Thursday" }),
  post(5, { text: "Write the release notes" }),
];

/** The board changes asked of the host, in order: "markDone p1", "clearDone lobby". */
let asked: string[];

async function change(request: string): Promise<void> {
  asked.push(request);
}

const ACTIONS: BoardActions = {
  post: async () => undefined,
  markDone: (id) => change(`markDone ${id}`),
  reopen: (id) => change(`reopen ${id}`),
  remove: (id) => change(`remove ${id}`),
  reply: (task, text) => change(`reply ${task.id} ${text}`),
  clearDone: (board) => change(`clearDone ${board}`),
  setWakesPaused: async () => undefined,
};
const nameOf = (author: string) => author;
const teamIdOf = (id: string) => id;

/** The cards whose Follow-up was pressed. */
let followed: string[];
const onFollowUp = (id: string) => {
  followed.push(id);
};

function Harness({ posts, all = posts }: { posts: Post[]; all?: Post[] }) {
  const styles = useOfficeStyles(THEME, false, false);
  return (
    <KanbanBoard
      posts={posts}
      all={all}
      onFollowUp={onFollowUp}
      name={nameOf}
      teamName={teamIdOf}
      actions={ACTIONS}
      styles={styles}
    />
  );
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  asked = [];
  followed = [];
  observed = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = (posts: Post[], all?: Post[]) =>
  act(async () => root.render(<Harness posts={posts} all={all} />));
const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

/** The board's view reports `width`, as a sheet of that width would. */
async function sizeBoard(width: number): Promise<void> {
  const target = observed.at(-1);
  if (!(target instanceof HTMLElement)) throw new Error("The board did not ask for its layout");
  Object.defineProperty(target, "offsetWidth", { configurable: true, value: width });
  resized([{ target }]);
  // react-native-web measures on the next tick.
  await settle();
}

function byLabel(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`Nothing is labelled "${label}"`);
  return found;
}

async function press(label: string): Promise<void> {
  await act(async () => byLabel(label).click());
  await settle();
}

/** Every line of text the board shows, in order; a button's hidden width spacer is left out. */
function lines(): string[] {
  return [...container.querySelectorAll("*")]
    .filter((element) => element.childElementCount === 0 && element.textContent !== "")
    .filter((element) => element.closest('[aria-hidden="true"]') === null)
    .map((element) => element.textContent ?? "");
}

const sideways = () => container.querySelector('[data-scroll="horizontal"]') !== null;

/** The 280 px wide view around this heading: its column. */
function column(heading: string): HTMLElement {
  const words = [...container.querySelectorAll<HTMLElement>("*")].find(
    (element) => element.childElementCount === 0 && element.textContent === heading,
  );
  let at = words?.parentElement ?? null;
  while (at !== null && getComputedStyle(at).width !== "280px") at = at.parentElement;
  if (at === null) throw new Error(`No column is headed "${heading}"`);
  return at;
}

test("wide, the columns sit side by side, 280 px each, with their counts and their posts", async () => {
  await mount(BOARD);
  await sizeBoard(900);

  expect(sideways()).toBe(true);
  expect(lines()).toEqual([
    "To do · 2",
    "Rotate keys",
    "Reply",
    "Follow-up",
    "Write the release notes",
    "Reply",
    "Follow-up",
    "In progress · 1",
    "Check the build",
    "claimed by a1",
    "Reply",
    "Follow-up",
    "Done · 1",
    "Clear finished",
    "Update the README",
    "Reply",
    "Follow-up",
    "Notes · 1",
    "Note · user",
    "The demo is on Thursday",
    "Delete",
  ]);
  expect(column("To do · 2").textContent).toContain("Write the release notes");
  expect(column("In progress · 1").textContent).toContain("Check the build");
  expect(column("Done · 1").textContent).toContain("Update the README");
  expect(column("Notes · 1").textContent).toContain("The demo is on Thursday");
  expect(column("To do · 2").textContent).not.toContain("Check the build");
  // A task is a card with its box; a note keeps its own buttons.
  expect(byLabel("Rotate keys").getAttribute("role")).toBe("checkbox");
  expect(byLabel("Update the README").getAttribute("aria-checked")).toBe("true");
});

test("To do and In progress stay when empty, and an empty Done or Notes is left out", async () => {
  await mount([]);
  await sizeBoard(900);
  expect(lines()).toEqual(["To do · 0", "In progress · 0"]);
});

test("narrow, and before it is measured, the columns stack with Done folded; a press unfolds it", async () => {
  await mount(BOARD);

  expect(sideways()).toBe(false);
  expect(byLabel("To do · 2").getAttribute("aria-expanded")).toBe("true");
  expect(byLabel("In progress · 1").getAttribute("aria-expanded")).toBe("true");
  expect(byLabel("Done · 1").getAttribute("aria-expanded")).toBe("false");
  expect(byLabel("Notes · 1").getAttribute("aria-expanded")).toBe("true");
  expect(lines()).toEqual([
    "To do · 2",
    "Rotate keys",
    "Reply",
    "Follow-up",
    "Write the release notes",
    "Reply",
    "Follow-up",
    "In progress · 1",
    "Check the build",
    "claimed by a1",
    "Reply",
    "Follow-up",
    "Done · 1",
    "Clear finished",
    "Notes · 1",
    "Note · user",
    "The demo is on Thursday",
    "Delete",
  ]);
  // A heading is a touch target.
  expect(getComputedStyle(byLabel("Done · 1")).minHeight).toBe("44px");

  await press("Done · 1");
  expect(byLabel("Done · 1").getAttribute("aria-expanded")).toBe("true");
  expect(lines()).toContain("Update the README");

  await press("To do · 2");
  expect(byLabel("To do · 2").getAttribute("aria-expanded")).toBe("false");
  expect(lines()).not.toContain("Rotate keys");
});

test("the board stacks under 720 and goes side by side from 720", async () => {
  await mount(BOARD);
  await sizeBoard(719);
  expect(sideways()).toBe(false);
  await sizeBoard(720);
  expect(sideways()).toBe(true);
  await sizeBoard(400);
  expect(sideways()).toBe(false);
});

test("Done's heading has Clear finished, which asks first; with nothing done there is none", async () => {
  await mount([post(1, { text: "Rotate keys" })]);
  expect(container.querySelector('[aria-label="Clear finished"]')).toBeNull();

  await mount(BOARD);
  await press("Clear finished");
  expect(asked).toEqual([]);
  expect(container.textContent).toContain("Delete 1 finished to-do?");
  await press("Delete");

  expect(asked).toEqual(["clearDone lobby"]);
});

test("a task's card ticks, unticks and deletes as the list's row does", async () => {
  await mount([post(1, { text: "Rotate keys" }), post(2, { text: "Old", state: "done" })]);
  await sizeBoard(900);

  await press("Rotate keys");
  await press("Old");
  await press("Delete task: Rotate keys");
  expect(container.textContent).toContain("Delete this post?");
  await press("Delete");

  expect(asked).toEqual(["markDone p1", "reopen p2", "remove p1"]);
});

test("a task waiting on another board's task is in Waiting, with its line, and moves when released", async () => {
  const elsewhere = post(9, { board: "w1", text: "Build the API" });
  const waits = post(6, { text: "Write the docs", after: ["p9"] });
  await mount([waits], [elsewhere, waits]);
  expect(container.textContent).toContain("Waiting · 1");
  expect(container.textContent).toContain("Waiting on p9");
  const done = { ...elsewhere, state: "done" as const };
  await mount([waits], [done, waits]);
  expect(container.textContent).not.toContain("Waiting · 1");
  expect(container.textContent).toContain("After p9");
});

test("Follow-up on a card names its task", async () => {
  await mount(BOARD);
  await act(async () => byLabel("Follow-up: Rotate keys").click());
  expect(followed).toEqual(["p1"]);
});
