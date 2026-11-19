/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { LanguageSetting } from "./language-switch.js";
import type { OfficeStyles } from "./styles.js";

const state = vi.hoisted(() => ({
  status: "ready",
  values: { choice: "auto" },
  revision: "rev",
  saving: false,
  saveError: null as string | null,
  save: vi.fn(),
}));
vi.mock("@getpaseo/plugin/client", async (original) => ({
  ...(await original<typeof import("@getpaseo/plugin/client")>()),
  useSettings: () => state,
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let container: HTMLElement;
let root: Root;
const styles = new Proxy({}, { get: () => ({}) }) as OfficeStyles;

beforeEach(() => {
  Object.assign(state, { status: "ready", values: { choice: "auto" }, saveError: null });
  state.save.mockClear();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));
const mount = () => act(async () => root.render(<LanguageSetting styles={styles} />));
const button = (name: string) => container.querySelector<HTMLElement>(`[aria-label="${name}"]`);

test("offers the five choices, shows what stays English, and saves against the revision", async () => {
  state.values.choice = "id";
  await mount();
  const group = container.querySelector('[role="group"][aria-label="3D office language"]');
  expect([...group!.querySelectorAll("button,[role=button]")].map((el) => el.textContent)).toEqual([
    "Automatic",
    "English",
    "Tiếng Việt",
    "ไทย",
    "Bahasa Indonesia",
  ]);
  expect(container.textContent).toContain("The column, the cards and this page stay in English.");
  expect(button("Bahasa Indonesia")?.getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("Tiếng Việt")?.click());
  expect(state.save).toHaveBeenCalledWith({ choice: "vi" }, "rev");
});
test("an invalid document shows Automatic and can be replaced", async () => {
  state.status = "invalid";
  await mount();
  expect(button("Automatic")?.getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("English")?.click());
  expect(state.save).toHaveBeenCalledWith({ choice: "en" }, "rev");
});
test("loading disables the choices and a failed save explains why", async () => {
  state.status = "loading";
  await mount();
  expect(button("English")?.getAttribute("aria-disabled")).toBe("true");
  await act(async () => button("English")?.click());
  expect(state.save).not.toHaveBeenCalled();
  Object.assign(state, { status: "ready", saveError: "Revision changed" });
  await mount();
  expect(container.querySelector("[role=alert]")?.textContent).toContain("Revision changed");
});
