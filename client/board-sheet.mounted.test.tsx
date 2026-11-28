/**
 * @vitest-environment jsdom
 */
// A board's sheet, mounted: its form, the page that chooses who a post wakes, the room's agents
// and what is posted; on the lobby, the to-do list and the agents at work in every room. Each
// board is a list or a kanban as the device's setting says; the tests are on the list unless
// they say otherwise.
// The sheet, the inputs and the icon are the host's, so plain stand-ins show what they were given.
import { act, createElement, useCallback, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { OfficeAgent, OfficeSnapshot, Post } from "../shared/contracts.js";
import type { DutyRow } from "../shared/duties.js";
import type { RosterTeam } from "../shared/roster.js";
import { BoardSheet } from "./board-sheet.js";
import { buildOfficeModel, type AgentTaskGroup, type OfficeRoom } from "../shared/model.js";
import type { BoardLayout } from "../shared/settings.js";
import { OfficeDialogs } from "./office-modal.js";
import { useOfficeStyles } from "./styles.js";
import type { BoardActions } from "./use-board-actions.js";

/** What the host's sheet does when it is closed: Escape, its close button, a swipe. */
let dismiss: () => void = () => undefined;

const rename = vi.hoisted(() => vi.fn(async (_input: object) => ({ ok: true as const })));
/** What the device holds of the boards' layouts. */
const layoutSetting = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: () => rename,
  useSettings: () => layoutSetting.current,
}));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { ScrollView, TextInput } = await import("react-native");
  const Modal = (props: {
    title: string;
    open: boolean;
    onOpenChange(open: boolean): void;
    children: ReactNode;
  }) => {
    dismiss = () => props.onOpenChange(false);
    return props.open
      ? createElement("section", { "aria-label": props.title }, props.children)
      : null;
  };
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  const Icon = () => null;
  return { Icon, Modal, ScrollView, TextInput };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

function agent(id: string, patch: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: `Agent ${id}`,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: `2026-11-16T00:00:${id.padStart(2, "0")}Z`,
    ...patch,
  };
}

function officeRooms(agents: OfficeAgent[], boards: OfficeSnapshot["boards"] = {}): OfficeRoom[] {
  const snapshot: OfficeSnapshot = {
    agents,
    workspaces: [
      { id: "w1", name: "shop-api", projectName: "shop" },
      { id: "w2", name: "landing", projectName: "site" },
    ],
    activity: {},
    doing: {},
    boards,
    wake: { paused: false, queued: {} },
  };
  return buildOfficeModel(snapshot).rooms;
}

/** The office with these agents and what the host reads of them: its rooms, and its agents' steps. */
function office(agents: OfficeAgent[], read: Partial<OfficeSnapshot> = {}) {
  const model = buildOfficeModel({
    agents,
    workspaces: [
      { id: "w1", name: "shop-api", projectName: "shop" },
      { id: "w2", name: "landing", projectName: "site" },
    ],
    activity: {},
    boards: {},
    wake: { paused: false, queued: {} },
    ...read,
  });
  return { rooms: model.rooms, agentTasks: model.agentTasks };
}

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

/** The office with these posts on the lobby's board. */
function lobbyRooms(posts: Post[], agents: OfficeAgent[] = []): OfficeRoom[] {
  return officeRooms(agents, { lobby: posts });
}

let posted: Array<Parameters<BoardActions["post"]>[0]>;
/** The board changes asked of the host, in order: "markDone p2", "clearDone lobby". */
let asked: string[];
/** Set to make the host refuse the post or the change. */
let refusal: Error | null;
/** While set, a change waits for it: the host has not answered yet. */
let answer: Promise<void> | null;
let closed: number;
/** The agents asked for from a board, and the boards asked for from the lobby's, in order. */
let selected: string[];
let opened: string[];

async function change(request: string): Promise<void> {
  asked.push(request);
  await answer;
  if (refusal) throw refusal;
}

const ACTIONS: BoardActions = {
  post: async (input) => {
    if (refusal) throw refusal;
    posted.push(input);
  },
  reply: (task, text) => change(`reply ${task.id} ${text}`),
  markDone: (id) => change(`markDone ${id}`),
  reopen: (id) => change(`reopen ${id}`),
  remove: (id) => change(`remove ${id}`),
  clearDone: (board) => change(`clearDone ${board}`),
  start: (id) => change(`start ${id}`),
  setWakesPaused: async () => undefined,
};
const nameOf = (author: string) => author;
const onClose = () => {
  closed += 1;
};
const onSelectAgent = (agentId: string) => {
  selected.push(agentId);
};
const onOpenBoard = (roomId: string) => {
  opened.push(roomId);
};

let backs: number;
const onBack = () => {
  backs += 1;
};

const NO_TASKS: AgentTaskGroup[] = [];

interface HarnessProps {
  rooms: OfficeRoom[];
  /** The room whose board is open. */
  roomId?: string;
  agentTasks?: AgentTaskGroup[];
  compact?: boolean;
  /** The host's sheet has left by the time it reports a close: a phone's, or any on native. */
  sheetLeavesFirst?: boolean;
  wakesPaused?: boolean;
  /** The board was opened from the lobby's. */
  fromLobby?: boolean;
  /** In fullscreen: the office's own dialog, not the host's sheet. */
  fullscreen?: boolean;
  /** The roster's teams the lobby's form offers; none by default (a roster that is off). */
  teams?: RosterTeam[];
  /** The duty board's rows; none by default. */
  duties?: DutyRow[];
}

const NO_TEAMS: RosterTeam[] = [];
const NO_DUTIES: DutyRow[] = [];

function Harness({
  rooms,
  roomId = "w1",
  agentTasks = NO_TASKS,
  compact = false,
  sheetLeavesFirst = false,
  wakesPaused = false,
  fromLobby = false,
  fullscreen = false,
  teams = NO_TEAMS,
  duties = NO_DUTIES,
}: HarnessProps) {
  const styles = useOfficeStyles(THEME, compact, false);
  const teamName = useCallback(
    (id: string) => teams.find((team) => team.id === id)?.name ?? id,
    [teams],
  );
  return (
    <OfficeDialogs fullscreen={fullscreen} theme={THEME} styles={styles}>
      <BoardSheet
        room={rooms.find((room) => room.id === roomId) ?? null}
        rooms={rooms}
        duties={duties}
        agentTasks={agentTasks}
        name={nameOf}
        teams={teams}
        teamName={teamName}
        actions={ACTIONS}
        wakesPaused={wakesPaused}
        sheetLeavesFirst={sheetLeavesFirst}
        styles={styles}
        onSelectAgent={onSelectAgent}
        onOpenBoard={onOpenBoard}
        onBack={fromLobby ? onBack : undefined}
        onClose={onClose}
      />
    </OfficeDialogs>
  );
}

let container: HTMLElement;
let root: Root;

/** The device's boards are laid out so. */
function layouts(lobby: BoardLayout, rooms: BoardLayout): void {
  layoutSetting.current = { status: "ready", values: { lobby, rooms } };
}

beforeEach(() => {
  layouts("list", "list");
  posted = [];
  asked = [];
  refusal = null;
  answer = null;
  closed = 0;
  selected = [];
  opened = [];
  backs = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = (props: HarnessProps) => act(async () => root.render(<Harness {...props} />));
const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));
const title = () => container.querySelector("section")?.getAttribute("aria-label");

function byLabel(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`Nothing is labelled "${label}"`);
  return found;
}

async function press(label: string): Promise<void> {
  await act(async () => byLabel(label).click());
  await settle();
}

/** Enter in the field, with the focus in it. */
async function enter(label: string): Promise<void> {
  const field = byLabel(label);
  await act(async () => {
    field.focus();
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await settle();
}

const isOff = (label: string) => byLabel(label).getAttribute("aria-disabled") === "true";
const fieldText = (label: string) => (byLabel(label) as HTMLInputElement).value;

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

/** Every line of text the sheet shows, in order; a button's hidden width spacer is left out. */
function lines(): string[] {
  return [...container.querySelectorAll("*")]
    .filter((element) => element.childElementCount === 0 && element.textContent !== "")
    .filter((element) => element.closest('[aria-hidden="true"]') === null)
    .map((element) => element.textContent ?? "");
}

/** The lines from this heading on. */
function linesFrom(heading: string): string[] {
  const all = lines();
  return all.slice(all.indexOf(heading));
}

const checkboxes = () => [...container.querySelectorAll<HTMLElement>('[role="checkbox"]')];

const radios = () =>
  [...container.querySelectorAll('[role="radio"]')].map((row) => row.getAttribute("aria-label"));

test("the form's row opens the page, which has the room's agents first", async () => {
  await mount({
    rooms: officeRooms([
      agent("1", { workspaceId: null }),
      agent("2"),
      agent("3", { workspaceId: "w2", status: "running" }),
    ]),
  });
  expect(title()).toBe("shop-api board");

  await press("Wake an agent with it: Nobody");

  expect(title()).toBe("Wake an agent");
  expect(radios()).toEqual([
    "Nobody: The post wakes no agent",
    "Agent 2: shop-api · Idle",
    "Agent 1: Lobby · Idle",
    "Agent 3: landing · Running",
  ]);
  expect(container.textContent).toContain("This room");
  expect(container.textContent).toContain("Other rooms");
  expect(container.querySelector('[aria-label="Search agents"]')).toBeNull();
});

test("the row that is nobody keeps a slot as wide as an agent's dot, so the titles line up", async () => {
  await mount({ rooms: officeRooms([agent("1")]) });
  await press("Wake an agent with it: Nobody");

  // react-native-web writes these styles inline in jsdom; a real browser measured the rail.
  const lead = (label: string) => byLabel(label).firstElementChild as HTMLElement;
  const nobody = lead("Nobody: The post wakes no agent");
  const dot = lead("Agent 1: shop-api · Idle").firstElementChild as HTMLElement;
  expect(nobody.childElementCount).toBe(0);
  expect(getComputedStyle(nobody).width).not.toBe("");
  expect(getComputedStyle(nobody).width).toBe(getComputedStyle(dot).width);
});

test("a chosen agent is on the form with the text kept, and the post names it", async () => {
  await mount({ rooms: officeRooms([agent("1"), agent("2", { title: "Builder" })]) });
  await type("Task text", "Ship it");
  await press("Wake an agent with it: Nobody");

  await press("Builder: shop-api · Idle");

  expect(title()).toBe("shop-api board");
  expect((byLabel("Task text") as HTMLTextAreaElement).value).toBe("Ship it");
  await press("Wake an agent with it: Builder");
  expect(byLabel("Builder: shop-api · Idle").getAttribute("aria-checked")).toBe("true");
  await press("Back");

  await press("Post");

  expect(posted).toEqual([{ board: "w1", kind: "task", text: "Ship it", to: "2" }]);
  // A post that was sent starts the next one from nobody.
  byLabel("Wake an agent with it: Nobody");
});

test("a post the host refuses keeps the text and the chosen agent", async () => {
  await mount({ rooms: officeRooms([agent("2", { title: "Builder" })]) });
  await type("Task text", "Ship it");
  await press("Wake an agent with it: Nobody");
  await press("Builder: shop-api · Idle");
  refusal = new Error("the board is full");

  await press("Post");

  expect(posted).toEqual([]);
  expect(container.textContent).toContain("Unable to post: the board is full");
  expect((byLabel("Task text") as HTMLTextAreaElement).value).toBe("Ship it");
  byLabel("Wake an agent with it: Builder");
});

test("Back returns to the form without a change", async () => {
  await mount({ rooms: officeRooms([agent("1")]) });
  await press("Wake an agent with it: Nobody");

  await press("Back");

  expect(title()).toBe("shop-api board");
  byLabel("Wake an agent with it: Nobody");
});

test("from nine agents a search keeps the ones whose title or room has the words", async () => {
  const nine = Array.from({ length: 9 }, (_, index) =>
    agent(String(index + 1), index === 8 ? { workspaceId: "w2", title: "Copy" } : {}),
  );
  await mount({ rooms: officeRooms(nine) });
  await press("Wake an agent with it: Nobody");
  expect(radios()).toHaveLength(10);

  await type("Search agents", "landing");
  expect(radios()).toEqual(["Nobody: The post wakes no agent", "Copy: landing · Idle"]);

  await type("Search agents", "zzz");
  expect(container.textContent).toContain("No agent matches.");
});

test("focus goes to the chosen row when the page opens, and back to the form's row after", async () => {
  await mount({ rooms: officeRooms([agent("1"), agent("2", { title: "Builder" }), agent("3")]) });

  await press("Wake an agent with it: Nobody");
  expect(document.activeElement).toBe(byLabel("Nobody: The post wakes no agent"));

  await press("Builder: shop-api · Idle");
  expect(document.activeElement).toBe(byLabel("Wake an agent with it: Builder"));

  await press("Wake an agent with it: Builder");
  expect(document.activeElement).toBe(byLabel("Builder: shop-api · Idle"));

  await press("Back");
  expect(document.activeElement).toBe(byLabel("Wake an agent with it: Builder"));
});

test("with nine agents the search field takes the focus", async () => {
  await mount({
    rooms: officeRooms(Array.from({ length: 9 }, (_, index) => agent(String(index + 1)))),
  });
  await press("Wake an agent with it: Nobody");
  expect(document.activeElement).toBe(byLabel("Search agents"));
});

test("thirty agents are all on the page", async () => {
  const thirty = Array.from({ length: 30 }, (_, index) => agent(String(index + 1)));
  await mount({ rooms: officeRooms(thirty) });
  await press("Wake an agent with it: Nobody");
  expect(radios()).toHaveLength(31);
});

test("a close from the page goes back while the sheet stays, and closes one that has left", async () => {
  const rooms = officeRooms([agent("1")]);
  await mount({ rooms });
  await press("Wake an agent with it: Nobody");

  await act(async () => dismiss());
  expect(title()).toBe("shop-api board");
  expect(closed).toBe(0);
  expect(document.activeElement).toBe(byLabel("Wake an agent with it: Nobody"));
  await act(async () => dismiss());
  expect(closed).toBe(1);

  // A phone's sheet, swiped away.
  await mount({ rooms, compact: true, sheetLeavesFirst: true });
  await press("Wake an agent with it: Nobody");
  await act(async () => dismiss());
  expect(closed).toBe(2);

  // A tablet's sheet, which Android's Back dismisses before it reports. The host took the closed
  // sheet away, so it opens again on the form.
  await mount({ rooms: [] });
  await mount({ rooms, compact: false, sheetLeavesFirst: true });
  await press("Wake an agent with it: Nobody");
  await act(async () => dismiss());
  expect(closed).toBe(3);
});

test("a chosen agent that leaves the office is nobody again", async () => {
  await mount({ rooms: officeRooms([agent("1"), agent("2", { title: "Builder" })]) });
  await press("Wake an agent with it: Nobody");
  await press("Builder: shop-api · Idle");
  byLabel("Wake an agent with it: Builder");

  await mount({ rooms: officeRooms([agent("1")]) });

  byLabel("Wake an agent with it: Nobody");
});

test("with wakes off the form says that a named agent waits", async () => {
  await mount({ rooms: officeRooms([agent("2", { title: "Builder" })]), wakesPaused: true });
  expect(container.textContent).not.toContain("Wake agents is off");
  await press("Wake an agent with it: Nobody");
  await press("Builder: shop-api · Idle");
  expect(container.textContent).toContain(
    "Wake agents is off. The agent gets this post when you turn it on.",
  );
});

test("the lobby adds a to-do with Enter and with Add, and keeps the agent choice to the form", async () => {
  await mount({
    rooms: lobbyRooms([], [agent("2", { title: "Builder", workspaceId: null })]),
    roomId: "lobby",
  });
  expect(title()).toBe("Lobby board");
  // The field adds to-dos only: no Task/Note choice.
  expect(container.querySelector('[aria-label="Kind of post"]')).toBeNull();
  expect(radios()).toEqual([]);
  expect(isOff("Add")).toBe(true);
  await type("Add a to-do", "   ");
  expect(isOff("Add")).toBe(true);

  await type("Add a to-do", "Rotate keys");
  expect(isOff("Add")).toBe(false);
  await enter("Add a to-do");

  expect(posted).toEqual([{ board: "lobby", kind: "task", text: "Rotate keys" }]);
  expect(fieldText("Add a to-do")).toBe("");
  // The next to-do is typed straight after: the field keeps the focus.
  expect(document.activeElement).toBe(byLabel("Add a to-do"));

  await type("Add a to-do", "Check the build");
  await press("Send task to: Any idle agent");
  expect(title()).toBe("Send task to");
  expect(radios()).toEqual([
    "Any idle agent: An available agent picks up the task automatically.",
    "Builder: Lobby · Idle",
  ]);
  await press("Builder: Lobby · Idle");
  expect(title()).toBe("Lobby board");
  byLabel("Send task to: Builder");
  expect(fieldText("Add a to-do")).toBe("Check the build");
  await press("Add");

  expect(posted).toEqual([
    { board: "lobby", kind: "task", text: "Rotate keys" },
    { board: "lobby", kind: "task", text: "Check the build", to: "2" },
  ]);
  expect(fieldText("Add a to-do")).toBe("");
  byLabel("Send task to: Any idle agent");
});

test("a paused lobby task waits for wakes to resume, including the automatic choice", async () => {
  const rooms = lobbyRooms([], [agent("2", { title: "Builder" })]);
  await mount({ rooms, roomId: "lobby", wakesPaused: true });
  expect(container.textContent).toContain("Automatic pickup resumes when you turn on Wake agents.");
  await press("Send task to: Any idle agent");
  await press("Builder: shop-api · Idle");
  expect(container.textContent).toContain("The agent gets this post when you turn it on.");
  await mount({ rooms, roomId: "lobby" });
  expect(container.textContent).not.toContain("Wake agents is off");
});

test("a to-do the host refuses keeps its text and says why", async () => {
  await mount({ rooms: lobbyRooms([]), roomId: "lobby" });
  await type("Add a to-do", "Rotate keys");
  refusal = new Error("the board is full");

  await enter("Add a to-do");

  expect(posted).toEqual([]);
  expect(container.textContent).toContain("Unable to add: the board is full");
  expect(fieldText("Add a to-do")).toBe("Rotate keys");
});

test("ticking sends done, unticking sends reopen, and a pending box takes no second tap", async () => {
  await mount({
    rooms: lobbyRooms([
      post(1, { text: "Update the README", state: "done" }),
      post(2, { text: "Rotate keys" }),
    ]),
    roomId: "lobby",
  });
  // Open ones first, then done ones.
  expect(checkboxes().map((box) => box.getAttribute("aria-label"))).toEqual([
    "Rotate keys",
    "Update the README",
  ]);
  expect(byLabel("Rotate keys").getAttribute("aria-checked")).toBe("false");
  expect(byLabel("Update the README").getAttribute("aria-checked")).toBe("true");

  let release: () => void = () => undefined;
  answer = new Promise((resolve) => {
    release = resolve;
  });
  await press("Rotate keys");
  expect(isOff("Rotate keys")).toBe(true);
  await press("Rotate keys");
  expect(asked).toEqual(["markDone p2"]);
  await act(async () => release());
  await settle();
  expect(isOff("Rotate keys")).toBe(false);
  answer = null;

  await press("Update the README");
  expect(asked).toEqual(["markDone p2", "reopen p1"]);

  refusal = new Error("Unable to finish p2: it is a note");
  await press("Rotate keys");
  // Under its own row, and the box still shows the board's state.
  expect(byLabel("Rotate keys").parentElement?.parentElement?.textContent).toContain(
    "Unable to finish p2: it is a note",
  );
  expect(byLabel("Rotate keys").getAttribute("aria-checked")).toBe("false");
});

test("Clear finished asks with the live count and clears the lobby", async () => {
  const open = post(1, { text: "Rotate keys" });
  await mount({ rooms: lobbyRooms([open]), roomId: "lobby" });
  expect(isOff("Clear finished")).toBe(true);

  const twoDone = [open, post(2, { state: "done" }), post(3, { state: "done" })];
  await mount({ rooms: lobbyRooms(twoDone), roomId: "lobby" });
  expect(isOff("Clear finished")).toBe(false);
  await press("Clear finished");
  expect(container.textContent).toContain("Delete 2 finished to-dos?");

  // An agent finishes another one while the question shows.
  await mount({ rooms: lobbyRooms([...twoDone, post(4, { state: "done" })]), roomId: "lobby" });
  expect(container.textContent).toContain("Delete 3 finished to-dos?");

  await press("Keep");
  expect(container.textContent).not.toContain("finished to-dos?");
  await press("Clear finished");
  await press("Delete");
  expect(asked).toEqual(["clearDone lobby"]);
  byLabel("Clear finished");
});

test("the clear question ends when nothing is done, and the next done to-do does not bring it back", async () => {
  const open = post(1, { text: "Rotate keys" });
  await mount({ rooms: lobbyRooms([open, post(2, { state: "done" })]), roomId: "lobby" });
  await press("Clear finished");
  expect(container.textContent).toContain("Delete 1 finished to-do?");

  // Another hand clears it, then an agent ticks another to-do.
  await mount({ rooms: lobbyRooms([open]), roomId: "lobby" });
  await mount({ rooms: lobbyRooms([open, post(3, { state: "done" })]), roomId: "lobby" });

  expect(container.textContent).not.toContain("finished to-do?");
  expect(isOff("Clear finished")).toBe(false);
});

test("a to-do arriving while typing keeps the typed text", async () => {
  const agents = [agent("2", { title: "Builder", workspaceId: null })];
  const first = post(1, { text: "Rotate keys" });
  await mount({ rooms: lobbyRooms([first], agents), roomId: "lobby" });
  await type("Add a to-do", "half");
  await press("Send task to: Any idle agent");
  await press("Builder: Lobby · Idle");

  // An agent ticks the first to-do and adds another.
  const ticked = { ...first, state: "done" as const };
  const added = post(2, { text: "Check the build", author: "2" });
  await mount({ rooms: lobbyRooms([ticked, added], agents), roomId: "lobby" });

  expect(checkboxes().map((box) => box.getAttribute("aria-label"))).toEqual([
    "Check the build",
    "Rotate keys",
  ]);
  expect(byLabel("Rotate keys").getAttribute("aria-checked")).toBe("true");
  expect(fieldText("Add a to-do")).toBe("half");
  byLabel("Send task to: Builder");
});

test("a to-do's delete icon names the task and asks first", async () => {
  await mount({ rooms: lobbyRooms([post(1, { text: "Rotate keys" })]), roomId: "lobby" });

  await press("Delete task: Rotate keys");
  expect(asked).toEqual([]);
  expect(container.textContent).toContain("Delete this post?");
  await press("Delete");

  expect(asked).toEqual(["remove p1"]);
});

test("notes show under the list only when there are notes", async () => {
  const todo = post(1, { text: "Rotate keys", state: "claimed", claimedBy: "a1", to: "a1" });
  await mount({ rooms: lobbyRooms([todo]), roomId: "lobby" });
  expect(lines()).not.toContain("Notes");

  const note = post(2, { kind: "note", state: undefined, text: "The demo is on Thursday" });
  await mount({ rooms: lobbyRooms([todo, note]), roomId: "lobby" });

  expect(linesFrom("To-do")).toEqual([
    "To-do",
    "Clear finished",
    "Rotate keys",
    "claimed by a1 · for a1",
    "Reply",
    "Follow-up",
    "Notes",
    "Note · user",
    "The demo is on Thursday",
    "Delete",
    "Agent tasks",
    "No agent tasks",
  ]);
});

test("the lobby's list draws a reply under its to-do, never in Notes", async () => {
  const todo = post(1, { text: "Rotate keys", state: "done", result: "Rotated" });
  const reply = post(2, {
    kind: "note",
    state: undefined,
    replyTo: "p1",
    author: "a1",
    text: "Thanks",
  });
  await mount({ rooms: lobbyRooms([todo, reply]), roomId: "lobby" });

  expect(lines()).not.toContain("Notes");
  expect(linesFrom("To-do")).toEqual([
    "To-do",
    "Clear finished",
    "Rotate keys",
    "Result",
    "Rotated",
    "a1 · Thanks",
    "Reply",
    "Follow-up",
    "Agent tasks",
    "No agent tasks",
  ]);
  await press("Reply");
  await type("Write a reply", "Good");
  await press("Send");
  expect(asked).toEqual(["reply p1 Good"]);
});

test("a room's list draws a reply under its task and not as a post of its own", async () => {
  const posts = [
    post(1, { board: "w1", text: "Ship it" }),
    post(2, { board: "w1", kind: "note", state: undefined, replyTo: "p1", text: "Which tag?" }),
    post(3, { board: "w1", kind: "note", state: undefined, text: "Freeze on Friday" }),
  ];
  await mount({ rooms: officeRooms([], { w1: posts }) });

  expect(linesFrom("Posts")).toEqual([
    "Posts",
    "Task · open · user",
    "Ship it",
    "user · Which tag?",
    "Reply",
    "Follow-up",
    "Mark done",
    "Delete",
    "Note · user",
    "Freeze on Friday",
    "Delete",
  ]);
});

/** A lobby task its agent claimed, the copy on the agent's board, and the reply kept under the lobby task. */
function copiedTask(state: "claimed" | "done" = "claimed") {
  const held = { state, claimedBy: "a1" } as const;
  return {
    lobby: [
      post(1, { text: "Rotate keys", ...held, link: "p2" }),
      post(3, { kind: "note", state: undefined, replyTo: "p1", text: "Use the vault" }),
    ],
    w1: [post(2, { board: "w1", text: "Rotate keys", ...held, link: "p1" })],
  };
}

test("a room's list draws a copy's replies, which the host keeps under its lobby task", async () => {
  await mount({ rooms: officeRooms([], copiedTask()) });

  expect(linesFrom("Posts")).toEqual([
    "Posts",
    "Task · claimed by a1 · user · from lobby task p1",
    "Rotate keys",
    "user · Use the vault",
    "Reply",
    "Follow-up",
    "Mark done",
    "Delete",
  ]);
  await press("Reply");
  await type("Write a reply", "And the old ones?");
  await press("Send");
  expect(asked).toEqual(["reply p2 And the old ones?"]);
});

test("a room's Done section draws a done copy's replies too", async () => {
  await mount({ rooms: officeRooms([], copiedTask("done")) });
  await press("Done · 1");
  expect(lines()).toContain("user · Use the vault");
});

test("a room's kanban draws a copy's replies on its card", async () => {
  layouts("list", "kanban");
  await mount({ rooms: officeRooms([], copiedTask()) });

  expect(linesFrom("In progress · 1")).toEqual([
    "In progress · 1",
    "Rotate keys",
    "claimed by a1 · from lobby task p1",
    "user · Use the vault",
    "Reply",
    "Follow-up",
  ]);
});

test("a room's list has no Done section until a task is done", async () => {
  await mount({ rooms: officeRooms([], { w1: [post(1, { board: "w1", text: "Ship it" })] }) });
  expect(container.querySelector('[aria-label="Done · 0"]')).toBeNull();
  expect(lines().some((line) => line.startsWith("Done"))).toBe(false);
});

test("a room's done tasks wait folded under Done, and unfold with their result and replies", async () => {
  const posts = [
    post(1, { board: "w1", text: "Ship it" }),
    post(2, { board: "w1", text: "Tag it", state: "done", result: "Tagged v1.4.2" }),
    post(3, { board: "w1", kind: "note", state: undefined, replyTo: "p2", text: "Thanks" }),
  ];
  await mount({ rooms: officeRooms([], { w1: posts }) });

  expect(byLabel("Done · 1").getAttribute("aria-expanded")).toBe("false");
  expect(linesFrom("Posts")).toEqual([
    "Posts",
    "Task · open · user",
    "Ship it",
    "Reply",
    "Follow-up",
    "Mark done",
    "Delete",
    "Done · 1",
    "Clear finished",
  ]);

  await press("Done · 1");
  expect(byLabel("Done · 1").getAttribute("aria-expanded")).toBe("true");
  expect(linesFrom("Done · 1")).toEqual([
    "Done · 1",
    "Clear finished",
    "Task · done · user",
    "Tag it",
    "Result",
    "Tagged v1.4.2",
    "user · Thanks",
    "Reply",
    "Follow-up",
    "Reopen",
    "Delete",
  ]);
  await press("Reopen");
  expect(asked).toEqual(["reopen p2"]);
});

test("Clear finished under a room's Done asks, then clears the room's done tasks", async () => {
  const posts = [post(2, { board: "w1", state: "done" })];
  await mount({ rooms: officeRooms([], { w1: posts }) });
  await press("Clear finished");
  expect(container.textContent).toContain("Delete 1 finished to-do?");
  await press("Delete");
  expect(asked).toEqual(["clearDone w1"]);
});

test("a room's board as a kanban has a Done column for its done tasks", async () => {
  layouts("list", "kanban");
  const posts = [
    post(1, { board: "w1", text: "Ship it" }),
    post(2, { board: "w1", text: "Tag it", state: "done", result: "Tagged" }),
  ];
  await mount({ rooms: officeRooms([], { w1: posts }) });

  expect(lines()).toContain("Done · 1");
  await press("Done · 1");
  expect(byLabel("Tag it").getAttribute("aria-checked")).toBe("true");
  expect(lines()).toContain("Tagged");
});

test("the lobby as a kanban draws a reply on its task's card, not in Notes", async () => {
  layouts("kanban", "list");
  const todo = post(1, { text: "Rotate keys" });
  const reply = post(2, { kind: "note", state: undefined, replyTo: "p1", text: "Which ones?" });
  await mount({ rooms: lobbyRooms([todo, reply]), roomId: "lobby" });

  expect(lines()).not.toContain("Notes · 1");
  expect(linesFrom("To do · 1")).toEqual([
    "To do · 1",
    "Rotate keys",
    "user · Which ones?",
    "Reply",
    "Follow-up",
    "In progress · 0",
    "Agent tasks",
    "No agent tasks",
  ]);
});

test("a claimed lobby to-do says it is on its claimer's board", async () => {
  const todo = post(1, { text: "Rotate keys", state: "claimed", claimedBy: "a1", link: "p7" });
  await mount({ rooms: lobbyRooms([todo]), roomId: "lobby" });
  expect(lines()).toContain("claimed by a1 · on a1's board");
});

const AT_WORK = [
  agent("1", { title: "Fix the cart", status: "running" }),
  agent("2", { title: "Review the pull request" }),
  agent("3", { title: "Write the docs", status: "running", workspaceId: "w2" }),
  agent("4", { title: "Tidy the lobby", status: "running", workspaceId: null }),
];
const READING = {
  activity: { "1": "Running Bash", "3": "Thinking" },
  checklists: {
    "1": [
      { text: "Run typecheck", status: "in_progress" as const },
      { text: "Commit", status: "pending" as const },
    ],
  },
};

test("a room's board lists the room's agents, what each is at and its unfinished steps", async () => {
  await mount(office(AT_WORK, READING));

  expect(title()).toBe("shop-api board");
  expect(linesFrom("Agents")).toEqual([
    "Agents",
    "Fix the cart",
    "Running Bash",
    "◐ Run typecheck",
    "○ Commit",
    "Review the pull request",
    "Resting",
    "No posts",
  ]);
  // Another room's agents are on their own board.
  expect(lines()).not.toContain("Write the docs");
});

test("a room's board with nobody in the room says so", async () => {
  await mount(office([agent("3", { workspaceId: "w2" })]));
  expect(lines().slice(-2)).toEqual(["No agents", "No posts"]);
});

test("a press on an agent of a board asks for that agent", async () => {
  await mount(office(AT_WORK, READING));
  await press("Fix the cart: Running Bash");
  await press("Review the pull request: Resting");
  expect(selected).toEqual(["1", "2"]);
});

test("an agent's steps are words under its button, so a screen reader reads them too", async () => {
  await mount(office(AT_WORK, READING));
  const button = byLabel("Fix the cart: Running Bash");
  expect(button.textContent).toBe("Fix the cartRunning Bash");
  expect(lines()).toContain("◐ Run typecheck");
});

test("the room's agents follow the office while the board is open", async () => {
  await mount(office(AT_WORK, READING));
  const stopped = AT_WORK.map((each) =>
    each.id === "1" ? { ...each, status: "idle" as const } : each,
  );
  await mount(office(stopped, { checklists: {} }));
  expect(linesFrom("Agents")).toEqual([
    "Agents",
    "Fix the cart",
    "Resting",
    "Review the pull request",
    "Resting",
    "No posts",
  ]);
});

test("agent tasks list who is at work room by room, with each one's steps", async () => {
  await mount({ ...office(AT_WORK, READING), roomId: "lobby" });
  expect(container.textContent).toContain("No to-dos");
  expect(linesFrom("Agent tasks")).toEqual([
    "Agent tasks",
    "Lobby",
    "Tidy the lobby",
    "Working",
    "shop-api",
    "Fix the cart",
    "Running Bash",
    "◐ Run typecheck",
    "○ Commit",
    "landing",
    "Write the docs",
    "Thinking",
  ]);
});

test("agent tasks keep a resting agent while it has steps left, and a line said twice", async () => {
  const steps = [
    { text: "Run tests", status: "pending" as const },
    { text: "Draft the release notes", status: "pending" as const },
    { text: "Run tests", status: "pending" as const },
  ];
  await mount({
    ...office([agent("2", { title: "Review the pull request" })], { checklists: { "2": steps } }),
    roomId: "lobby",
  });
  expect(linesFrom("Agent tasks")).toEqual([
    "Agent tasks",
    "shop-api",
    "Review the pull request",
    "Resting",
    "○ Run tests",
    "○ Draft the release notes",
    "○ Run tests",
  ]);
});

test("agent tasks say there are none when everyone rests with nothing left", async () => {
  await mount({ ...office([agent("2")]), roomId: "lobby" });
  expect(linesFrom("Agent tasks")).toEqual(["Agent tasks", "No agent tasks"]);
});

test("from the lobby's board a room's name opens that room's board, and an agent its card", async () => {
  await mount({ ...office(AT_WORK, READING), roomId: "lobby" });

  await press("Open shop-api board");
  await press("Write the docs: Thinking");
  expect(opened).toEqual(["w1"]);
  expect(selected).toEqual(["3"]);
  // The lobby's own agents are on the board that is open: its name opens nothing.
  expect(container.querySelector('[aria-label="Open Lobby board"]')).toBeNull();
});

test("a room's board opened from the lobby's has a way back to it", async () => {
  await mount({ ...office(AT_WORK, READING), fromLobby: true });

  await press("Back to Lobby board");
  expect(backs).toBe(1);
  expect(closed).toBe(0);
});

test("a room's board opened from elsewhere, and the lobby's own, have no way back", async () => {
  await mount({ ...office(AT_WORK, READING) });
  expect(container.querySelector('[aria-label="Back to Lobby board"]')).toBeNull();

  await mount({ ...office(AT_WORK, READING), roomId: "lobby", fromLobby: true });
  expect(container.querySelector('[aria-label="Back to Lobby board"]')).toBeNull();
});

test("another room's board still shows the posts form", async () => {
  await mount({ rooms: officeRooms([], { w1: [post(1, { board: "w1" })] }) });

  expect(title()).toBe("shop-api board");
  const kinds = byLabel("Kind of post").querySelectorAll('[role="radio"]');
  expect([...kinds].map((chip) => chip.textContent)).toEqual(["Task", "Note"]);
  byLabel("Post");
  expect(container.querySelector('[aria-label="Clear finished"]')).toBeNull();
  expect(container.querySelector('[aria-label="Add a to-do"]')).toBeNull();
  expect(checkboxes()).toEqual([]);
});

test("the lobby as a kanban keeps the form above its columns and Agent tasks under them", async () => {
  layouts("kanban", "list");
  const posts = [
    post(1, { text: "Rotate keys" }),
    post(2, { text: "Check the build", state: "claimed", claimedBy: "a1" }),
    post(3, { text: "Update the README", state: "done" }),
    post(4, { kind: "note", state: undefined, text: "The demo is on Thursday" }),
  ];
  await mount({ rooms: lobbyRooms(posts), roomId: "lobby" });

  byLabel("Add a to-do");
  const all = lines();
  expect(all.indexOf("Any idle agent")).toBeLessThan(all.indexOf("To do · 1"));
  expect(all).not.toContain("To-do");
  // The sheet is narrow until it is measured: the columns stack, Done folded.
  expect(linesFrom("To do · 1")).toEqual([
    "To do · 1",
    "Rotate keys",
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
    "Agent tasks",
    "No agent tasks",
  ]);
  await press("Done · 1");
  expect(byLabel("Update the README").getAttribute("aria-checked")).toBe("true");
});

test("a room's board as a kanban draws its columns under the form and the agents", async () => {
  layouts("list", "kanban");
  const posts = [
    post(1, { board: "w1", text: "Ship it" }),
    post(2, { board: "w1", kind: "note", state: undefined, text: "Freeze on Friday" }),
  ];
  await mount({ rooms: officeRooms([], { w1: posts }) });

  byLabel("Post");
  expect(lines()).not.toContain("Posts");
  expect(linesFrom("No agents")).toEqual([
    "No agents",
    "To do · 1",
    "Ship it",
    "Reply",
    "Follow-up",
    "In progress · 0",
    "Notes · 1",
    "Note · user",
    "Freeze on Friday",
    "Delete",
  ]);
  expect(checkboxes().map((box) => box.getAttribute("aria-label"))).toEqual(["Ship it"]);
});

test("until the device's setting is read the lobby is a kanban and a room's board a list", async () => {
  layoutSetting.current = { status: "loading" };
  await mount({ rooms: lobbyRooms([]), roomId: "lobby" });
  expect(lines()).toContain("To do · 0");
  expect(lines()).not.toContain("To-do");

  await mount({ rooms: officeRooms([], { w1: [post(1, { board: "w1", text: "Ship it" })] }) });
  expect(linesFrom("Posts")).toEqual([
    "Posts",
    "Task · open · user",
    "Ship it",
    "Reply",
    "Follow-up",
    "Mark done",
    "Delete",
  ]);
});

test("in fullscreen the board's dialog opens wide for a kanban and at its own size for a list", async () => {
  // jsdom has no dialog top layer: opening and closing one only sets its attribute.
  const proto = Object.getPrototypeOf(document.createElement("dialog"));
  Object.defineProperties(proto, {
    showModal: {
      configurable: true,
      value() {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value() {
        this.removeAttribute("open");
      },
    },
  });
  const size = () => {
    const dialog = container.querySelector("dialog[open]");
    if (dialog === null) throw new Error("No dialog is open");
    return dialog.getAttribute("data-size");
  };
  const lobby = { rooms: lobbyRooms([]), roomId: "lobby", fullscreen: true };
  const room = { rooms: officeRooms([]), roomId: "w1", fullscreen: true };
  try {
    layouts("kanban", "list");
    await mount(lobby);
    expect(size()).toBe("wide");
    await mount(room);
    expect(size()).toBeNull();

    layouts("list", "kanban");
    await mount(room);
    expect(size()).toBe("wide");
    await mount(lobby);
    expect(size()).toBeNull();
  } finally {
    // The dialog closes before its methods go.
    await mount({ rooms: [], fullscreen: true });
    Reflect.deleteProperty(proto, "showModal");
    Reflect.deleteProperty(proto, "close");
  }
});

const QA = {
  id: "t1",
  name: "QA-PR",
  members: [
    { id: "m1", name: "Ayu" },
    { id: "m2", name: "Budi" },
  ],
};
const OPS = { id: "t2", name: "Ops", members: [{ id: "m3", name: "Citra" }] };

test("with the roster on, the lobby's picker lists the teams right under Any idle agent", async () => {
  const rooms = lobbyRooms([], [agent("2", { title: "Builder" })]);
  await mount({ rooms, roomId: "lobby", teams: [QA, OPS] });
  await press("Send task to: Any idle agent");
  expect(radios()).toEqual([
    "Any idle agent: An available agent picks up the task automatically.",
    "QA-PR: 2 teammates",
    "Ops: 1 teammate",
    "Builder: shop-api · Idle",
  ]);
  expect(container.textContent).toContain("Teams");
});

test("without teams the lobby's picker is as before, and a room's has none", async () => {
  const agents = [agent("2", { title: "Builder" })];
  await mount({ rooms: lobbyRooms([], agents), roomId: "lobby" });
  await press("Send task to: Any idle agent");
  expect(radios()).toEqual([
    "Any idle agent: An available agent picks up the task automatically.",
    "Builder: shop-api · Idle",
  ]);
  expect(container.textContent).not.toContain("Teams");

  await mount({ rooms: officeRooms(agents), roomId: "w1", teams: [QA] });
  await press("Wake an agent with it: Nobody");
  expect(radios().some((label) => label?.startsWith("QA-PR"))).toBe(false);
});

test("choosing a team and adding posts the team and no recipient", async () => {
  await mount({ rooms: lobbyRooms([]), roomId: "lobby", teams: [QA] });
  await type("Add a to-do", "Check the build");
  await press("Send task to: Any idle agent");
  await press("QA-PR: 2 teammates");
  expect(title()).toBe("Lobby board");
  byLabel("Send task to: Team QA-PR");
  await press("Add");

  expect(posted).toEqual([{ board: "lobby", kind: "task", text: "Check the build", team: "t1" }]);
  expect(posted[0]).not.toHaveProperty("to");
  byLabel("Send task to: Any idle agent");
});

test("a team that leaves the roster while the form is open falls back to any idle agent", async () => {
  const rooms = lobbyRooms([]);
  await mount({ rooms, roomId: "lobby", teams: [QA, OPS] });
  await press("Send task to: Any idle agent");
  await press("QA-PR: 2 teammates");
  byLabel("Send task to: Team QA-PR");

  await mount({ rooms, roomId: "lobby", teams: [OPS] });
  byLabel("Send task to: Any idle agent");
  await type("Add a to-do", "Check the build");
  await press("Add");
  expect(posted).toEqual([{ board: "lobby", kind: "task", text: "Check the build" }]);
});

test("a team task says which team it is for, by name and by id once the team is gone", async () => {
  const task = post(1, { text: "Rotate keys", team: "t1" });
  await mount({ rooms: lobbyRooms([task]), roomId: "lobby", teams: [QA] });
  expect(container.textContent).toContain("for team QA-PR");
  await mount({ rooms: lobbyRooms([task]), roomId: "lobby", teams: [] });
  expect(container.textContent).toContain("for team t1");
  layouts("kanban", "list");
  await mount({ rooms: lobbyRooms([task]), roomId: "lobby", teams: [QA] });
  expect(container.textContent).toContain("for team QA-PR");
});

/** The lobby's tasks p1..p`count`, for a Follow-up on each. */
const lobbyTasks = (count: number) =>
  Array.from({ length: count }, (_, i) => post(i + 1, { text: `Task ${i + 1}` }));

test("Follow-up on a lobby task sets the form's After and focuses the field", async () => {
  await mount({ rooms: lobbyRooms([post(12, { text: "Build the API" })]), roomId: "lobby" });
  expect(container.textContent).not.toContain("After p12");
  await press("Follow-up: Build the API");
  expect(container.textContent).toContain("After p12");
  expect(document.activeElement).toBe(byLabel("Add a to-do"));
});

test("Follow-up adds to the pending After once each, and Clear removes it", async () => {
  await mount({ rooms: lobbyRooms(lobbyTasks(3)), roomId: "lobby" });
  await press("Follow-up: Task 1");
  await press("Follow-up: Task 3");
  await press("Follow-up: Task 1");
  expect(container.textContent).toContain("After p1, p3");
  await press("Clear");
  expect(container.textContent).not.toContain("After p1");
  await type("Add a to-do", "Plain");
  await press("Add");
  expect(posted).toEqual([{ board: "lobby", kind: "task", text: "Plain" }]);
});

test("adding a follow-up posts the task with its after, and the After is clear once it is added", async () => {
  await mount({ rooms: lobbyRooms(lobbyTasks(2)), roomId: "lobby" });
  await press("Follow-up: Task 1");
  await press("Follow-up: Task 2");
  await type("Add a to-do", "Then this");
  await press("Add");
  expect(posted).toEqual([
    { board: "lobby", kind: "task", text: "Then this", after: ["p1", "p2"] },
  ]);
  expect(container.textContent).not.toContain("After p1");
});

test("a refused follow-up keeps its After for another try", async () => {
  await mount({ rooms: lobbyRooms(lobbyTasks(1)), roomId: "lobby" });
  await press("Follow-up: Task 1");
  await type("Add a to-do", "Then this");
  refusal = new Error("No");
  await press("Add");
  expect(container.textContent).toContain("After p1");
});

test("a task waits on at most 5 tasks: the sixth Follow-up does nothing and the form says so", async () => {
  await mount({ rooms: lobbyRooms(lobbyTasks(6)), roomId: "lobby" });
  for (let n = 1; n <= 5; n += 1) await press(`Follow-up: Task ${n}`);
  expect(container.textContent).not.toContain("A task waits on at most 5 tasks");
  await press("Follow-up: Task 6");
  expect(container.textContent).toContain("A task waits on at most 5 tasks");
  expect(container.textContent).toContain("After p1, p2, p3, p4, p5");
  expect(container.textContent).not.toContain("p6,");
  await press("Clear");
  expect(container.textContent).not.toContain("A task waits on at most 5 tasks");
});

test("a task that leaves the boards is dropped from the pending After", async () => {
  const tasks = lobbyTasks(2);
  await mount({ rooms: lobbyRooms(tasks), roomId: "lobby" });
  await press("Follow-up: Task 1");
  await press("Follow-up: Task 2");
  expect(container.textContent).toContain("After p1, p2");
  await mount({ rooms: lobbyRooms([tasks[1] as Post]), roomId: "lobby" });
  expect(container.textContent).toContain("After p2");
  expect(container.textContent).not.toContain("After p1");
  await type("Add a to-do", "Then this");
  await press("Add");
  expect(posted).toEqual([{ board: "lobby", kind: "task", text: "Then this", after: ["p2"] }]);
});

test("the lobby's kanban has Follow-up on its cards and puts a waiting task in Waiting", async () => {
  layouts("kanban", "list");
  const first = post(1, { text: "Build the API" });
  const second = post(2, { text: "Write the docs", after: ["p1"] });
  await mount({ rooms: lobbyRooms([first, second]), roomId: "lobby" });
  expect(container.textContent).toContain("Waiting · 1");
  expect(container.textContent).toContain("Waiting on p1");
  await press("Follow-up: Build the API");
  expect(container.textContent).toContain("After p1");
});

test("a task waits on a task of another board: the room's board judges by every board's posts", async () => {
  const prerequisite = post(1, { text: "Build the API" });
  const waits = post(2, { board: "w1", text: "Write the docs", after: ["p1"] });
  const rooms = officeRooms([], { lobby: [prerequisite], w1: [waits] });
  await mount({ rooms, roomId: "w1" });
  expect(container.textContent).toContain("Waiting on p1");
});

test("a task that waits on a duty is Waiting on the lobby's kanban and says so on a room's list", async () => {
  const duty = post(1, {
    board: "duty",
    text: "Build",
    state: "claimed",
    claimedBy: "a1",
    duty: { id: "build", day: "2026-11-17" },
  });
  const duties: DutyRow[] = [{ post: duty, duty: null, owed: false, replies: [] }];
  const rooms = officeRooms([], {
    lobby: [post(2, { text: "Review the build", after: ["p1"] })],
    w1: [post(3, { board: "w1", text: "Write the notes", after: ["p1"] })],
  });
  layouts("kanban", "list");
  await mount({ rooms, roomId: "lobby", duties });
  expect(lines()).toContain("Waiting · 1");
  expect(lines()).toContain("Waiting on p1");
  await mount({ rooms, roomId: "w1", duties });
  expect(lines()).toContain("Waiting on p1");
});

test("a room's board has Follow-up too: it makes the post a task after that one", async () => {
  const here = post(5, { board: "w1", text: "Fix the build", kind: "task" });
  await mount({ rooms: officeRooms([], { w1: [here] }), roomId: "w1" });
  await press("Follow-up: Fix the build");
  expect(container.textContent).toContain("After p5");
  await type("Task text", "Then deploy");
  await press("Post");
  expect(posted).toEqual([{ board: "w1", kind: "task", text: "Then deploy", after: ["p5"] }]);
  expect(container.textContent).not.toContain("After p5");
});

/** The kind chip of a room's form with this text: "Task" or "Note". */
async function chooseKind(kind: string): Promise<void> {
  const chip = [...byLabel("Kind of post").querySelectorAll<HTMLElement>('[role="radio"]')].find(
    (item) => item.textContent === kind,
  );
  if (!chip) throw new Error(`No kind chip says "${kind}"`);
  await act(async () => chip.click());
  await settle();
}

test("in a room's form Follow-up while on Note switches the form to Task", async () => {
  const here = post(5, { board: "w1", text: "Fix the build" });
  await mount({ rooms: officeRooms([], { w1: [here] }), roomId: "w1" });
  await chooseKind("Note");
  expect(container.querySelector('[aria-label="Note text"]')).not.toBeNull();
  await press("Follow-up: Fix the build");
  expect(container.querySelector('[aria-label="Task text"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Note text"]')).toBeNull();
  expect(container.textContent).toContain("After p5");
});

test("a room's Note carries no follow-up and hides the line, which comes back with Task", async () => {
  const here = post(5, { board: "w1", text: "Fix the build" });
  await mount({ rooms: officeRooms([], { w1: [here] }), roomId: "w1" });
  await press("Follow-up: Fix the build");
  await chooseKind("Note");
  expect(container.textContent).not.toContain("After p5");
  await type("Note text", "Remember this");
  await press("Post");
  expect(posted).toEqual([{ board: "w1", kind: "note", text: "Remember this" }]);
  expect(posted[0]).not.toHaveProperty("after");
  await chooseKind("Task");
  expect(container.textContent).toContain("After p5");
});

describe("the lobby's backlog", () => {
  const held = (seq: number, fields: Partial<Post> = {}) =>
    post(seq, { text: `Held ${seq}`, backlog: true, ...fields });

  test("the list folds held tasks in Backlog above the to-dos, which do not list them", async () => {
    await mount({
      rooms: lobbyRooms([held(1), post(2, { text: "Rotate keys" }), held(3)]),
      roomId: "lobby",
    });
    expect(byLabel("Backlog · 2").getAttribute("aria-expanded")).toBe("false");
    const shown = lines();
    expect(shown.indexOf("Backlog · 2")).toBeLessThan(shown.indexOf("To-do"));
    expect(shown).not.toContain("Held 1");
    expect(checkboxes().map((box) => box.getAttribute("aria-label"))).toEqual(["Rotate keys"]);

    await press("Backlog · 2");
    expect(byLabel("Backlog · 2").getAttribute("aria-expanded")).toBe("true");
    expect(checkboxes().map((box) => box.getAttribute("aria-label"))).toEqual([
      "Held 1",
      "Held 3",
      "Rotate keys",
    ]);
    expect(linesFrom("Backlog · 2").slice(0, 6)).toEqual([
      "Backlog · 2",
      "Held 1",
      "Start",
      "Reply",
      "Follow-up",
      "Held 3",
    ]);
    await press("Start task: Held 3");
    expect(asked).toEqual(["start p3"]);
  });

  test("the list has no Backlog section without held tasks, and a done one is not held", async () => {
    await mount({
      rooms: lobbyRooms([post(1, { text: "Rotate keys" }), held(2, { state: "done" })]),
      roomId: "lobby",
    });
    expect(lines().some((line) => line.startsWith("Backlog"))).toBe(false);
    expect(checkboxes()).toHaveLength(2);
  });

  test("the kanban has the Backlog column", async () => {
    layouts("kanban", "list");
    await mount({ rooms: lobbyRooms([held(1)]), roomId: "lobby" });
    byLabel("Backlog · 1");
  });

  test("Add to backlog posts what Add would, with backlog, and resets the form", async () => {
    const agents = [agent("2", { title: "Builder", workspaceId: null })];
    await mount({ rooms: lobbyRooms(lobbyTasks(1), agents), roomId: "lobby", teams: [QA] });
    expect(isOff("Add to backlog")).toBe(true);
    await type("Add a to-do", "   ");
    expect(isOff("Add to backlog")).toBe(true);

    await type("Add a to-do", "Later");
    expect(isOff("Add to backlog")).toBe(false);
    await press("Add to backlog");
    expect(posted).toEqual([{ board: "lobby", kind: "task", text: "Later", backlog: true }]);
    expect(fieldText("Add a to-do")).toBe("");

    await press("Follow-up: Task 1");
    await type("Add a to-do", "Then later");
    await press("Send task to: Any idle agent");
    await press("QA-PR: 2 teammates");
    await press("Add to backlog");
    expect(posted[1]).toEqual({
      board: "lobby",
      kind: "task",
      text: "Then later",
      team: "t1",
      after: ["p1"],
      backlog: true,
    });
    expect(container.textContent).not.toContain("After p1");
    byLabel("Send task to: Any idle agent");

    await type("Add a to-do", "For Builder");
    await press("Send task to: Any idle agent");
    await press("Builder: Lobby · Idle");
    await press("Add to backlog");
    expect(posted[2]).toEqual({
      board: "lobby",
      kind: "task",
      text: "For Builder",
      to: "2",
      backlog: true,
    });
  });

  test("Enter in the field still adds, without backlog", async () => {
    await mount({ rooms: lobbyRooms([]), roomId: "lobby" });
    await type("Add a to-do", "Now");
    await enter("Add a to-do");
    expect(posted).toEqual([{ board: "lobby", kind: "task", text: "Now" }]);
  });

  test("a refused Add to backlog keeps the text and says why", async () => {
    refusal = new Error("Unable to add: the board is full");
    await mount({ rooms: lobbyRooms([]), roomId: "lobby" });
    await type("Add a to-do", "Later");
    await press("Add to backlog");
    expect(container.textContent).toContain("Unable to add: the board is full");
    expect(fieldText("Add a to-do")).toBe("Later");
  });

  test("a room's form has no Add to backlog", async () => {
    await mount({ rooms: officeRooms([]), roomId: "w1" });
    expect(container.querySelector('[aria-label="Add to backlog"]')).toBeNull();
  });
});
