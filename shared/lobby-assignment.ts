import type { Post } from "./contracts.js";

type Claim = Pick<Post, "id" | "seq">;

/** A session that opened before a plugin reload can report completion in its reply. */
export function completionLine(claim: Claim): string {
  return `Completed office task ${claim.id} (assignment ${claim.seq}).`;
}

function footerOf(claim: Claim, work: string): string {
  return [
    work,
    `If the tool is unavailable and you have finished, put this exact line at the end of your reply: ${completionLine(claim)}`,
  ].join("\n");
}

export function assignmentFooter(claim: Claim): string {
  return footerOf(
    claim,
    `Work on this task. When it is complete, use office_update with id "${claim.id}", action "done" and a short result in note. If you need input, leave it claimed and explain what you need.`,
  );
}

/** Footers an earlier plugin version sent: a session that opened before an upgrade still holds one. */
export function legacyFooters(claim: Claim): string[] {
  return [
    footerOf(
      claim,
      `Work on this task. When it is complete, use office_update with id "${claim.id}" and action "done". If you need input, leave it claimed and explain what you need.`,
    ),
  ];
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
  const claim = { id, seq: Number(seq) };
  const footer = lines.splice(-2).join("\n");
  if (footer !== assignmentFooter(claim) && !legacyFooters(claim).includes(footer)) return null;
  if (!lines.every((line) => line.startsWith("  "))) return null;
  const body = lines.map((line) => line.slice(2)).join("\n");
  return { id, body, kind: found?.[2] ? "duty" : "lobby" };
}
