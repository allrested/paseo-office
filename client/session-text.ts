import type { OfficeAgent } from "../shared/contracts.js";
import { agentTitle } from "../shared/model.js";
import { stateLabel } from "./agent-card.js";
import type { ConversationRow } from "./conversation-model.js";

export const GONE_LINE = "This agent has left the office.";

/** The header's second line: the room, then the state in the words the card and the rows use. */
export function statusLine(agent: OfficeAgent, room: string | null): string {
  const state = stateLabel(agent);
  return room === null ? state : `${room} · ${state}`;
}

export function composerPlaceholder(agent: OfficeAgent): string {
  return agent.status === "running" ? "Add to the running turn" : `Message ${agentTitle(agent)}`;
}

/** What a screen reader says for a row: who spoke, for the two voices; a tool or notice is its line. */
export function rowLabel(row: ConversationRow, agentName: string): string {
  if (row.kind === "you") return `You: ${row.text}`;
  if (row.kind === "agent") return `${agentName}: ${row.text}`;
  return row.text;
}

export const LOADING = "Loading...";
export const NOTHING_SAID = "Nothing said yet.";
export const EARLIER_FAILED = "Unable to read earlier messages. Try again.";
export const ANSWER_IN_WORKSPACE = "Answer this in the workspace.";
export const CANNOT_ANSWER_HERE = "This cannot be answered here.";
