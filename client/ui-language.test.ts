import { expect, test } from "vitest";
import { UI_ID } from "../shared/ui-words-id.js";
import { UI_TH } from "../shared/ui-words-th.js";
import { UI_VI } from "../shared/ui-words-vi.js";
import { translate } from "./ui-language.js";

test("Indonesian has its words; a text it has none for, and English, stay as written", () => {
  expect(translate("id", "Dismiss")).toBe("Abaikan");
  expect(translate("id", "Add to lobby")).toBe("Tambah ke lobi");
  expect(translate("id", "Start an agent to analyze SHOP-12")).toBe(
    "Mulai agen untuk menganalisis SHOP-12",
  );
  // A line the office has no words for stays as it is.
  expect(translate("id", "Reticulating the splines")).toBe("Reticulating the splines");
  expect(translate("en", "Dismiss")).toBe("Dismiss");
});

test("Vietnamese and Thai have their words, their shapes, and the English for a text they have none for", () => {
  expect(translate("vi", "Dismiss")).toBe(UI_VI.Dismiss);
  expect(translate("th", "Dismiss")).toBe(UI_TH.Dismiss);
  expect(translate("vi", "Start an agent to analyze SHOP-12")).toContain("SHOP-12");
  expect(translate("th", "Start an agent to analyze SHOP-12")).toContain("SHOP-12");
  expect(translate("vi", "Reticulating the splines")).toBe("Reticulating the splines");
  expect(translate("th", "Reticulating the splines")).toBe("Reticulating the splines");
});

test("no entry is empty, and none only repeats its English but for the names the languages share", () => {
  const shared = new Set([
    "Avatar",
    "Feed",
    "CPU",
    "Chat",
    "Context",
    "Host",
    "Manual",
    "Model",
    "Provider",
    "Pull request",
    "QA",
    "SSH",
    "Stand-up",
    "Workspace",
  ]);
  for (const table of [UI_ID, UI_VI, UI_TH]) {
    for (const [english, text] of Object.entries(table)) {
      expect(text.trim(), english).not.toBe("");
      if (!shared.has(english)) expect(text, english).not.toBe(english);
    }
  }
});
