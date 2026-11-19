import type { Post } from "./contracts.js";

type Claim = Pick<Post, "id" | "seq">;

/** A session that opened before a plugin reload can report completion in its reply. */
export function completionLine(claim: Claim): string {
  return `Completed office task ${claim.id} (assignment ${claim.seq}).`;
}

export function assignmentFooter(claim: Claim): string {
  return [
    `Work on this task. When it is complete, use office_update with id "${claim.id}" and action "done". If you need input, leave it claimed and explain what you need.`,
    `If the tool is unavailable and you have finished, put this exact line at the end of your reply: ${completionLine(claim)}`,
  ].join("\n");
}

const HEADING =
  /^The office assigned you (?:lobby task (p\d+) from (?:the user|agent \S.*)|duty (p\d+) from the duty board)\.$/;

/** Recognize a complete generated prompt before presenting its task separately from the instructions. */
export function readLobbyAssignment(
  text: string,
): { id: string; body: string; kind: "lobby" | "duty" } | null {
  if (!text.startsWith("The office assigned you ")) return null;
  const [heading, ...lines] = text.split("\n");
  const found = HEADING.exec(heading ?? "");
  const id = found?.[1] ?? found?.[2];
  const seq = /\(assignment (\d+)\)\.$/.exec(lines.at(-1) ?? "")?.[1];
  if (!id || !seq || lines.length < 3) return null;
  if (lines.splice(-2).join("\n") !== assignmentFooter({ id, seq: Number(seq) })) return null;
  if (!lines.every((line) => line.startsWith("  "))) return null;
  const body = lines.map((line) => line.slice(2)).join("\n");
  return { id, body, kind: found?.[2] ? "duty" : "lobby" };
}
