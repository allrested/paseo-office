/**
 * @vitest-environment jsdom
 */
// The settings' four sections, mounted as the settings screen and as a dialog hold them.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SettingsSections } from "./settings-sections.js";
import { useOfficeStyles } from "./styles.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { View } = await import("react-native");
  return {
    Icon: () => null,
    ScrollView: (props: { children?: ReactNode }) =>
      createElement("div", { "data-scroll": "" }, createElement(View, null, props.children)),
  };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
let container: HTMLElement;
let root: Root;

function Sections({ bounded }: { bounded: boolean }) {
  const styles = useOfficeStyles(THEME, true, true);
  return createElement(SettingsSections, {
    bounded,
    styles,
    appearance: createElement("p", null, "Branding"),
    teams: createElement("p", null, "Roster"),
    automation: null,
    services: null,
  });
}

const mount = (bounded: boolean) =>
  act(async () => root.render(createElement(Sections, { bounded })));
const page = (text: string) =>
  [...container.querySelectorAll("p")].find((p) => p.textContent === text) as HTMLElement;
const tab = (name: string) => container.querySelector(`[aria-label="${name}"]`) as HTMLElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("in a dialog each section scrolls under the tabs, which stay outside the scroll", async () => {
  await mount(true);
  expect(page("Branding").closest("[data-scroll]")).not.toBeNull();
  expect(tab("Teams").closest("[data-scroll]")).toBeNull();
  await act(async () => tab("Teams").click());
  expect(page("Roster").closest("[data-scroll]")).not.toBeNull();
  expect(tab("Teams").getAttribute("aria-pressed")).toBe("true");
});

test("on the settings screen, which scrolls as a whole, the sections add no scroll of their own", async () => {
  await mount(false);
  expect(page("Branding").closest("[data-scroll]")).toBeNull();
});
