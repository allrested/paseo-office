/**
 * @vitest-environment jsdom
 */
// The duty board's editor, mounted: today's duties with Mark done and Reopen, what a holder needs,
// what came of a duty and the replies under it, and the list with its names, instructions and
// days, saved whole. The dialog, inputs and icons are the host's, so plain stand-ins show what
// they were given.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Duty, Post } from "../shared/contracts.js";
import { STARTING_DUTIES, dutyRows, type DutyDraft } from "../shared/duties.js";
import { DutySheet } from "./duty-sheet.js";
import { translate } from "./ui-language.js";
import { useOfficeStyles } from "./styles.js";
import type { DutyActions } from "./use-duty-actions.js";

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

let saved: DutyDraft[][];
let asked: string[];
let refusal: Error | null;
/** The replies posted under a duty, as "<duty's post> <text>". */
let replied: string[];
/** The duties handed over, by their post's id. */
let handedOver: string[];
const BOARD = {
  reply: async (task: Post, text: string) => void replied.push(`${task.id} ${text}`),
  handOver: async (id: string) => void handedOver.push(id),
};

const ACTIONS: DutyActions = {
  save: async (duties) => {
    if (refusal) throw refusal;
    saved.push(duties.map((duty) => ({ ...duty, days: [...duty.days] })));
  },
  markDone: async (id) => void asked.push(`done ${id}`),
  reopen: async (id) => void asked.push(`reopen ${id}`),
  acted: async () => undefined,
};

function post(seq: number, id: string, patch: Partial<Post> = {}): Post {
  return {
    id: `p${seq}`,
    seq,
    board: "duty",
    kind: "task",
    text: id,
    author: "user",
    state: "open",
    duty: { id, day: "2026-11-18" },
    createdAt: "2026-11-18T05:00:00.000Z",
    updatedAt: "2026-11-18T05:00:00.000Z",
    ...patch,
  };
}

const BUILD: Duty = { id: "build", name: "Build", instructions: "Run the build", days: [3] };
const LIST: Duty[] = [STARTING_DUTIES[0] as Duty, BUILD];
const POSTS = [
  post(1, "cups", { state: "done", claimedBy: "a1" }),
  post(2, "build", { state: "claimed", claimedBy: "a2" }),
];
const NOTHING = () => undefined;
const nameOf = (id: string) => ({ a1: "Planner", a2: "Builder" })[id] ?? id;

function Harness({ list, posts }: { list: Duty[] | null; posts: Post[] }) {
  const styles = useOfficeStyles(THEME, false, false);
  return (
    <DutySheet
      open
      list={list}
      rows={dutyRows(list === null ? undefined : { duties: list, day: "2026-11-18" }, posts)}
      name={nameOf}
      actions={ACTIONS}
      board={BOARD}
      styles={styles}
      onClose={NOTHING}
    />
  );
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  saved = [];
  asked = [];
  replied = [];
  handedOver = [];
  refusal = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = (list: Duty[] | null = LIST, posts: Post[] = POSTS) =>
  act(async () => root.render(<Harness list={list} posts={posts} />));
const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));

function byLabel(label: string, within: ParentNode = container): HTMLElement {
  const found = within.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`Nothing is labelled "${label}"`);
  return found;
}

async function press(label: string, within?: ParentNode): Promise<void> {
  await act(async () => byLabel(label, within).click());
  await settle();
}

async function type(label: string, text: string): Promise<void> {
  const field = byLabel(label);
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function blur(label: string): Promise<void> {
  await act(async () =>
    byLabel(label).dispatchEvent(new FocusEvent("focusout", { bubbles: true })),
  );
}

const text = () => container.textContent ?? "";
const fieldText = (label: string) => (byLabel(label) as HTMLInputElement).value;
const pressed = (group: string) =>
  [...byLabel(group).querySelectorAll('[aria-pressed="true"]')].map((pill) =>
    pill.getAttribute("aria-label"),
  );

test("today's duties say who has each; done ones reopen and open ones are marked done", async () => {
  await mount();
  expect(byLabel("Duty board")).toBeTruthy();
  expect(text()).toContain("Done by Planner");
  expect(text()).toContain("Builder has it");
  await press("Reopen Wash the cups");
  await press("Mark Build done");
  expect(asked).toEqual(["reopen p1", "done p2"]);
});

test("a claimed duty can be reopened as well as marked done; an open one only marked done", async () => {
  await mount(LIST, [post(1, "cups", {}), post(2, "build", { state: "claimed", claimedBy: "a2" })]);
  expect(container.querySelector('[aria-label="Reopen Wash the cups"]')).toBeNull();
  await press("Reopen Build");
  await press("Mark Build done");
  expect(asked).toEqual(["reopen p2", "done p2"]);
});

/** Every line of text shown in today's row of the duty named `title`, in order. */
function rowLines(title: string): string[] {
  const row = [...container.querySelectorAll<HTMLElement>("div")].findLast((element) =>
    [...element.children].some((child) => child.textContent === title),
  )?.parentElement;
  if (!row) throw new Error(`No row for "${title}"`);
  return [...row.querySelectorAll("*")]
    .filter((element) => element.childElementCount === 0 && element.textContent !== "")
    .filter((element) => element.closest('[aria-hidden="true"]') === null)
    .map((element) => element.textContent ?? "");
}

test("a blocked duty says what its holder needs, and Reply under it posts the answer", async () => {
  await mount(LIST, [
    post(1, "cups"),
    post(2, "build", { state: "claimed", claimedBy: "a2", blocked: "Which branch?" }),
    post(3, "build", {
      kind: "note",
      state: undefined,
      duty: undefined,
      replyTo: "p2",
      author: "a2",
      text: "It is not main",
    }),
  ]);
  expect(rowLines("Build")).toEqual([
    "Build",
    "Builder has it",
    "Needs you: Which branch?",
    "Builder · It is not main",
    "Reply",
    "Reopen",
    "Hand over",
    "Mark done",
  ]);
  await press("Reply");
  await type("Write a reply", "release/2");
  await press("Send");
  expect(replied).toEqual(["p2 release/2"]);
  // An open duty nobody has is answered by nobody: it has no thread.
  expect(rowLines("Wash the cups")).toEqual([
    "Wash the cups",
    "Open: the 3D office acts it out",
    "Mark done",
  ]);
});

test("a done duty shows its result, what it took and the replies under it", async () => {
  const long = "Line one\nLine two\nLine three\nLine four";
  await mount(LIST, [
    post(2, "build", {
      state: "done",
      claimedBy: "a2",
      result: long,
      claimedAt: "2026-11-18T09:00:00.000Z",
      doneAt: "2026-11-18T09:23:00.000Z",
      spentUsd: 0.42,
    }),
    post(4, "build", {
      kind: "note",
      state: undefined,
      duty: undefined,
      replyTo: "p2",
      text: "Thanks",
    }),
  ]);
  expect(rowLines("Build")).toEqual([
    "Build",
    "Done by Builder",
    "Result",
    "Line one\nLine two\nLine three…",
    "More",
    "took 23 min · $0.42",
    "user · Thanks",
    "Reopen",
  ]);
  await press("More");
  expect(text()).toContain("Line four");
  // A finished duty is not answered from here: only one an agent has takes a reply.
  expect(container.querySelector('[aria-label="Reply"]')).toBeNull();
});

test("what a duty's holder needs is said in the interface's language", () => {
  for (const language of ["id", "vi", "th"] as const) {
    const said = translate(language, "Needs you: Which branch?");
    expect(said, language).toContain("Which branch?");
    expect(said, language).not.toContain("Needs you");
  }
});

test("a day with nothing due says so", async () => {
  await mount(LIST, []);
  expect(text()).toContain("No duty is due today.");
});

test("the list edits names, instructions and days, and saves whole", async () => {
  await mount();
  expect(fieldText("Duty 1 name")).toBe("Wash the cups");
  expect(fieldText("Duty 2 instructions")).toBe("Run the build");
  expect(pressed("Duty 1 days")).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
  await type("Duty 1 name", "Mugs");
  await press("Saturday", byLabel("Duty 2 days"));
  await press("Add a duty");
  await type("Duty 3 name", "Tidy the docs");
  await type("Duty 3 instructions", "Fix broken links");
  await press("Save duties");
  expect(saved).toEqual([
    [
      { id: "cups", name: "Mugs", instructions: "", days: [1, 2, 3, 4, 5] },
      { id: "build", name: "Build", instructions: "Run the build", days: [3, 6] },
      { name: "Tidy the docs", instructions: "Fix broken links", days: [1, 2, 3, 4, 5] },
    ],
  ]);
});

test("a duty removed is not saved; a list the host refuses keeps what was typed and says why", async () => {
  await mount();
  await press("Remove Wash the cups");
  expect(fieldText("Duty 1 name")).toBe("Build");
  refusal = new Error("Unable to save the duty list: disk full");
  await press("Save duties");
  expect(text()).toContain("Unable to save the duty list: disk full");
  expect(fieldText("Duty 1 name")).toBe("Build");
  await type("Duty 1 name", "");
  refusal = null;
  await press("Save duties");
  expect(saved).toEqual([]);
  expect(text()).toContain("Unable to save: duty 1 has no name");
});

test("the list is full at 12 duties, and waits for the host's list", async () => {
  const twelve = Array.from({ length: 12 }, (_, index) => ({ ...BUILD, id: `d${index}` }));
  await mount(twelve, []);
  expect(byLabel("Add a duty").getAttribute("aria-disabled")).toBe("true");
  await mount(null, []);
  expect(text()).toContain("Loading the duty list...");
});

test("each duty has a time: shown when not 08:00, kept as HH:MM, and refused outside 08:00 to 23:59", async () => {
  const timed: Duty = { ...BUILD, time: "14:30" };
  await mount([STARTING_DUTIES[0] as Duty, timed], [post(1, "cups"), post(2, "build")]);
  expect(text()).toContain("Build · 14:30");
  expect(text()).not.toContain("Wash the cups ·");
  expect(text()).toContain("Time");
  expect(fieldText("Duty 1 time")).toBe("");
  expect(byLabel("Duty 1 time").getAttribute("placeholder")).toBe("08:00");
  expect(fieldText("Duty 2 time")).toBe("14:30");
  await type("Duty 1 time", "9:05");
  await blur("Duty 1 time");
  expect(fieldText("Duty 1 time")).toBe("09:05");
  await type("Duty 2 time", "07:00");
  await blur("Duty 2 time");
  expect(fieldText("Duty 2 time")).toBe("07:00");
  expect(text()).toContain("Between 08:00 and 23:59");
  expect(byLabel("Save duties").getAttribute("aria-disabled")).toBe("true");
  await press("Save duties");
  expect(saved).toEqual([]);
  // Empty is no time: 08:00.
  await type("Duty 2 time", "");
  expect(text()).not.toContain("Between 08:00 and 23:59");
  await press("Save duties");
  expect(saved).toEqual([
    [
      { id: "cups", name: "Wash the cups", instructions: "", days: [1, 2, 3, 4, 5], time: "09:05" },
      { id: "build", name: "Build", instructions: "Run the build", days: [3] },
    ],
  ]);
  expect(saved[0]?.[1]).not.toHaveProperty("time");
});

test("the time field's words are in the interface's language", () => {
  for (const language of ["id", "vi", "th"] as const) {
    expect(translate(language, "Time"), language).not.toBe("Time");
    expect(translate(language, "Between 08:00 and 23:59"), language).toContain("08:00");
    expect(translate(language, "Duty 2 time"), language).toContain("2");
    expect(translate(language, "Duty 2 time"), language).not.toBe("Duty 2 time");
  }
});

test("a duty an agent holds can be handed over: it asks first, then hands the post over", async () => {
  await mount(LIST, [post(1, "cups"), post(2, "build", { state: "claimed", claimedBy: "a2" })]);
  await press("Hand over");
  expect(text()).toContain(
    "Hand p2 over to an agent of another provider? Builder loses it, and a note says where it was left.",
  );
  expect(handedOver).toEqual([]);
  await press("Keep it");
  expect(handedOver).toEqual([]);
  await press("Hand over");
  await press("Hand over");
  expect(handedOver).toEqual(["p2"]);
});

test("Hand over is not on an open duty, a done one or one the owner holds", async () => {
  await mount(LIST, [
    post(1, "cups", { state: "done", claimedBy: "a1" }),
    post(2, "build", { state: "claimed", claimedBy: "user" }),
  ]);
  expect(container.querySelector('[aria-label="Hand over"]')).toBeNull();
  await mount(LIST, [post(1, "cups"), post(2, "build")]);
  expect(container.querySelector('[aria-label="Hand over"]')).toBeNull();
});

test("a duty's question is for one holder: when another agent has it, it closes and asks by name", async () => {
  await mount(LIST, [post(1, "cups"), post(2, "build", { state: "claimed", claimedBy: "a2" })]);
  await press("Hand over");
  expect(text()).toContain("Builder loses it");
  await mount(LIST, [post(1, "cups"), post(2, "build", { state: "claimed", claimedBy: "a1" })]);
  expect(text()).not.toContain("loses it");
  await press("Hand over");
  expect(text()).toContain("Planner loses it");
  expect(handedOver).toEqual([]);
});
