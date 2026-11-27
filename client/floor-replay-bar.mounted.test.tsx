/**
 * @vitest-environment jsdom
 */
// The replay's bar, mounted over a stand-in replay: what it says and what each control asks for.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useOfficeStyles } from "./styles.js";
import { FloorReplayBar, SKIP_MS, type FloorReplay } from "./use-floor-replay.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const NOW = new Date(2026, 10, 27, 12, 40, 0).getTime();
const FROM = new Date(2026, 10, 26, 12, 40, 0).getTime();

function replayOf(patch: Partial<FloorReplay> = {}): FloorReplay {
  return {
    model: null,
    head: new Date(2026, 10, 26, 13, 43, 5).getTime(),
    from: FROM,
    to: NOW,
    speed: 30,
    paused: false,
    seen: 2,
    start: undefined,
    shown: (today) => today,
    toggle: vi.fn(),
    setSpeed: vi.fn(),
    seek: vi.fn(),
    skip: vi.fn(),
    stop: vi.fn(),
    ...patch,
  };
}

function Bar({ replay }: { replay: FloorReplay }) {
  const styles = useOfficeStyles(THEME, false, false);
  return createElement(FloorReplayBar, { replay, now: NOW, styles });
}

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const draw = (replay: FloorReplay) => act(async () => root.render(createElement(Bar, { replay })));
const press = (label: string) =>
  act(async () => container.querySelector<HTMLElement>(`[aria-label="${label}"]`)!.click());

test("the bar says which day and time the floor shows, and who was there", async () => {
  await draw(replayOf());
  const text = container.textContent ?? "";
  expect(text).toContain("Replaying");
  expect(text).toContain("Yesterday");
  expect(text).toContain("13:43:05");
  expect(text).toContain("2 people on the floor");
  // The range's ends, at the track's sides.
  expect(text).toContain("12:40");

  await draw(replayOf({ paused: true, seen: 0 }));
  expect(container.textContent).toContain("Replay paused");
  expect(container.textContent).toContain("Nobody was seen at this moment");
});

test("each control asks the replay for its move", async () => {
  const replay = replayOf();
  await draw(replay);
  await press("Pause");
  expect(replay.toggle).toHaveBeenCalledTimes(1);
  await press("Back 10 minutes");
  expect(replay.skip).toHaveBeenLastCalledWith(-SKIP_MS);
  await press("Forward 10 minutes");
  expect(replay.skip).toHaveBeenLastCalledWith(SKIP_MS);
  await press("From the start");
  expect(replay.seek).toHaveBeenLastCalledWith(0);
  await press("600 times the clock");
  expect(replay.setSpeed).toHaveBeenLastCalledWith(600);
  expect(
    container.querySelector('[aria-label="30 times the clock"]')?.getAttribute("aria-pressed"),
  ).toBe("true");
  await press("Back to now");
  expect(replay.stop).toHaveBeenCalledTimes(1);
});

test("with nothing replayed there is no bar", async () => {
  await draw(replayOf({ head: null, from: null, to: null, speed: null }));
  expect(container.textContent).toBe("");
});
