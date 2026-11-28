/**
 * @vitest-environment jsdom
 */
// A task's result and its replies, mounted: on the to-do card the lobby and the kanban draw, and
// on a room's list row. The Reply field sends a note under the task.
import { act, useMemo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Post } from "../shared/contracts.js";
import { PostWithActions } from "./board-sheet.js";
import { useOfficeStyles } from "./styles.js";
import { AfterField, type FollowUp } from "./follow-up.js";
import { TaskCard } from "./task-card.js";
import { PostRow } from "./room-board.js";
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
  // The app opens the address; a link here is an anchor, so the address it would open is its href.
  const ExternalLink = (props: {
    href: string;
    accessibilityLabel?: string;
    children: ReactNode;
  }) => (
    <a href={props.href} aria-label={props.accessibilityLabel}>
      {props.children}
    </a>
  );
  return { Icon, ScrollView, TextInput, ExternalLink };
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
/** The tasks started, by id. */
let started: string[];
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
  start: async (id) => {
    started.push(id);
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
const teamIdOf = (id: string) => id;

const NO_REPLIES: Post[] = [];

/** The cards whose Follow-up was pressed. */
let followed: string[];
const onFollowUp = (id: string) => {
  followed.push(id);
};

function Card({
  task = TASK,
  replies = REPLIES,
  others = NO_REPLIES,
}: {
  task?: Post;
  replies?: Post[];
  /** The other tasks on the boards, besides this one. */
  others?: Post[];
}) {
  const styles = useOfficeStyles(THEME, false, false);
  const all = useMemo(() => [...others, task], [others, task]);
  return (
    <TaskCard
      post={task}
      all={all}
      onFollowUp={onFollowUp}
      replies={replies}
      name={nameOf}
      teamName={teamIdOf}
      actions={ACTIONS}
      styles={styles}
    />
  );
}

const PENDING: FollowUp = {
  after: ["p1"],
  full: false,
  field: { current: null },
  add: () => undefined,
  clear: () => undefined,
};

function PendingAfter() {
  const styles = useOfficeStyles(THEME, false, false);
  return <AfterField followUp={PENDING} styles={styles} />;
}

function Row({
  item,
  replies = REPLIES,
  others = NO_REPLIES,
}: {
  item: Post;
  replies?: Post[];
  others?: Post[];
}) {
  const styles = useOfficeStyles(THEME, false, false);
  const all = useMemo(() => [...others, item], [others, item]);
  return (
    <PostWithActions
      post={item}
      all={all}
      onFollowUp={onFollowUp}
      replies={replies}
      name={nameOf}
      teamName={teamIdOf}
      actions={ACTIONS}
      styles={styles}
    />
  );
}

function StyledRow({ item }: { item: Post }) {
  const styles = useOfficeStyles(THEME, false, false);
  return <PostRow post={item} name={nameOf} teamName={teamIdOf} styles={styles} brief />;
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  language.choice = "auto";
  followed = [];
  replied = [];
  started = [];
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
    "Follow-up",
  ]);
  expect(has("More")).toBe(false);
  expect(has("Write a reply")).toBe(false);
});

test("a task with no result and no replies has only its Reply button under it", async () => {
  await mount(<Card task={PLAIN} replies={NO_REPLIES} />);
  expect(lines()).toEqual(["Rotate keys", "Reply", "Follow-up"]);
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
    "Follow-up",
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
    "Follow-up",
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
    "Follow-up",
    "Mark done",
    "Delete",
  ]);
});

const CLAIMED = post(5, { text: "Rotate keys", state: "claimed", claimedBy: "a1" });

test("a task that is not blocked has no Needs you line", async () => {
  await mount(<Card task={CLAIMED} replies={NO_REPLIES} />);
  expect(lines().some((line) => line.startsWith("Needs you"))).toBe(false);
});

const FIRST = post(1, { text: "Build the API" });
const WAITS = post(2, { text: "Write the docs", after: ["p1"] });
const OPEN_FIRST = [FIRST];
const DONE_FIRST = [{ ...FIRST, state: "done" as const }];
const CLAIMED_WAITS = { ...WAITS, state: "claimed" as const, claimedBy: "a1" };
const NEEDING = post(3, { state: "claimed", claimedBy: "a1", blocked: "Which tag?" });
const NOTE = post(4, { kind: "note", state: undefined });

test("a task that waits says on what, on its card and on its row", async () => {
  await mount(<Card task={WAITS} replies={NO_REPLIES} others={OPEN_FIRST} />);
  expect(container.textContent).toContain("Waiting on p1");
  await mount(<Row item={WAITS} replies={NO_REPLIES} others={OPEN_FIRST} />);
  expect(container.textContent).toContain("Waiting on p1");
});

test("a released task says After, and a claimed or done one never says Waiting", async () => {
  await mount(<Card task={WAITS} replies={NO_REPLIES} others={DONE_FIRST} />);
  expect(container.textContent).toContain("After p1");
  expect(container.textContent).not.toContain("Waiting on");
  await mount(<Row item={CLAIMED_WAITS} replies={NO_REPLIES} others={OPEN_FIRST} />);
  expect(container.textContent).toContain("After p1");
  expect(container.textContent).not.toContain("Waiting on");
});

test("a task after none has no such line", async () => {
  await mount(<Card task={FIRST} replies={NO_REPLIES} />);
  expect(container.textContent).not.toContain("After");
  expect(container.textContent).not.toContain("Waiting on");
});

test("Follow-up is on every task, open, claimed or done, and tells which one", async () => {
  await mount(<Card task={FIRST} replies={NO_REPLIES} />);
  await act(async () => byLabel("Follow-up: Build the API").click());
  expect(followed).toEqual(["p1"]);
  await mount(<Card task={NEEDING} replies={NO_REPLIES} />);
  await act(async () => byLabel(`Follow-up: ${NEEDING.text}`).click());
  await mount(<Row item={TASK} />);
  await act(async () => byLabel("Follow-up: Ship the release").click());
  expect(followed).toEqual(["p1", "p3", "p1"]);
});

test("a note has no Follow-up", async () => {
  await mount(<Row item={NOTE} replies={NO_REPLIES} />);
  expect(container.textContent).not.toContain("Follow-up");
});

test("Follow-up and the lines are in Vietnamese when the interface is", async () => {
  language.choice = "vi";
  await mount(
    <UiLanguage>
      <Card task={WAITS} replies={NO_REPLIES} others={OPEN_FIRST} />
    </UiLanguage>,
  );
  expect(container.textContent).toContain(UI_VI["Follow-up"]);
  expect(container.textContent).toContain("Đang chờ p1");
  byLabel(`${UI_VI["Follow-up"]}: Write the docs`);
  await mount(
    <UiLanguage>
      <PendingAfter />
    </UiLanguage>,
  );
  expect(has(UI_VI.Clear)).toBe(true);
  expect(has("Clear")).toBe(false);
});

const TOOK = {
  claimedAt: "2026-11-17T09:00:00.000Z",
  doneAt: "2026-11-17T09:23:00.000Z",
  spentUsd: 0.42,
};

test("a done task's card says what it took, under the result and over the replies", async () => {
  await mount(<Card task={post(1, { ...TASK, ...TOOK })} />);
  expect(lines()).toEqual([
    "Ship the release",
    "Result",
    "Shipped 1.4.2",
    "took 23 min · $0.42",
    "Agent a1 · Which tag?",
    "You · v1.4.2",
    "Reply",
    "Follow-up",
  ]);
});

test("a room's list row says it too, with the time alone when no cost is known", async () => {
  await mount(
    <Row item={post(1, { ...TASK, ...TOOK, spentUsd: undefined })} replies={NO_REPLIES} />,
  );
  const shown = lines();
  expect(shown.slice(shown.indexOf("Ship the release")).slice(0, 4)).toEqual([
    "Ship the release",
    "Result",
    "Shipped 1.4.2",
    "took 23 min",
  ]);
});

test("a task not done, or done with no claim time, says nothing of it", async () => {
  await mount(<Card task={post(1, { ...TASK, ...TOOK, state: "claimed" })} replies={NO_REPLIES} />);
  expect(lines().some((line) => line.startsWith("took"))).toBe(false);
  await mount(<Card task={post(1, { ...TASK, doneAt: TOOK.doneAt })} replies={NO_REPLIES} />);
  expect(lines().some((line) => line.startsWith("took"))).toBe(false);
});

test("the line takes the interface's language, its dollar amount as it is", async () => {
  language.choice = "vi";
  await mount(
    <UiLanguage>
      <Card task={post(1, { ...TASK, ...TOOK })} replies={NO_REPLIES} />
    </UiLanguage>,
  );
  expect(lines()).toContain("mất 23 phút · $0.42");
});

const HELD = post(1, { text: "Rotate keys", backlog: true });
const PLAIN = post(1, { text: "Rotate keys" });
const HELD_DONE = post(1, { text: "Rotate keys", backlog: true, state: "done" });
const HELD_WAITING = post(1, { text: "Rotate keys", backlog: true, after: ["p2"] });
const BLOCKER = [post(2, { text: "Build the API" })];

test("a held task's card has Start with its action line, and keeps its box, Delete and thread", async () => {
  await mount(<Card task={HELD} replies={NO_REPLIES} />);
  expect(lines()).toEqual(["Rotate keys", "Start", "Reply", "Follow-up"]);
  expect(byLabel("Rotate keys").getAttribute("role")).toBe("checkbox");
  byLabel("Delete task: Rotate keys");
  // A task that is not held has no Start, and neither has a held one that is claimed or done.
  await mount(<Card task={PLAIN} replies={NO_REPLIES} />);
  expect(has("Start task: Rotate keys")).toBe(false);
  await mount(<Card task={HELD_DONE} replies={NO_REPLIES} />);
  expect(has("Start task: Rotate keys")).toBe(false);
});

test("Start starts the task by its id and shows Starting... while it waits", async () => {
  let release: () => void = () => undefined;
  answer = new Promise((done) => {
    release = done;
  });
  await mount(<Card task={HELD} replies={NO_REPLIES} />);
  await press("Start task: Rotate keys");
  expect(started).toEqual(["p1"]);
  expect(lines()).toContain("Starting...");
  expect(lines()).not.toContain("Start");
  release();
  await settle();
  expect(lines()).toContain("Start");
});

test("a refused Start shows why under the button, like the other actions", async () => {
  refusal = new Error("Unable to start: it is not in the backlog");
  await mount(<Card task={HELD} replies={NO_REPLIES} />);
  await press("Start task: Rotate keys");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Unable to start: it is not in the backlog",
  );
});

test("a held task that also waits still says what it waits on", async () => {
  await mount(<Card task={HELD_WAITING} replies={NO_REPLIES} others={BLOCKER} />);
  expect(lines()).toContain("Waiting on p2");
  expect(has("Start task: Rotate keys")).toBe(true);
});

const FROM_JIRA = post(7, {
  text: "PROJ-12 Checkout fails",
  source: { kind: "jira", key: "PROJ-12", url: "https://acme.atlassian.net/browse/PROJ-12" },
});
const FROM_GITHUB = post(8, {
  text: "Fix the ledger",
  source: {
    kind: "github",
    key: "acme/ledger#41",
    url: "https://github.com/acme/ledger/issues/41",
  },
});

/** The chip's link, by its label: its text and the address it opens. */
function chip(label: string): { text: string | null; href: string | null } {
  const link = byLabel(label);
  return { text: link.textContent, href: link.getAttribute("href") };
}

test("a task from a ticket shows its key as a link on the card, the row and the room's copy", async () => {
  const label = "Open PROJ-12 in Jira";
  const want = { text: "PROJ-12", href: "https://acme.atlassian.net/browse/PROJ-12" };
  await mount(<Card task={FROM_JIRA} replies={NO_REPLIES} />);
  expect(chip(label)).toEqual(want);
  await mount(<Row item={FROM_JIRA} replies={NO_REPLIES} />);
  expect(chip(label)).toEqual(want);
  await mount(<StyledRow item={FROM_JIRA} />);
  expect(chip(label)).toEqual(want);
});

test("an issue's chip names GitHub and keeps the key as it is", async () => {
  await mount(<Card task={FROM_GITHUB} replies={NO_REPLIES} />);
  expect(chip("Open acme/ledger#41 on GitHub")).toEqual({
    text: "acme/ledger#41",
    href: "https://github.com/acme/ledger/issues/41",
  });
});

test("a task without a source has no chip, and a press on the chip changes nothing", async () => {
  await mount(<Card task={post(9, { text: "Plain" })} replies={NO_REPLIES} />);
  expect(container.querySelector("a")).toBeNull();
  await mount(<Card task={FROM_JIRA} replies={NO_REPLIES} />);
  // jsdom does not navigate; the click is all that matters here.
  byLabel("Open PROJ-12 in Jira").addEventListener("click", (event) => event.preventDefault());
  await press("Open PROJ-12 in Jira");
  expect(started).toEqual([]);
});

test("an address that is not http or https is not opened", async () => {
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "//evil.test/x"]) {
    const task = post(10, { text: "Odd", source: { kind: "jira", key: "PROJ-1", url } });
    await mount(<Card task={task} replies={NO_REPLIES} />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("PROJ-1");
  }
});

test("the chip's label is translated like the visible words", async () => {
  language.choice = "vi";
  await mount(
    <UiLanguage>
      <Card task={FROM_JIRA} replies={NO_REPLIES} />
    </UiLanguage>,
  );
  expect(container.querySelector("a")?.getAttribute("aria-label")).toBe("Mở PROJ-12 trong Jira");
});
