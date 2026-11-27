import { expect, test } from "vitest";
import { RULES as RULES_ID } from "./ui-patterns-id.js";
import { RULES as RULES_TH } from "./ui-patterns-th.js";
import { RULES as RULES_VI } from "./ui-patterns-vi.js";
import { UI_ID } from "./ui-words-id.js";
import { UI_TH } from "./ui-words-th.js";
import { UI_VI } from "./ui-words-vi.js";

// A text added for one language only would be English in the others. These fail until every
// language has it: the whole-string tables by their English, the shapes by their regular expression.
const TABLES = { Indonesian: UI_ID, Vietnamese: UI_VI, Thai: UI_TH };
const RULES = { Indonesian: RULES_ID, Vietnamese: RULES_VI, Thai: RULES_TH };

test("every language has the same texts: none is missing from one that another has", () => {
  const all = new Set(Object.values(TABLES).flatMap((table) => Object.keys(table)));
  for (const [language, table] of Object.entries(TABLES)) {
    const missing = [...all].filter((english) => !(english in table));
    expect(missing, `${language} lacks`).toEqual([]);
  }
});

test("every language has the same shapes, one for one, in the same order", () => {
  const sources = (rules: typeof RULES_ID) => rules.map(([shape]) => shape.source);
  for (const [language, rules] of Object.entries(RULES)) {
    expect(sources(rules), `${language}'s shapes`).toEqual(sources(RULES_ID));
  }
});
