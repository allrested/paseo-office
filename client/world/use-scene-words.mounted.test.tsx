// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { LanguageChoice } from "../../shared/scene-language.js";
import { createWordsLoader } from "./words-loader.js";
import { useSceneWords, type SceneWords } from "./use-scene-words.js";

let choice: LanguageChoice;
let status: string;
let locale: string;
let root: Root;
let value: SceneWords;
let loader = createWordsLoader();
const fetchWords = vi.fn<(input: { language: string }) => Promise<string>>();
vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: () => ({ status, values: { choice } }),
  useRpc: () => fetchWords,
}));
vi.mock("../app-locale.js", () => ({ useAppLocale: () => locale }));
vi.mock("./words-loader.js", async (original) => ({
  ...(await original<typeof import("./words-loader.js")>()),
  get sharedWordsLoader() {
    return loader;
  },
}));
function Probe() {
  value = useSceneWords();
  return null;
}
async function render() {
  await act(async () => root.render(<Probe />));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.createElement("div"));
  loader = createWordsLoader();
  fetchWords.mockReset();
  locale = "pt-BR";
  status = "ready";
  choice = "auto";
});
afterEach(() => act(() => root.unmount()));
test("waits for settings and serves English without a fetch", async () => {
  status = "loading";
  await render();
  expect(value.status).toBe("loading");
  status = "ready";
  await render();
  expect(value.language).toBe("en");
  locale = "vi";
  choice = "en";
  await render();
  expect(value).toEqual({ status: "ready", language: "en", words: undefined, note: null });
  expect(fetchWords).not.toHaveBeenCalled();
});
test.each(["ready", "invalid", "error"])(
  "Automatic follows the app for %s settings",
  async (state) => {
    status = state;
    locale = "vi-VN";
    fetchWords.mockResolvedValue("dictionary");
    await render();
    expect(fetchWords).toHaveBeenCalledWith({ language: "vi" });
    expect(value).toEqual({ status: "ready", language: "vi", words: "dictionary", note: null });
  },
);
test("a failed request leaves the floor in English with its language note", async () => {
  choice = "th";
  fetchWords.mockRejectedValue(new Error("offline"));
  await render();
  expect(value).toEqual({
    status: "ready",
    language: "en",
    words: undefined,
    note: "ไทย text could not be loaded; the scene is in English",
  });
});
test("ignores late answers and uses cached words after a switch", async () => {
  let finish!: (text: string) => void;
  choice = "th";
  fetchWords.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  expect(value.status).toBe("loading");
  choice = "id";
  fetchWords.mockResolvedValue("Indonesian");
  await render();
  expect(value.words).toBe("Indonesian");
  await act(async () => finish("Thai"));
  expect(value.language).toBe("id");
  choice = "th";
  await render();
  expect(value.words).toBe("Thai");
  expect(fetchWords).toHaveBeenCalledTimes(2);
});
