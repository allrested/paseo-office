import type { OfficeAgent } from "../shared/contracts.js";
import { agentTitle } from "../shared/model.js";
import { stateLabel } from "./agent-card.js";
import type { ConversationRow } from "./conversation-model.js";

/** True of an agent that is closed, archived, or created and not yet in the office's list. */
export const UNLISTED_LINE =
  "The office does not list this agent: it may be closed, archived or still starting.";

/** The header's second line: the room, then the state in the words the card and the rows use. */
export function statusLine(agent: OfficeAgent, room: string | null): string {
  const state = stateLabel(agent);
  return room === null ? state : `${room} · ${state}`;
}

/**
 * A message that joins a turn waiting on a request denies that request (the stock daemon clears
 * the waiting permissions on a send). A line by the box, not its prompt, so typing does not hide it.
 */
export const SENDING_DENIES = "Sending denies the request above.";

/** The reply box's prompt. */
export function composerPlaceholder(agent: OfficeAgent): string {
  return agent.status === "running" ? "Add to the running turn" : `Message ${agentTitle(agent)}`;
}

/** What a screen reader says for a row: who spoke, for the two voices; a tool or notice is its line. */
export function rowLabel(row: ConversationRow, agentName: string): string {
  if (row.kind === "you") return `You: ${row.text}`;
  if (row.kind === "agent") return `${agentName}: ${row.text}`;
  return row.text;
}

/** A `ui` or `app` block's card: its name when the block has none, and where it is drawn. */
export function uiCardTitle(piece: { language: "ui" | "app"; title: string | null }): string {
  return piece.title ?? (piece.language === "app" ? "Interactive app" : "Interactive card");
}
export const UI_CARD_HINT = "Drawn in the workspace chat.";
export const UI_APP_HINT = "Runs here in a sandboxed frame with no network.";
export const UI_CARD_WRITING = "Being written...";
export const UI_CARD_FAILED = "Could not draw this card here.";

export const LOADING = "Loading...";
export const NOTHING_SAID = "Nothing said yet.";
export const EARLIER_FAILED = "Unable to read earlier messages. Try again.";
export const ANSWER_IN_WORKSPACE = "Answer this in the workspace.";
export const CANNOT_ANSWER_HERE = "This cannot be answered here.";
