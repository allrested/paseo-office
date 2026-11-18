// What the stand-up writer is told: the day it writes for, the month's file, and the prompt.

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface NotesDay {
  /** `YYYYMM`, the month whose file holds the entry. */
  month: string;
  /** `DD Month YYYY`, the entry's header: `01 December 2026`. */
  header: string;
}

/** The day at `now` in `timeZone`, the notes time zone, which may not be the host's. */
export function notesDay(now: number, timeZone: string): NotesDay {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(now)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  const monthNumber = String(MONTHS.indexOf(values.month) + 1).padStart(2, "0");
  return {
    month: `${values.year}${monthNumber}`,
    header: `${values.day} ${values.month} ${values.year}`,
  };
}

export function notesFileName(month: string): string {
  return `daily-standup-${month}.md`;
}

export interface NotesPromptInput {
  header: string;
  fileName: string;
  report: string;
}

export function notesPrompt(input: NotesPromptInput): string {
  const { header, fileName, report } = input;
  // The writer starts in the notes folder, with the instructions of that folder and of the folders
  // above it. entryWritten (notes-files.ts) counts the entry as written when a line of the month's
  // file, directly in the folder, starts with its header.
  return [
    `Write today's stand-up note for ${header} in ${fileName}, directly in this folder; create the file if it is not there.`,
    `Follow the stand-up notes instructions you have been given for this folder, whether they come from this folder's or a parent folder's AGENTS.md or CLAUDE.md. Only when there are none, write the entry as a line "## ${header}" followed by a short note, from the report below, of what was done, what blocks it, and what comes next.`,
    `Either way the entry's header line is "## ${header}", in ${fileName}: the office finds the day's entry by that line.`,
    `If the entry for ${header} is already in ${fileName}, bring it up to date in place: keep what is still true and keep the file's Contents list right, if it has one.`,
    `Edit only ${fileName}. Do not commit.`,
    "",
    "The office's stand-up report, for what the agents did and what blocks them:",
    "",
    report,
  ].join("\n");
}
