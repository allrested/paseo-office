/**
 * @vitest-environment jsdom
 */
// Undo last turn, mounted: the host's answers are a stand-in the test sets, and the host's text
// field and sheet are not needed.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { UndoTurn } from "./undo-turn.js";
import { useOfficeStyles } from "./styles.js";

interface Call {
  agentId: string;
  op: "status" | "undo";
}
const call = vi.hoisted(() => vi.fn());
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => call }));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { TextInput } = await import("react-native");
  return { TextInput, Icon: () => null };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const NONE = { files: 0, restored: 0, skipped: [] };

function Harness({ running }: { running: boolean }) {
  const styles = useOfficeStyles(THEME, false, false);
  return <UndoTurn agentId="a1" running={running} styles={styles} />;
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  call.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function draw(running: boolean): Promise<void> {
  await act(async () => root.render(<Harness running={running} />));
}

function button(label: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
}

async function press(label: string): Promise<void> {
  const found = button(label);
  if (!found) throw new Error(`No button ${label}`);
  await act(async () => found.click());
}

test("with nothing to undo there is no button", async () => {
  call.mockResolvedValue(NONE);
  await draw(false);
  expect(call).toHaveBeenCalledWith({ agentId: "a1", op: "status" });
  expect(container.textContent).toBe("");
});

test("a session at work has no button, and gets one when its turn has ended", async () => {
  call.mockResolvedValue({ ...NONE, files: 2 });
  await draw(true);
  expect(call).not.toHaveBeenCalled();
  expect(button("Undo last turn")).toBeNull();
  await draw(false);
  expect(button("Undo last turn")).not.toBeNull();
  await draw(true);
  expect(button("Undo last turn")).toBeNull();
});

test("it asks first, naming the files, and says that a shell command's changes stay", async () => {
  call.mockResolvedValue({ ...NONE, files: 2 });
  await draw(false);
  await press("Undo last turn");
  expect(container.textContent).toContain("Undo the last turn's edits to 2 files?");
  expect(container.textContent).toContain("Changes a shell command made are not undone");
  expect(call).toHaveBeenCalledTimes(1);
  await press("Cancel");
  expect(button("Undo last turn")).not.toBeNull();
  expect(call).toHaveBeenCalledTimes(1);
});

test("an undo says how many files it restored and skipped, with the reasons", async () => {
  call.mockImplementation(async ({ op }: Call) =>
    op === "status"
      ? { ...NONE, files: 3 }
      : {
          files: 0,
          restored: 1,
          skipped: [
            { reason: "changed", count: 1 },
            { reason: "ignored", count: 1 },
          ],
        },
  );
  await draw(false);
  await press("Undo last turn");
  await press("Undo");
  expect(call).toHaveBeenLastCalledWith({ agentId: "a1", op: "undo" });
  expect(container.textContent).toContain("1 file restored, 2 skipped");
  expect(container.textContent).toContain("1 file changed after the turn");
  expect(container.textContent).toContain("1 file ignored by git");
  expect(button("Undo last turn")).toBeNull();
});

test("a host that refuses the undo says so", async () => {
  call.mockImplementation(async ({ op }: Call) => {
    if (op === "undo") throw new Error("git is not here");
    return { ...NONE, files: 1 };
  });
  await draw(false);
  await press("Undo last turn");
  await press("Undo");
  expect(container.textContent).toContain("Unable to undo last turn: git is not here");
});
