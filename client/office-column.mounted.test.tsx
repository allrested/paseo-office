/**
 * @vitest-environment jsdom
 */
// The column, mounted with a stand-in for the device's setting: its tabs, its badges, its rail.
import { act, createElement, useCallback, useMemo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Pressable, Text } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { officeColumnSettings } from "../shared/settings.js";
import { OfficeColumn } from "./office-column.js";
import { stockSave } from "./stock-save.test.js";
import { useOfficeStyles } from "./styles.js";
import { useColumn } from "./use-column.js";

let saves: unknown[];
/** What the column said of its drag, in order. */
let dragging: boolean[];
let storedColumn: { width: number; collapsed: boolean };

vi.mock("@getpaseo/plugin/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@getpaseo/plugin/client")>()),
  useSettings: () => ({
    status: "ready",
    revision: "r1",
    values: storedColumn,
    saving: false,
    saveError: null,
    save: async (values: unknown) => {
      saves.push(values);
      return stockSave(officeColumnSettings)(values);
    },
    reset: async () => true,
    reload: async () => undefined,
  }),
}));

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { View } = await import("react-native");
  const Icon = (props: { name: string }) => createElement(View, { testID: `icon-${props.name}` });
  return { Icon };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
let container: HTMLElement;

function recordDrag(next: boolean): void {
  dragging.push(next);
}
let root: Root;

const TITLES: Record<string, string> = { a: "Alpha work", b: "Beta work" };

function Harness({ chat, compact }: { chat: string | null; compact: boolean }): ReactNode {
  const styles = useOfficeStyles(THEME, false, false);
  const column = useColumn(compact);
  const badges = useMemo(() => ({ attention: "2", chat }), [chat]);
  const sessions = useMemo(
    () =>
      column.sessions.map((agentId) => ({
        agentId,
        title: TITLES[agentId] ?? agentId,
        tone: "running" as const,
      })),
    [column.sessions],
  );
  const { view, openSession } = column;
  const openA = useCallback(() => openSession("a"), [openSession]);
  const openB = useCallback(() => openSession("b"), [openSession]);
  return (
    <>
      <Pressable accessibilityLabel="open a" onPress={openA} />
      <Pressable accessibilityLabel="open b" onPress={openB} />
      <Text>{`chosen:${view.kind === "tab" ? view.tab : `session:${view.agentId}`}`}</Text>
      <OfficeColumn
        column={column}
        sessions={sessions}
        touch={false}
        surfaceWidth={1280}
        badges={badges}
        color="#000000"
        iconSize={16}
        onDragging={recordDrag}
        styles={styles}
      >
        <Text>{`panel:${view.kind === "tab" ? view.tab : `session:${view.agentId}`}`}</Text>
      </OfficeColumn>
    </>
  );
}

async function mount(chat: string | null = null, compact = false): Promise<void> {
  await act(async () => root.render(createElement(Harness, { chat, compact })));
}

function tab(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[role="tab"][aria-label^="${label}"]`);
  if (!found) throw new Error(`No tab is labelled "${label}"`);
  return found;
}

function control(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`Nothing is labelled "${label}"`);
  return found;
}

const tabLabels = () =>
  [...container.querySelectorAll('[role="tab"]')].map((each) => each.getAttribute("aria-label"));

beforeEach(() => {
  saves = [];
  dragging = [];
  storedColumn = { width: 360, collapsed: false };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("the column opens on Sessions, with four tabs in order", async () => {
  await mount();

  const labels = [...container.querySelectorAll('[role="tab"]')].map((each) =>
    each.getAttribute("aria-label"),
  );
  expect(labels).toEqual(["Attention, 2 new", "Sessions", "Activity", "Chat"]);
  expect(tab("Sessions").getAttribute("aria-selected")).toBe("true");
  expect(container.textContent).toContain("panel:sessions");
});

test("a tab press shows that tab's panel and saves nothing", async () => {
  await mount();
  await act(async () => tab("Activity").click());

  expect(tab("Activity").getAttribute("aria-selected")).toBe("true");
  expect(container.textContent).toContain("panel:activity");
  expect(saves).toEqual([]);
});

test("Chat carries its count in its name", async () => {
  await mount("3");
  expect(tab("Chat").getAttribute("aria-label")).toBe("Chat, 3 new");
});

test("Collapse leaves the rail and saves it; a rail press opens that tab again", async () => {
  await mount();
  const collapse = container.querySelector<HTMLElement>('[aria-label="Collapse the column"]');
  if (!collapse) throw new Error("There is no Collapse button");
  await act(async () => collapse.click());

  expect(container.textContent).not.toContain("panel:");
  expect(saves).toEqual([{ width: 360, collapsed: true }]);

  await act(async () => tab("Chat").click());
  expect(container.textContent).toContain("panel:chat");
  expect(saves).toEqual([
    { width: 360, collapsed: true },
    { width: 360, collapsed: false },
  ]);
});

test("a device that left the column collapsed opens the office on the rail", async () => {
  storedColumn = { width: 400, collapsed: true };
  await mount();

  expect(container.textContent).not.toContain("panel:");
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4);
});

test("a drag of the handle says when it starts and when it ends", async () => {
  await mount();
  const handle = container.querySelector<HTMLElement>('[aria-label="Drag to resize the column"]');
  if (!handle) throw new Error("There is no handle");

  // The responder events react-native-web listens for: a press on the handle, a release anywhere.
  await act(async () => {
    handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  });
  expect(dragging).toEqual([true]);

  await act(async () => {
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  });
  expect(dragging).toEqual([true, false]);
});

test("opening a session adds its tab after the four, chosen, with its panel", async () => {
  await mount();
  await act(async () => control("open a").click());
  await act(async () => control("open b").click());

  expect(tabLabels()).toEqual([
    "Attention, 2 new",
    "Sessions",
    "Activity",
    "Chat",
    "Alpha work",
    "Beta work",
  ]);
  expect(tab("Beta work").getAttribute("aria-selected")).toBe("true");
  expect(tab("Sessions").getAttribute("aria-selected")).toBe("false");
  expect(container.textContent).toContain("panel:session:b");
});

test("a fixed tab's press leaves the session's tab where it is", async () => {
  await mount();
  await act(async () => control("open a").click());
  await act(async () => tab("Activity").click());

  expect(container.textContent).toContain("panel:activity");
  expect(tab("Alpha work").getAttribute("aria-selected")).toBe("false");
  await act(async () => tab("Alpha work").click());
  expect(container.textContent).toContain("panel:session:a");
});

test("Close removes the session's tab and shows the tab to its left", async () => {
  await mount();
  await act(async () => control("open a").click());
  await act(async () => control("open b").click());
  await act(async () => control("Close Beta work").click());
  expect(tabLabels()).toEqual(["Attention, 2 new", "Sessions", "Activity", "Chat", "Alpha work"]);
  expect(container.textContent).toContain("panel:session:a");

  await act(async () => control("Close Alpha work").click());
  expect(tab("Sessions").getAttribute("aria-selected")).toBe("true");
  expect(container.textContent).toContain("panel:sessions");
});

test("the rail counts the open sessions on Sessions, and a press opens the column on it", async () => {
  await mount();
  await act(async () => control("open a").click());
  await act(async () => control("open b").click());
  await act(async () => control("Collapse the column").click());

  expect(tabLabels()).toEqual(["Attention, 2 new", "Sessions, 2 open", "Activity", "Chat"]);
  await act(async () => tab("Sessions").click());
  expect(container.textContent).toContain("panel:sessions");
  expect(tab("Alpha work")).toBeTruthy();
});

test("opening a session opens a collapsed column", async () => {
  storedColumn = { width: 360, collapsed: true };
  await mount();
  await act(async () => control("open a").click());

  expect(container.textContent).toContain("panel:session:a");
  expect(saves).toEqual([{ width: 360, collapsed: false }]);
});

test("on a compact surface a session or a fixed tab opens without rewriting the saved column", async () => {
  storedColumn = { width: 360, collapsed: true };
  await mount(null, true);
  await act(async () => control("open a").click());
  expect(container.textContent).toContain("chosen:session:a");
  await act(async () => tab("Chat").click());
  expect(container.textContent).toContain("chosen:chat");

  expect(saves).toEqual([]);
  expect(storedColumn.collapsed).toBe(true);
});

/** What a session tab's close button's opacity says: "0" while it is hidden. */
function closeOpacity(label: string): string {
  return getComputedStyle(control(label)).opacity;
}

test("a hidden close button shows once the keyboard reaches it", async () => {
  await mount();
  await act(async () => control("open a").click());
  await act(async () => control("open b").click());
  // Alpha is not chosen and not hovered: its close button is out of sight.
  expect(closeOpacity("Close Alpha work")).toBe("0");

  await act(async () => control("Close Alpha work").focus());
  expect(closeOpacity("Close Alpha work")).not.toBe("0");

  await act(async () => control("Close Alpha work").blur());
  expect(closeOpacity("Close Alpha work")).toBe("0");
});
