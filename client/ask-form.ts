/**
 * A plan or a question an agent waits on, read off the provider's own request so the office can
 * answer it where it shows the session. The shapes are the ones Paseo's chat reads: a plan's text
 * in `input.plan`, a question form in `input.questions`, and the request's own `actions`.
 */

/** The most of a plan the office draws; the workspace has the rest. */
export const PLAN_TEXT_MAX = 12_000;

export interface AskAction {
  id: string;
  label: string;
  behavior: "allow" | "deny";
}

export interface AskOption {
  label: string;
  description: string | null;
}

export interface AskQuestion {
  /** The key the answer goes back under. */
  header: string;
  question: string;
  options: AskOption[];
  multiSelect: boolean;
  /** A typed answer is taken: the question has no options, or allows another. */
  typed: boolean;
  /** A typed answer may be empty. */
  allowEmpty: boolean;
}

export type Ask =
  | { kind: "plan"; plan: string; cut: boolean; actions: AskAction[] }
  | { kind: "question"; questions: AskQuestion[]; input: Record<string, unknown> };

/** What goes back to the provider: the shape of `respondToPermission`'s response. */
export type AskResponse =
  | { behavior: "allow"; selectedActionId?: string; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; selectedActionId?: string; message?: string };

const PLAN_ACTIONS: AskAction[] = [
  { id: "accept", label: "Approve plan", behavior: "allow" },
  { id: "reject", label: "Keep planning", behavior: "deny" },
];

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function actionsOf(value: unknown): AskAction[] {
  if (!Array.isArray(value)) return [];
  const actions: AskAction[] = [];
  for (const item of value) {
    const action = record(item);
    if (action === null) continue;
    const { id, label, behavior } = action;
    if (typeof id !== "string" || typeof label !== "string") continue;
    if (behavior !== "allow" && behavior !== "deny") continue;
    actions.push({ id, label, behavior });
  }
  return actions;
}

function questionsOf(value: unknown): AskQuestion[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const questions: AskQuestion[] = [];
  for (const item of value) {
    const question = record(item);
    if (question === null) return null;
    if (typeof question.question !== "string" || typeof question.header !== "string") return null;
    if (!Array.isArray(question.options)) return null;
    const options: AskOption[] = [];
    for (const raw of question.options) {
      const option = record(raw);
      if (option === null || typeof option.label !== "string") return null;
      const description = typeof option.description === "string" ? option.description : null;
      options.push({ label: option.label, description });
    }
    questions.push({
      header: question.header,
      question: question.question,
      options,
      multiSelect: question.multiSelect === true,
      typed: options.length === 0 || question.allowOther === true || question.isOther === true,
      allowEmpty: question.allowEmpty === true,
    });
  }
  return questions;
}

/** The request as the office can answer it; null for a shape it does not read. */
export function readAsk(request: unknown): Ask | null {
  const asked = record(request);
  if (asked === null) return null;
  const input = record(asked.input) ?? {};
  if (asked.kind === "question") {
    const questions = questionsOf(input.questions);
    return questions === null ? null : { kind: "question", questions, input };
  }
  if (asked.kind !== "plan") return null;
  const text = typeof input.plan === "string" ? input.plan : asked.description;
  if (typeof text !== "string" || text.trim() === "") return null;
  const actions = actionsOf(asked.actions);
  return {
    kind: "plan",
    plan: text.slice(0, PLAN_TEXT_MAX),
    cut: text.length > PLAN_TEXT_MAX,
    actions: actions.length > 0 ? actions : PLAN_ACTIONS,
  };
}

/** The options chosen for each question, by its place, and what was typed for it. */
export interface AskPicks {
  chosen: Readonly<Record<number, readonly number[]>>;
  typed: Readonly<Record<number, string>>;
}

export const NO_PICKS: AskPicks = { chosen: {}, typed: {} };

/** A press on an option: one answer replaces the last, several toggle. */
export function pick(picks: AskPicks, question: AskQuestion, at: number, option: number): AskPicks {
  const before = picks.chosen[at] ?? [];
  let next: number[];
  if (!question.multiSelect) next = before.includes(option) ? [] : [option];
  else if (before.includes(option)) next = before.filter((index) => index !== option);
  else next = [...before, option].sort((left, right) => left - right);
  return { ...picks, chosen: { ...picks.chosen, [at]: next } };
}

function answerOf(question: AskQuestion, at: number, picks: AskPicks): string | null {
  const labels = (picks.chosen[at] ?? []).flatMap((index) => question.options[index]?.label ?? []);
  const typed = question.typed ? (picks.typed[at] ?? "").trim() : "";
  if (typed !== "") return question.multiSelect ? [...labels, typed].join(", ") : typed;
  if (labels.length > 0) return labels.join(", ");
  return question.typed && question.allowEmpty ? "" : null;
}

export function answered(questions: readonly AskQuestion[], picks: AskPicks): boolean {
  return questions.every((question, at) => answerOf(question, at, picks) !== null);
}

/** The answers as the provider takes them: the form's input again, with an answer per header. */
export function answerResponse(
  ask: Extract<Ask, { kind: "question" }>,
  picks: AskPicks,
): AskResponse {
  const answers: Record<string, string> = {};
  ask.questions.forEach((question, at) => {
    const answer = answerOf(question, at, picks);
    if (answer !== null) answers[question.header] = answer;
  });
  return { behavior: "allow", updatedInput: { ...ask.input, answers } };
}

export const DISMISSED: AskResponse = { behavior: "deny", message: "Dismissed by user" };

/** A plan's action as pressed; `feedback` goes with a refusal, so the agent knows what to change. */
export function planResponse(action: AskAction, feedback: string): AskResponse {
  if (action.behavior === "allow") return { behavior: "allow", selectedActionId: action.id };
  const message = feedback.trim();
  return {
    behavior: "deny",
    selectedActionId: action.id,
    ...(message === "" ? {} : { message }),
  };
}
