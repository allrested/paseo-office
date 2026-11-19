import { expect, test } from "vitest";
import {
  isWordsLanguage,
  languageOfLocale,
  sceneLanguage,
  SCENE_LANGUAGES,
  WORDS_LANGUAGES,
} from "./scene-language.js";

test("the app's locales that Paseo names today are all English for the scene", () => {
  for (const locale of ["en", "ar", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh-CN"]) {
    expect(languageOfLocale(locale)).toBe("en");
  }
});

test("a locale the office has words for is that language, in any case and with a region", () => {
  expect(languageOfLocale("vi")).toBe("vi");
  expect(languageOfLocale("vi-VN")).toBe("vi");
  expect(languageOfLocale("th_TH")).toBe("th");
  expect(languageOfLocale("ID-id")).toBe("id");
  expect(languageOfLocale("in")).toBe("id");
});

test("nothing readable is English", () => {
  expect(languageOfLocale("")).toBe("en");
  expect(languageOfLocale("  ")).toBe("en");
  expect(languageOfLocale("und")).toBe("en");
});

test("Automatic follows the app and a choice wins", () => {
  expect(sceneLanguage("auto", "vi-VN")).toBe("vi");
  expect(sceneLanguage("auto", "pt-BR")).toBe("en");
  expect(sceneLanguage("th", "en")).toBe("th");
  expect(sceneLanguage("en", "vi")).toBe("en");
});

test("every language but English has words to send", () => {
  expect(SCENE_LANGUAGES.filter((language) => isWordsLanguage(language))).toEqual([
    ...WORDS_LANGUAGES,
  ]);
  expect(isWordsLanguage("en")).toBe(false);
});
