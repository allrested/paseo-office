/**
 * @vitest-environment jsdom
 */
// Checkpoints, mounted: the host's answers are a stand-in the test sets, and the host's text
// field and sheet are not needed.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Checkpoint, CheckpointFile } from "../shared/contracts.js";
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
const NONE = { turns: [], turnId: null, restored: 0, skipped: [] };

const edit = (path: string, added = 1, removed = 0): CheckpointFile => ({
  path,
  kind: "modified",
  added,
  removed,
});

function checkpoint(turnId: string, files: CheckpointFile[], extra: Partial<Checkpoint> = {}) {
  return {
    turnId,
    endedAt: new Date(2026, 10, 28, 14, 2).toISOString(),
    files,
    more: 0,
    usable: true,
    ...extra,
  };
}

const NEWEST = checkpoint("t2", [
  edit("src/app.ts", 12, 3),
  { path: "logo.png", kind: "modified", added: null, removed: null },
  { path: "new.txt", kind: "added", added: 2, removed: 0 },
  { path: "old.txt", kind: "deleted", added: 0, removed: 4 },
]);
const EARLIER = checkpoint("t1", [edit("a.txt"), edit("b.txt"), edit("c.txt")], {
  endedAt: new Date(2026, 10, 28, 13, 40).toISOString(),
  more: 2,
});

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

function buttons(label: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(`[aria-label="${label}"]`)];
}

function button(label: string): HTMLElement | null {
  return buttons(label)[0] ?? null;
}

async function press(label: string): Promise<void> {
  const found = button(label);
  if (!found) throw new Error(`No button ${label}`);
  await act(async () => found.click());
}

test("with no turn kept there is nothing", async () => {
  call.mockResolvedValue(NONE);
  await draw(false);
  expect(call).toHaveBeenCalledWith({ agentId: "a1", op: "status" });
  expect(container.textContent).toBe("");
});

test("a session at work shows nothing, and its turns when the turn has ended", async () => {
  call.mockResolvedValue({ ...NONE, turns: [NEWEST] });
  await draw(true);
  expect(call).not.toHaveBeenCalled();
  expect(container.textContent).toBe("");
  await draw(false);
  expect(button("Undo this turn")).not.toBeNull();
  await draw(true);
  expect(container.textContent).toBe("");
});

test("the newest turn's files show what each changed", async () => {
  call.mockResolvedValue({ ...NONE, turns: [NEWEST] });
  await draw(false);
  const text = container.textContent ?? "";
  expect(text).toContain("What this turn changed");
  expect(text).toContain("src/app.ts");
  expect(text).toContain("+12 −3");
  expect(text).toContain("logo.png");
  expect(text).toContain("binary");
  expect(text).toContain("new.txt");
  expect(text).toContain("added");
  expect(text).toContain("old.txt");
  expect(text).toContain("deleted");
  expect(button("Earlier turns")).toBeNull();
});

test("twenty files are shown, and the rest behind N more", async () => {
  const files = Array.from({ length: 25 }, (_, n) => edit(`f${String(n).padStart(2, "0")}.txt`));
  call.mockResolvedValue({ ...NONE, turns: [checkpoint("t1", files, { more: 3 })] });
  await draw(false);
  expect(container.textContent).toContain("f19.txt");
  expect(container.textContent).not.toContain("f20.txt");
  await press("8 more");
  expect(container.textContent).toContain("f24.txt");
  // What the host did not list stays a count.
  expect(container.textContent).toContain("3 more");
  expect(button("3 more")).toBeNull();
});

test("earlier turns are folded, one line each, and open to their files", async () => {
  call.mockResolvedValue({ ...NONE, turns: [NEWEST, EARLIER] });
  await draw(false);
  expect(container.textContent).not.toContain("13:40");
  await press("Earlier turns");
  expect(container.textContent).toContain("13:40 · 5 files");
  expect(container.textContent).not.toContain("b.txt");
  await press("13:40 · 5 files");
  expect(container.textContent).toContain("b.txt");
  expect(container.textContent).toContain("2 more");
  // Only the newest turn can be undone.
  expect(buttons("Undo this turn")).toHaveLength(1);
});

test("undo asks once, then says how many files it put back and why the others stayed", async () => {
  call.mockImplementation(async ({ op }: Call) =>
    op === "status"
      ? { ...NONE, turns: [NEWEST, EARLIER] }
      : {
          turns: [EARLIER],
          turnId: "t2",
          restored: 2,
          skipped: [
            { reason: "changed", count: 3 },
            { reason: "ignored", count: 1 },
          ],
        },
  );
  await draw(false);
  await press("Undo this turn");
  expect(container.textContent).toContain(
    "Put back the files this turn changed? Files changed since are left alone.",
  );
  await press("Cancel");
  expect(call).toHaveBeenCalledTimes(1);
  await press("Undo this turn");
  await press("Undo");
  expect(call).toHaveBeenLastCalledWith({ agentId: "a1", op: "undo" });
  const text = container.textContent ?? "";
  expect(text).toContain("Put back 2 files");
  expect(text).toContain("3 changed since the turn");
  expect(text).toContain("1 ignored by git");
  // The turn before is now the newest, and can be undone in its turn.
  expect(text).toContain("a.txt");
  expect(text).not.toContain("src/app.ts");
  expect(button("Undo this turn")).not.toBeNull();
});

test("a checkpoint whose snapshot is gone says so and has no button", async () => {
  call.mockResolvedValue({ ...NONE, turns: [{ ...NEWEST, usable: false }] });
  await draw(false);
  expect(container.textContent).toContain("This checkpoint's snapshot is gone");
  expect(button("Undo this turn")).toBeNull();
});

test("a host that refuses the undo says so", async () => {
  call.mockImplementation(async ({ op }: Call) => {
    if (op === "undo") throw new Error("the agent is working: undo when its turn has ended");
    return { ...NONE, turns: [NEWEST] };
  });
  await draw(false);
  await press("Undo this turn");
  await press("Undo");
  expect(container.textContent).toContain(
    "Unable to undo this turn: the agent is working: undo when its turn has ended",
  );
});
