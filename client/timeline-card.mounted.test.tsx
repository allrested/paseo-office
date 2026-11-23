/**
 * @vitest-environment jsdom
 */
// The Timeline card, mounted: it asks the host for the chosen range, draws a lane per agent, and
// a replay moves its head from the start of the range at the chosen speed.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Timeline } from "../shared/timeline.js";
import { TimelineCard } from "./timeline-card.js";
import { useOfficeStyles } from "./styles.js";

const MIN = 60_000;
const NOW = Date.parse("2026-11-23T12:00:00.000Z");

const rpc = vi.hoisted(() => ({ timeline: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => rpc.timeline }));
vi.mock("@getpaseo/plugin/client/ui", () => {
  const Modal = (props: { title: string; open: boolean; children: ReactNode }) =>
    props.open ? createElement("section", { "aria-label": props.title }, props.children) : null;
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  return { Modal, Icon: () => null };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

function timelineOf(from: number, to: number): Timeline {
  return {
    from,
    to,
    lanes: [
      {
        id: "a",
        name: "Builder",
        team: "shop-api",
        provider: "claude",
        spans: [
          { from, to: from + 30 * MIN, state: "work" },
          { from: from + 30 * MIN, to, state: "rest" },
        ],
        steps: [{ at: from + 10 * MIN, kind: "edit" }],
        edits: 3,
        commands: 2,
        costUsd: 0.75,
      },
    ],
  };
}

let container: HTMLElement;
let root: Root;
const onClose = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  onClose.mockClear();
  rpc.timeline
    .mockReset()
    .mockImplementation(async ({ from, to }: { from: number; to: number }) => ({
      ok: true,
      timeline: timelineOf(from, to),
    }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function Card({ open = true }: { open?: boolean }) {
  const styles = useOfficeStyles(THEME, false, false);
  return <TimelineCard open={open} styles={styles} onClose={onClose} />;
}
const show = () => act(async () => root.render(<Card />));
const press = (label: string) =>
  act(async () => {
    container.querySelector<HTMLElement>(`button[aria-label="${label}"]`)!.click();
  });
const lane = () => container.querySelector('[aria-label^="Builder"]')!.getAttribute("aria-label");

test("the last hour is asked for and drawn as a lane that says what its agent is at now", async () => {
  await show();
  expect(rpc.timeline).toHaveBeenCalledWith({ from: NOW - 60 * MIN, to: NOW });
  expect(lane()).toBe("Builder, shop-api: resting");
  // Closed, it asks for nothing.
  rpc.timeline.mockClear();
  await act(async () => root.render(<Card open={false} />));
  expect(container.textContent).toBe("");
  expect(rpc.timeline).not.toHaveBeenCalled();
});

test("a replay starts at the range's start and moves at the chosen speed to its end", async () => {
  await show();
  await press("Replay");
  expect(lane()).toBe("Builder, shop-api: at work");
  // 10 s at 60 times the clock is 10 minutes: at the edit.
  await act(async () => vi.advanceTimersByTime(10_000));
  expect(lane()).toBe("Builder, shop-api: editing");
  await press("Pause");
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(lane()).toBe("Builder, shop-api: editing");
  await press("120 times the clock");
  await press("Resume");
  // The 50 minutes left take 25 s at 120 times; then it stops at the end.
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(container.querySelector('button[aria-label="Replay"]')).not.toBeNull();
  await press("Now");
  expect(lane()).toBe("Builder, shop-api: resting");
});

test("This week asks for seven days and shows the figures", async () => {
  await show();
  await press("This week");
  expect(rpc.timeline).toHaveBeenLastCalledWith({ from: NOW - 7 * 24 * 60 * MIN, to: NOW });
  const figures = [...container.querySelectorAll("[aria-label]")].map((node) =>
    node.getAttribute("aria-label"),
  );
  expect(figures).toEqual(
    expect.arrayContaining([
      "At work: 30 min",
      "Turns: 1",
      "Edits: 3",
      "Commands: 2",
      "Cost: $0.75",
      "Busiest team: shop-api",
    ]),
  );
});

test("a host that cannot read the timeline says why", async () => {
  rpc.timeline.mockResolvedValue({ ok: false, problem: "The timeline cannot be read" });
  await show();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    "The timeline cannot be read",
  );
});
