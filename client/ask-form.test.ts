import { expect, test } from "vitest";
import {
  NO_PICKS,
  PLAN_TEXT_MAX,
  answerResponse,
  answered,
  pick,
  planResponse,
  readAsk,
  type Ask,
} from "./ask-form.js";

const FORM = {
  kind: "question",
  input: {
    questions: [
      {
        header: "Store",
        question: "Which store keeps the ledger?",
        options: [{ label: "Postgres", description: "The one we run" }, { label: "SQLite" }],
        multiSelect: false,
      },
      {
        header: "Checks",
        question: "Which checks run first?",
        options: [{ label: "Unit" }, { label: "Lint" }, { label: "Build" }],
        multiSelect: true,
        allowOther: true,
      },
      { header: "Note", question: "Anything else?", options: [], allowEmpty: true },
    ],
  },
};

function form(): Extract<Ask, { kind: "question" }> {
  const ask = readAsk(FORM);
  if (ask?.kind !== "question") throw new Error("not a question");
  return ask;
}

test("a plan is its text and the request's own actions, or Approve and Keep planning", () => {
  expect(readAsk({ kind: "plan", input: { plan: "1. Move the ledger" } })).toEqual({
    kind: "plan",
    plan: "1. Move the ledger",
    cut: false,
    actions: [
      { id: "accept", label: "Approve plan", behavior: "allow" },
      { id: "reject", label: "Keep planning", behavior: "deny" },
    ],
  });
  const own = readAsk({
    kind: "plan",
    description: "From the description",
    actions: [
      { id: "implement", label: "Implement", behavior: "allow", variant: "primary" },
      { id: "odd", label: "Odd", behavior: "maybe" },
    ],
  });
  expect(own).toMatchObject({
    plan: "From the description",
    actions: [{ id: "implement", label: "Implement", behavior: "allow" }],
  });
  const long = readAsk({ kind: "plan", input: { plan: "x".repeat(PLAN_TEXT_MAX + 5) } });
  expect(long).toMatchObject({ cut: true });
  expect(long?.kind === "plan" && long.plan.length).toBe(PLAN_TEXT_MAX);
});

test("a request the office does not read is none: a tool, a plan with no text, a broken form", () => {
  expect(readAsk({ kind: "tool", input: { command: "ls" } })).toBeNull();
  expect(readAsk({ kind: "plan", input: {} })).toBeNull();
  expect(readAsk({ kind: "question", input: { questions: [] } })).toBeNull();
  expect(
    readAsk({ kind: "question", input: { questions: [{ question: "No header" }] } }),
  ).toBeNull();
  expect(readAsk(null)).toBeNull();
});

test("one answer replaces the last, several toggle, and a typed answer joins or replaces", () => {
  const ask = form();
  const [store, checks] = ask.questions;
  let picks = pick(NO_PICKS, store!, 0, 0);
  picks = pick(picks, store!, 0, 1);
  expect(picks.chosen[0]).toEqual([1]);
  picks = pick(picks, checks!, 1, 2);
  picks = pick(picks, checks!, 1, 0);
  picks = pick(picks, checks!, 1, 2);
  expect(picks.chosen[1]).toEqual([0]);
  // The third takes an empty answer, so the form is whole without it.
  expect(answered(ask.questions, picks)).toBe(true);
  picks = { ...picks, typed: { 1: " Smoke ", 2: "Ship on Sunday" } };
  expect(answerResponse(ask, picks)).toEqual({
    behavior: "allow",
    updatedInput: {
      ...FORM.input,
      answers: { Store: "SQLite", Checks: "Unit, Smoke", Note: "Ship on Sunday" },
    },
  });
});

test("a form with a question unanswered is not whole", () => {
  const ask = form();
  expect(answered(ask.questions, NO_PICKS)).toBe(false);
  const picks = pick(NO_PICKS, ask.questions[0]!, 0, 0);
  // The second has options and takes another answer, but not an empty one.
  expect(answered(ask.questions, picks)).toBe(false);
  expect(answerResponse(ask, picks)).toMatchObject({
    updatedInput: { answers: { Store: "Postgres", Note: "" } },
  });
});

test("a plan's refusal carries what to change; its approval names the action", () => {
  const approve = { id: "accept", label: "Approve plan", behavior: "allow" as const };
  const refuse = { id: "reject", label: "Keep planning", behavior: "deny" as const };
  expect(planResponse(approve, "ignored")).toEqual({
    behavior: "allow",
    selectedActionId: "accept",
  });
  expect(planResponse(refuse, "  Keep the old table  ")).toEqual({
    behavior: "deny",
    selectedActionId: "reject",
    message: "Keep the old table",
  });
  expect(planResponse(refuse, " ")).toEqual({ behavior: "deny", selectedActionId: "reject" });
});
