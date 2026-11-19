/**
 * @vitest-environment jsdom
 */
// The phone's column: a bar of the tabs under the floor and a sheet over it.
import { act, createElement, useCallback, useMemo, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Pressable, Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ColumnTab, ColumnView } from "./column-model.js";
import { ColumnBar, ColumnSheet } from "./column-sheet.js";
import { useOfficeStyles } from "./styles.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { View: Glyph } = await import("react-native");
  const Icon = (props: { name: string }) => createElement(Glyph, { testID: `icon-${props.name}` });
  return { Icon };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
let container: HTMLElement;
let root: Root;

const BADGES = { attention: "1", chat: null };
const FLOOR = <Text>floor</Text>;

function Harness(): ReactNode {
  const styles = useOfficeStyles(THEME, true, true);
  const [open, setOpen] = useState<ColumnView | null>(null);
  const [sessions, setSessions] = useState<readonly string[]>([]);
  const close = useCallback(() => setOpen(null), []);
  const openTab = useCallback((next: ColumnTab) => setOpen({ kind: "tab", tab: next }), []);
  const openOne = useCallback(() => {
    setSessions(["a"]);
    setOpen({ kind: "session", agentId: "a" });
  }, []);
  const back = useCallback(() => setOpen({ kind: "tab", tab: "sessions" }), []);
  const closeOne = useCallback(() => {
    setSessions([]);
    setOpen({ kind: "tab", tab: "sessions" });
  }, []);
  const shown = useMemo(
    () =>
      sessions.map((agentId) => ({
        agentId,
        title: "Alpha work",
        tone: "idle" as const,
      })),
    [sessions],
  );
  const panel = open?.kind === "session" ? `session:${open.agentId}` : open?.tab;
  // As the surface draws them: the sheet in the floor's box, after the floor, and the bar under it.
  return (
    <>
      <Pressable accessibilityLabel="open a" onPress={openOne} />
      <View style={styles.floor}>
        {FLOOR}
        <ColumnSheet
          open={open}
          sessionTitle={shown[0]?.title ?? null}
          color="#000000"
          iconSize={20}
          platform="web"
          onClose={close}
          onBack={back}
          onCloseSession={closeOne}
          styles={styles}
        >
          <Text>{`panel:${panel}`}</Text>
        </ColumnSheet>
      </View>
      <ColumnBar
        open={open}
        sessions={shown}
        badges={BADGES}
        color="#000000"
        iconSize={20}
        onOpen={openTab}
        onClose={close}
        styles={styles}
      />
    </>
  );
}

const mount = () => act(async () => root.render(<Harness />));

function tab(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[role="tab"][aria-label^="${label}"]`);
  if (!found) throw new Error(`No tab is labelled "${label}"`);
  return found;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("closed, there is the bar of four tabs and no sheet", async () => {
  await mount();

  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4);
  expect(tab("Attention").getAttribute("aria-label")).toBe("Attention, 1 new");
  expect(container.textContent).not.toContain("panel:");
});

test("a bar press opens the sheet on that tab, and another tab changes it", async () => {
  await mount();
  await act(async () => tab("Chat").click());
  expect(container.textContent).toContain("panel:chat");
  expect(tab("Chat").getAttribute("aria-selected")).toBe("true");

  await act(async () => tab("Sessions").click());
  expect(container.textContent).toContain("panel:sessions");
});

test("Close, a press on the floor above the sheet, and Escape each close it", async () => {
  await mount();
  for (const close of [
    () => container.querySelector<HTMLElement>('[aria-label="Close"]')?.click(),
    () => container.querySelector<HTMLElement>('[aria-label="Close the column"]')?.click(),
    () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  ]) {
    await act(async () => tab("Activity").click());
    expect(container.textContent).toContain("panel:activity");
    await act(async () => close());
    expect(container.textContent).not.toContain("panel:");
  }
});

test("the open tab's press closes the sheet", async () => {
  await mount();
  await act(async () => tab("Activity").click());
  await act(async () => tab("Activity").click());
  expect(container.textContent).not.toContain("panel:");
});

test("a session in the sheet has its title, a way back to Sessions, and Close", async () => {
  await mount();
  await act(async () => container.querySelector<HTMLElement>('[aria-label="open a"]')?.click());

  const head = container.querySelector('[role="heading"]');
  expect(head?.textContent).toBe("Alpha work");
  expect(container.textContent).toContain("panel:session:a");
  expect(tab("Sessions").getAttribute("aria-label")).toBe("Sessions, 1 open");
  expect(container.querySelector('[role="tab"][aria-selected="true"]')).toBeNull();

  await act(async () =>
    container.querySelector<HTMLElement>('[aria-label="Back to Sessions"]')?.click(),
  );
  expect(container.textContent).toContain("panel:sessions");
  expect(tab("Sessions").getAttribute("aria-selected")).toBe("true");
});

test("Close in a session's header removes the session and shows Sessions", async () => {
  await mount();
  await act(async () => container.querySelector<HTMLElement>('[aria-label="open a"]')?.click());
  await act(async () =>
    container.querySelector<HTMLElement>('[aria-label="Close Alpha work"]')?.click(),
  );

  expect(container.textContent).toContain("panel:sessions");
  expect(tab("Sessions").getAttribute("aria-label")).toBe("Sessions");
});

test("a bar press on Sessions while a session shows goes to Sessions, not closed", async () => {
  await mount();
  await act(async () => container.querySelector<HTMLElement>('[aria-label="open a"]')?.click());
  await act(async () => tab("Sessions").click());

  expect(container.textContent).toContain("panel:sessions");
});
