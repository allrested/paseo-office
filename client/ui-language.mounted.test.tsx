/**
 * @vitest-environment jsdom
 */
// The interface's language, mounted: a button and a switch under the provider, with the device's
// choice and the app's language as stand-ins.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ActionButton } from "./action-button.js";
import { UI_TH } from "../shared/ui-words-th.js";
import { UI_VI } from "../shared/ui-words-vi.js";
import { LabeledSwitch } from "./labeled-switch.js";
import { useOfficeStyles } from "./styles.js";
import { Text, TextInput } from "./text.js";
import { UiLanguage } from "./ui-language.js";

let choice = "auto";
let locale = "en";
vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: () => ({ status: "ready", values: { choice } }),
}));
vi.mock("./app-locale.js", () => ({ useAppLocale: () => locale }));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { TextInput: Input } = await import("react-native");
  return { TextInput: Input };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const nothing = async () => undefined;
const ignore = () => undefined;

function Controls() {
  const styles = useOfficeStyles(THEME, false, false);
  return createElement(
    UiLanguage,
    null,
    createElement(ActionButton, {
      label: "Dismiss",
      pendingLabel: "Dismissing...",
      onPress: nothing,
      styles,
    }),
    createElement(LabeledSwitch, { label: "Sound", value: false, onChange: ignore, styles }),
    createElement(Text, null, "No agents yet."),
    createElement(Text, null, "12 min ago"),
    // What a person wrote is drawn through the same text, and is not the office's to translate.
    createElement(Text, null, "Check why the login failed"),
    createElement(TextInput, { placeholder: "Search sessions", value: "", onChangeText: ignore }),
  );
}

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  choice = "auto";
  locale = "en";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const draw = () => act(async () => root.render(createElement(Controls)));
const labels = () =>
  [...container.querySelectorAll("[aria-label]")].map((each) => each.getAttribute("aria-label"));

test("the interface is English until Indonesian is chosen, or is the app's own language", async () => {
  await draw();
  expect(labels()).toEqual(["Dismiss", "Sound"]);

  choice = "id";
  await draw();
  expect(labels()).toEqual(["Abaikan", "Suara"]);
  expect(container.textContent).toContain("Abaikan");

  expect(container.textContent).toContain("Belum ada agen.");
  expect(container.textContent).toContain("12 mnt lalu");
  expect(container.textContent).toContain("Check why the login failed");
  expect(container.querySelector("input")?.getAttribute("placeholder")).toBe("Cari sesi");

  // Automatic follows the app.
  choice = "auto";
  locale = "id-ID";
  await draw();
  expect(labels()).toEqual(["Abaikan", "Suara"]);
});

test("Vietnamese and Thai put the interface in their words, chosen or from the app's language", async () => {
  choice = "vi";
  await draw();
  expect(labels()).toEqual([UI_VI.Dismiss, UI_VI.Sound]);
  expect(container.textContent).toContain(UI_VI["No agents yet."]);
  expect(container.textContent).toContain("12 phút trước");
  expect(container.textContent).toContain("Check why the login failed");
  expect(container.querySelector("input")?.getAttribute("placeholder")).toBe(
    UI_VI["Search sessions"],
  );

  choice = "th";
  await draw();
  expect(labels()).toEqual([UI_TH.Dismiss, UI_TH.Sound]);
  expect(container.textContent).toContain(UI_TH["No agents yet."]);
  expect(container.textContent).toContain("12 นาทีที่แล้ว");
  expect(container.querySelector("input")?.getAttribute("placeholder")).toBe(
    UI_TH["Search sessions"],
  );

  choice = "auto";
  locale = "vi-VN";
  await draw();
  expect(labels()).toEqual([UI_VI.Dismiss, UI_VI.Sound]);
  locale = "th-TH";
  await draw();
  expect(labels()).toEqual([UI_TH.Dismiss, UI_TH.Sound]);
  // Any other language still shows English.
  locale = "fr-FR";
  await draw();
  expect(labels()).toEqual(["Dismiss", "Sound"]);
});
