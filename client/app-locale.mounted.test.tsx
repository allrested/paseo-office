/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { useAppLocale } from "./app-locale.js";

const sdk = vi.hoisted(() => ({ current: "en", define: vi.fn((value: unknown) => value) }));
vi.mock("@getpaseo/plugin/client", () => ({
  defineTranslations: sdk.define,
  useTranslation: () => ({ locale: sdk.current }),
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

function Probe() {
  return <span>{useAppLocale()}</span>;
}

test("the locale follows the app, with one probe made on first render", async () => {
  expect(sdk.define).not.toHaveBeenCalled();
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<Probe />));
  expect(container.textContent).toBe("en");
  sdk.current = "vi-VN";
  await act(async () => root.render(<Probe />));
  expect(container.textContent).toBe("vi-VN");
  expect(sdk.define).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
});
