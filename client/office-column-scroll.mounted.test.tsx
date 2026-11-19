/**
 * @vitest-environment jsdom
 */
// The column's session tabs scroll sideways. The host's scroller and Views are stand-ins that keep
// what the column asked of them and let the test report the sizes jsdom cannot measure.
import {
  act,
  createElement,
  forwardRef,
  useImperativeHandle,
  useMemo,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LayoutChangeEvent, ScrollViewProps, ViewProps } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { OfficeColumn } from "./office-column.js";
import { useOfficeStyles } from "./styles.js";
import type { ColumnState } from "./use-column.js";

const seen = vi.hoisted(() => ({
  scrollTo: [] as unknown[],
  scroller: null as null | Record<string, unknown>,
  /** The onLayout of each View that has one, in draw order: the session tabs'. */
  tabs: [] as ((event: LayoutChangeEvent) => void)[],
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const ScrollView = forwardRef<unknown, ScrollViewProps & { children?: ReactNode }>(
    (props, ref) => {
      useImperativeHandle(ref, () => ({ scrollTo: (to: unknown) => seen.scrollTo.push(to) }));
      seen.scroller = props as unknown as Record<string, unknown>;
      return createElement(actual.View, null, props.children);
    },
  );
  const View = (props: ViewProps) => {
    if (props.onLayout) seen.tabs.push(props.onLayout);
    return createElement(actual.View, props);
  };
  return { ...actual, ScrollView, View };
});

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { View } = await import("react-native");
  return { Icon: () => createElement(View) };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const SESSIONS = ["a", "b", "c"].map((agentId) => ({
  agentId,
  title: `Agent ${agentId}`,
  tone: "idle" as const,
}));

let container: HTMLElement;
let root: Root;

const BADGES = { attention: null, chat: null };
const noop = () => undefined;

function column(shown: string): ColumnState {
  return {
    view: { kind: "session", agentId: shown },
    sessions: SESSIONS.map((each) => each.agentId),
    width: 360,
    collapsed: false,
    show: () => undefined,
    openSession: () => undefined,
    closeSession: () => undefined,
    setCollapsed: () => undefined,
    setWidth: () => undefined,
  };
}

function Harness({ shown, touch }: { shown: string; touch: boolean }) {
  const styles = useOfficeStyles(THEME, false, false);
  const state = useMemo(() => column(shown), [shown]);
  return (
    <OfficeColumn
      column={state}
      sessions={SESSIONS}
      touch={touch}
      surfaceWidth={1280}
      badges={BADGES}
      color="#000000"
      iconSize={16}
      onDragging={noop}
      styles={styles}
    >
      {null}
    </OfficeColumn>
  );
}
const draw = (shown: string, touch = false) =>
  act(async () => root.render(createElement(Harness, { shown, touch })));

const layout = (x: number, width: number, height = 30) =>
  ({ nativeEvent: { layout: { x, y: 0, width, height } } }) as LayoutChangeEvent;
const report = (
  handler: ((event: LayoutChangeEvent) => void) | undefined,
  x: number,
  width = 100,
) => act(async () => handler?.(layout(x, width)));

beforeEach(() => {
  seen.scrollTo = [];
  seen.tabs = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("the sideways scroll shows its bar where a mouse is the way to reach a tab, not on touch", async () => {
  await draw("a", false);
  expect(seen.scroller?.showsHorizontalScrollIndicator).toBe(true);
  await draw("a", true);
  expect(seen.scroller?.showsHorizontalScrollIndicator).toBe(false);
});

test("a tab that is shown but past the edge is scrolled to its own x; one in view is left alone", async () => {
  await draw("c");
  const [tabA, tabB, tabC] = seen.tabs.slice(-3);
  // The strip is 200 wide; the three tabs are 100 each.
  await report(seen.scroller?.onLayout as never, 0, 200);
  await report(tabA, 0);
  await report(tabB, 100);
  await report(tabC, 200);
  expect(seen.scrollTo).toEqual([{ x: 200, animated: true }]);

  // The strip is at the end now; showing the first tab brings it back, and a visible one stays.
  await act(async () =>
    (seen.scroller!.onScroll as (e: unknown) => void)({
      nativeEvent: { contentOffset: { x: 100, y: 0 } },
    }),
  );
  await draw("b");
  expect(seen.scrollTo).toHaveLength(1);
  await draw("a");
  expect(seen.scrollTo).toEqual([
    { x: 200, animated: true },
    { x: 0, animated: true },
  ]);
});
