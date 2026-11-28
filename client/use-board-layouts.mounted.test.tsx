/**
 * @vitest-environment jsdom
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { BoardLayout } from "../shared/settings.js";

const setting = vi.hoisted(() => ({
  current: { status: "loading" } as Record<string, unknown>,
}));
vi.mock("@getpaseo/plugin/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@getpaseo/plugin/client")>()),
  useSettings: () => setting.current,
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const { useBoardLayouts } = await import("./use-board-layouts.js");

async function read(): Promise<{ lobby: BoardLayout; rooms: BoardLayout }> {
  let seen: { lobby: BoardLayout; rooms: BoardLayout } | null = null;
  function Probe() {
    seen = useBoardLayouts();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
  act(() => root.unmount());
  return seen!;
}

test("until the setting loads the lobby is a kanban and the rooms a list", async () => {
  setting.current = { status: "loading" };
  expect(await read()).toEqual({ lobby: "kanban", rooms: "list" });
});

test("a saved value is read back", async () => {
  setting.current = { status: "ready", values: { lobby: "list", rooms: "kanban" } };
  expect(await read()).toEqual({ lobby: "list", rooms: "kanban" });
});
