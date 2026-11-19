/**
 * @vitest-environment jsdom
 */
// The duty board's editor, mounted: today's duties with Mark done and Reopen, and the list with
// its names, instructions and days, saved whole. The dialog, inputs and icons are the host's, so
// plain stand-ins show what they were given.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Duty, Post } from "../shared/contracts.js";
import { STARTING_DUTIES, dutyRows, type DutyDraft } from "../shared/duties.js";
import { DutySheet } from "./duty-sheet.js";
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
