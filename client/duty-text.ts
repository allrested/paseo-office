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
