import { DUTY_TIME_PATTERN, type Duty } from "../shared/contracts.js";
import type { DutyRow } from "../shared/duties.js";

/** What the duty board calls a row: its duty's name, or the post's first line once it is gone. */
export function dutyRowTitle(row: DutyRow): string {
  return row.duty?.name ?? row.post.text.split("\n")[0] ?? row.post.id;
}

function stateOf(row: DutyRow, name: (author: string) => string): string {
  const { post } = row;
  if (post.state === "done") return post.claimedBy ? `Done by ${name(post.claimedBy)}` : "Done";
  if (post.state === "claimed" && post.claimedBy) return `${name(post.claimedBy)} has it`;
  const pretend = (row.duty?.instructions.trim() ?? "") === "";
  return pretend ? "Open: the 3D office acts it out" : "Open: the next idle agent gets it";
}

/** Who has a duty today, or who will: an owed one says the day it was due. */
export function dutyStateText(row: DutyRow, name: (author: string) => string): string {
  const state = stateOf(row, name);
  return row.owed ? `Owed from ${row.post.duty?.day ?? "an earlier day"}. ${state}` : state;
}

/**
 * A time as typed in the duty editor, as kept: H:MM or HH:MM from 08:00 to 23:59 becomes HH:MM,
 * nothing typed is "" (no time, 08:00), and anything else is null.
 */
export function dutyTimeOf(typed: string): string | null {
  const text = typed.trim();
  if (text === "") return "";
  const time = /^\d:\d\d$/.test(text) ? `0${text}` : text;
  return DUTY_TIME_PATTERN.test(time) ? time : null;
}

/** A duty's time as the duty board shows it beside its name: null for 08:00. */
export function dutyTimeText(duty: Pick<Duty, "time">): string | null {
  return duty.time === undefined || duty.time === "08:00" ? null : duty.time;
}
