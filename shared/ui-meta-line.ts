/**
 * A board post's meta line is its parts joined with " · " (client/board-text.ts `postMeta` and
 * `todoMeta`): a state, who it is between, and what it is for or from. A rule written for one part
 * ("claimed by (.+)") would swallow the parts after it untranslated, so a joined line is taken
 * apart and each part is translated on its own.
 *
 * Only a line whose every part is one of those is taken: a post's text or a session's title that
 * happens to hold " · " goes the way it did, and so does a line with a part this does not know.
 */
const TAIL = /^(?:for team .+|not for .+|from lobby task .+|on .+'s board|for (.+))$/;

/**
 * The line translated part by part, or null when it is not a meta line. `translate` is the
 * language's `translatePattern`; `forAgent` writes "for Planner" ("for team" has its own rule).
 */
export function translateMetaLine(
  text: string,
  translate: (part: string) => string,
  forAgent: (name: string) => string,
): string | null {
  const parts = text.split(" · ");
  if (parts.length < 2) return null;
  // The state: "Task · open", "Task · claimed by X", "Note", or, on a to-do's line, "claimed by X".
  let used = 0;
  let people = false;
  if (parts[0] === "Task" && /^(?:open|claimed|done|claimed by .+)$/.test(parts[1] ?? "")) {
    used = 2;
    people = true;
  } else if (parts[0] === "Note") {
    used = 1;
    people = true;
  } else if (parts[0]?.startsWith("claimed by ")) {
    used = 1;
  }
  const out: string[] = [];
  if (used > 0) out.push(translate(parts.slice(0, used).join(" · ")));
  // Who it is between ("You → Planner", or one name): free text, kept as it is.
  if (people && parts.length > used) out.push(parts[used] ?? "");
  const rest = parts.slice(used + (people ? 1 : 0));
  if (used === 0 && rest.length === 0) return null;
  for (const part of rest) {
    const agent = TAIL.exec(part);
    if (agent === null) return null;
    out.push(agent[1] === undefined ? translate(part) : forAgent(agent[1]));
  }
  return out.join(" · ");
}
