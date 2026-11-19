import type { NotesState } from "../shared/contracts.js";

/** A stopped writer's line starts so; a reason that already says it is shown on its own. */
const STOPPED = "The writer stopped";

/** The calendar day of `at` in the zone, in a form only compared. */
function dayIn(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** 24-hour "HH:MM" of `at` in the zone; h23 so midnight is 00, not 24. */
function timeIn(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

/**
 * The Stand-up card's line; null with no folder. A writer at work comes first, then one that
 * stopped or could not start (a kept reason is always newer than the last write), then today's
 * entry. "Today" is `now`'s day in `timeZone`.
 */
export function notesLine(
  state: NotesState | undefined,
  now: number,
  timeZone: string,
): string | null {
  if (state === undefined || !state.folderSet) return null;
  if (state.writing) return "Writing today's entry…";
  const { failedAgentId, problem, writtenAt } = state;
  if (failedAgentId !== null) {
    if (problem === null) return STOPPED;
    return problem.startsWith(STOPPED) ? problem : `${STOPPED}: ${problem}`;
  }
  // No writer of the office stopped: the folder, the settings or the start itself was refused.
  if (problem !== null) return `The writer could not start: ${problem}`;
  if (writtenAt !== null && dayIn(writtenAt, timeZone) === dayIn(now, timeZone)) {
    return `Today's entry written at ${timeIn(writtenAt, timeZone)}`;
  }
  return "No entry today yet";
}

/** A list line of the Contents that links to an entry of the same file. */
export interface NotesLink {
  label: string;
  anchor: string;
}

/** Markdown, or a run of list lines that each link to an entry of the same file. */
export type NotesPiece = { kind: "markdown"; text: string } | { kind: "links"; links: NotesLink[] };

/** The text from one "## " header to the next; the text before the first has no anchor. */
export interface NotesSection {
  anchor: string | null;
  pieces: NotesPiece[];
}

/** GitHub's anchor for a header: lower case, ASCII punctuation but - and _ dropped, each space a -. */
export function headerAnchor(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, "")
    .replace(/\s/g, "-");
}

/** A list line that is only a link to an anchor: "- [15 November 2026](#15-november-2026)". */
const LINK_LINE = /^\s*[-*+]\s+\[([^\]]+)\]\(#([^)\s]+)\)\s*$/;

/**
 * A section's pieces. The host's Markdown hands an anchor link to its file opener, so a list line
 * that links to an entry of this file becomes a link the card scrolls with; the rest stays Markdown.
 */
function piecesOf(text: string, anchors: ReadonlySet<string>): NotesPiece[] {
  const pieces: NotesPiece[] = [];
  let markdown = "";
  let links: NotesLink[] = [];
  const endMarkdown = () => {
    if (markdown.trim() !== "") pieces.push({ kind: "markdown", text: markdown });
    markdown = "";
  };
  const endLinks = () => {
    if (links.length > 0) pieces.push({ kind: "links", links });
    links = [];
  };
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const found = LINK_LINE.exec(line);
    const anchor = found?.[2]?.toLowerCase();
    if (found?.[1] !== undefined && anchor !== undefined && anchors.has(anchor)) {
      endMarkdown();
      links.push({ label: found[1], anchor });
    } else {
      endLinks();
      markdown += line;
    }
  }
  endMarkdown();
  endLinks();
  return pieces;
}

/**
 * A month's text split at each "## " header at the start of a line: the Contents, then one section
 * per entry, the newest last. A deeper header is part of its entry.
 */
export function splitSections(text: string): NotesSection[] {
  const starts = [0];
  for (const header of text.matchAll(/^## /gm)) if (header.index > 0) starts.push(header.index);
  const parts = starts.map((start, index) => text.slice(start, starts[index + 1]));
  const headed = parts.map((part) =>
    part.startsWith("## ") ? headerAnchor(part.slice(3).split("\n", 1)[0] ?? "") : null,
  );
  const anchors = new Set(headed.filter((anchor) => anchor !== null));
  return parts.map((part, index) => ({
    anchor: headed[index] ?? null,
    pieces: piecesOf(part, anchors),
  }));
}

/** "202611" -> "November 2026". */
export function monthTitle(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(4, 6)) - 1;
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(Date.UTC(year, index, 1));
}

/**
 * The zone the line's "today" is judged in: the notes time zone when the setting names one, else
 * this device's. The settings keep a zone the 8:00 schedule refused, which counts as none here.
 */
export function todayZone(setting: string): string {
  const zone = setting.trim();
  if (zone !== "") {
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: zone }).resolvedOptions().timeZone;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
