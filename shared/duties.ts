import { DUTY_TIME_PATTERN, type Duty, type DutyBoard, type Post } from "./contracts.js";
import { DUTY } from "./names.js";

/** The most duties the list holds. */
export const DUTY_MAX = 12;
export const DUTY_NAME_MAX = 40;
export const DUTY_INSTRUCTIONS_MAX = 2000;
/** The most characters of a holder's name the 3D board and its tooltip show. */
export const DUTY_HOLDER_CHARS = 24;
/**
 * A duty comes due at 08:00 in the notes' zone, the stand-up's hour, unless it has a later time:
 * minutes of the day. The duty board's day begins then too.
 */
export const DUTY_DUE_MINUTE = 8 * 60;

const WEEKDAYS = [1, 2, 3, 4, 5];

/** The list a host starts with: the 3D pantry's four chores, pretend, Monday to Friday. */
export const STARTING_DUTIES: readonly Duty[] = [
  { id: "cups", name: "Wash the cups", instructions: "", days: WEEKDAYS, chore: "cups" },
  { id: "bin", name: "Take out the bin", instructions: "", days: WEEKDAYS, chore: "trash" },
  { id: "plants", name: "Water the plants", instructions: "", days: WEEKDAYS, chore: "plants" },
  { id: "tables", name: "Wipe the tables", instructions: "", days: WEEKDAYS, chore: "table" },
];

/** A duty as the editor sends it: an id for one already on the list, none for a new one. */
export interface DutyDraft {
  id?: string;
  name: string;
  instructions: string;
  days: readonly number[];
  /** HH:MM from 08:00 to 23:59; none for 08:00. */
  time?: string;
}

function dutyProblem(duty: DutyDraft, index: number): string | null {
  const name = duty.name.trim();
  if (name === "") return `duty ${index + 1} has no name`;
  if (/[\r\n\u2028\u2029]/.test(name)) return `the name of duty ${index + 1} has a line break`;
  if (name.length > DUTY_NAME_MAX) return `"${name}" is longer than ${DUTY_NAME_MAX} characters`;
  if (duty.instructions.trim().length > DUTY_INSTRUCTIONS_MAX) {
    return `the instructions of "${name}" are longer than 2,000 characters`;
  }
  if (duty.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    return `"${name}" has a day that is not 0 (Sunday) to 6 (Saturday)`;
  }
  if (duty.days.some((day, at) => duty.days.indexOf(day) !== at))
    return `"${name}" has a day twice`;
  if (duty.time !== undefined && !DUTY_TIME_PATTERN.test(duty.time)) {
    return `Duty "${name}": the time must be between 08:00 and 23:59`;
  }
  return null;
}

/** Why the list cannot be saved, as one sentence; null when it can. */
export function dutyListProblem(duties: readonly DutyDraft[]): string | null {
  if (duties.length > DUTY_MAX) {
    return `Unable to save: the duty board holds at most ${DUTY_MAX} duties`;
  }
  for (const [index, duty] of duties.entries()) {
    const problem = dutyProblem(duty, index);
    if (problem !== null) return `Unable to save: ${problem}`;
  }
  return null;
}

/** The text of a duty's post: its name, then its instructions after a blank line. */
export function dutyPostText(duty: Pick<Duty, "name" | "instructions">): string {
  const instructions = duty.instructions.trim();
  const name = duty.name.trim();
  return instructions === "" ? name : `${name}\n\n${instructions}`;
}

/** A duty post on the board, with its duty (null once the duty left the list). */
export interface DutyRow {
  post: Post;
  duty: Duty | null;
  /** Not done on its day: it stays on the board, owed. */
  owed: boolean;
  /** The notes under the duty, oldest first: its holder's and the answers to it. */
  replies: Post[];
}

/**
 * The day's duty board: one row per duty post, in the list's order, then the posts whose duty
 * left the list, oldest first. A post open or claimed from an earlier day than the board's is owed.
 * The board's notes are replies: each is on the row of the duty it is under.
 */
export function dutyRows(board: DutyBoard | undefined, posts: readonly Post[]): DutyRow[] {
  if (board === undefined) return [];
  const order = new Map(board.duties.map((duty, index) => [duty.id, index]));
  const rank = (post: Post) => order.get(post.duty?.id ?? "") ?? board.duties.length;
  const notes = posts.filter((post) => post.board === DUTY && post.kind === "note");
  return posts
    .filter((post) => post.board === DUTY && post.kind === "task" && post.duty !== undefined)
    .sort((left, right) => rank(left) - rank(right) || left.seq - right.seq)
    .map((post) => ({
      post,
      duty: board.duties.find((duty) => duty.id === post.duty?.id) ?? null,
      owed:
        post.state !== "done" &&
        board.day !== null &&
        (post.duty?.day ?? board.day).localeCompare(board.day) < 0,
      replies: notes
        .filter((note) => note.replyTo === post.id)
        .sort((left, right) => left.seq - right.seq),
    }));
}

/** A holder's name on one line, cut to DUTY_HOLDER_CHARS with an ellipsis. */
export function shortHolder(name: string): string {
  const line = name.trim().replace(/\s+/g, " ");
  if (line.length <= DUTY_HOLDER_CHARS) return line;
  return `${line.slice(0, DUTY_HOLDER_CHARS - 1).trimEnd()}…`;
}
