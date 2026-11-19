import { expect, test, vi } from "vitest";
import { createWordsLoader } from "./words-loader.js";

test("concurrent and subsequent reads share one fetch per language", async () => {
  const loader = createWordsLoader();
  const fetch = vi.fn(async (language) => "words " + language);
  await Promise.all([loader.load("vi", fetch), loader.load("vi", fetch)]);
  expect(await loader.load("vi", fetch)).toBe("words vi");
  expect(await loader.load("id", fetch)).toBe("words id");
  expect(fetch.mock.calls).toEqual([["vi"], ["id"]]);
});

test("errors and empty text can be retried", async () => {
  const loader = createWordsLoader();
  await expect(
    loader.load("vi", async () => {
      throw new Error("offline");
    }),
  ).rejects.toThrow("offline");
  await expect(loader.load("vi", async () => "  ")).rejects.toThrow("The host sent no vi text");
  expect(await loader.load("vi", async () => "words")).toBe("words");
});
