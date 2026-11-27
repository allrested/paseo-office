import { expect, test } from "vitest";
import { UI_ID } from "../shared/ui-words-id.js";
import { translate } from "./ui-language.js";

test("Indonesian has its words; a text it has none for, and any other language, stay as written", () => {
  expect(translate("id", "Dismiss")).toBe("Abaikan");
  expect(translate("id", "Add to lobby")).toBe("Tambah ke lobi");
  expect(translate("id", "Start an agent to analyze SHOP-12")).toBe(
    "Start an agent to analyze SHOP-12",
  );
  for (const language of ["en", "vi", "th"] as const) {
    expect(translate(language, "Dismiss")).toBe("Dismiss");
  }
});

test("no entry is empty, and none only repeats its English but for the names both languages share", () => {
  const shared = new Set([
    "Avatar",
    "Feed",
    "CPU",
    "Host",
    "Manual",
    "Model",
    "Pull request",
    "QA",
    "SSH",
    "Stand-up",
    "Workspace",
  ]);
  for (const [english, indonesian] of Object.entries(UI_ID)) {
    expect(indonesian.trim(), english).not.toBe("");
    if (!shared.has(english)) expect(indonesian, english).not.toBe(english);
  }
});
