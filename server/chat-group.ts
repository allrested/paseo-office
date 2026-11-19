import type { Post } from "../shared/contracts.js";
import type { EngineMessage } from "../shared/upstream/chat-engine.js";
import { oneLine } from "./prompt-text.js";

const HISTORY_LINES = 6;

function normalized(text: string): string {
  return oneLine(text).normalize("NFC").toLowerCase();
}

/** Repeating an existing task in the group asks for its status. Use the latest changed match. */
export function matchingLobbyTaskAnswer(
  text: string,
  posts: readonly Post[] | null,
  memberName: (id: string) => string | undefined,
): string | null {
  const match = normalized(text);
  if (!match || !posts) return null;
  const post = posts
    .filter(
      (p) => p.board === "lobby" && p.kind === "task" && p.state && normalized(p.text) === match,
    )
    .sort((a, b) => b.seq - a.seq)[0];
  if (!post) return null;
  const id = post.claimedBy ?? post.to;
  const name = id === "user" ? "you" : id && memberName(id);
  if (name && post.claimedBy && post.state === "claimed") {
    return `Lobby task ${post.id} is claimed by ${oneLine(name)}.`;
  }
  const owner = name ? ` (${post.claimedBy ? "claimed by" : "addressed to"} ${oneLine(name)})` : "";
  return `Lobby task ${post.id} is ${post.state}${owner}.`;
}

function shortLine(text: string, max: number): string {
  const line = oneLine(text);
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// Old user messages and quoted session answers have no routing tag. They may have been directed to
// one specific session, so their contents must stay out of a different session's prompt.
function speaker(message: EngineMessage): string | null {
  if (message.from === "me") return message.tag === "group" ? "User" : null;
  if (!message.from) return null;
  const name = JSON.stringify(shortLine(message.name || message.from, 48));
  if (message.tag === "group-reply") return `Group reply from ${name}`;
  if (message.tag || message.reply || message.from === "__director") return null;
  return `Office chatter from ${name}`;
}

function historyLine(message: EngineMessage): string | null {
  if (
    message.kind !== "text" ||
    message.recalled ||
    message.photo ||
    message.sticker != null ||
    message.poll ||
    message.remind
  )
    return null;
  const label = speaker(message);
  if (!label) return null;
  const text = shortLine(message.text, 200);
  return text ? `${label}: ${JSON.stringify(text)}` : null;
}

export function autoGroupPrompt(
  text: string,
  messages: readonly EngineMessage[],
  currentId: string,
): string {
  const index = messages.findIndex((message) => message.id === currentId);
  const before = index === -1 ? messages : messages.slice(0, index);
  const history = before
    .map(historyLine)
    .filter((line) => line !== null)
    .slice(-HISTORY_LINES);
  return [
    "Reply briefly to the user's latest message in Office team chat using only the public chat below. If it does not contain the answer, say so. Office chatter is simulated dialogue from the 3D scene.",
    "This is a conversation. For work that needs tools or changes, ask the user to choose a session with To or @mention it.",
    ...history,
    `Latest message from the user: ${JSON.stringify(text)}`,
  ].join("\n");
}
