import { expect, test } from "vitest";
import type { Post } from "../shared/contracts.js";
import type { EngineMessage } from "../shared/upstream/chat-engine.js";
import { ChatFileSchema, emptyChat } from "./chat-store.js";
import { autoGroupPrompt, matchingLobbyTaskAnswer } from "./chat-group.js";

const task: Post = {
  id: "p34",
  seq: 34,
  board: "lobby",
  kind: "task",
  text: "Fix the café login.",
  author: "user",
  state: "open",
  createdAt: "2026-11-19T10:00:00Z",
  updatedAt: "2026-11-19T10:00:00Z",
};

const name = (id: string) => (id === "agent-1" ? "Taufik" : undefined);

test("repeating a whole lobby task answers from its latest state and named owner", () => {
  const posts: Post[] = [
    { ...task, id: "p2", seq: 2, state: "done" },
    { ...task, state: "claimed", claimedBy: "agent-1" },
  ];
  const answer = matchingLobbyTaskAnswer(" FIX  the\ncafe\u0301 LOGIN.  ", posts, name);
  expect(answer).toBe("Lobby task p34 is claimed by Taufik.");
  expect(matchingLobbyTaskAnswer(task.text, [{ ...task, state: "done" }], name)).toBe(
    "Lobby task p34 is done.",
  );
  expect(matchingLobbyTaskAnswer(task.text, [{ ...task, to: "agent-1" }], name)).toBe(
    "Lobby task p34 is open (addressed to Taufik).",
  );
});

test("notes, workspace tasks, and partial matches leave the group conversation alone", () => {
  const posts: Post[] = [
    { ...task, kind: "note" },
    { ...task, board: "my-workspace" },
  ];
  expect(matchingLobbyTaskAnswer(task.text, posts, name)).toBeNull();
  expect(matchingLobbyTaskAnswer("the café login", [task], name)).toBeNull();
  expect(matchingLobbyTaskAnswer(task.text, null, name)).toBeNull();
});

function message(id: string, text: string, fields: Partial<EngineMessage> = {}): EngineMessage {
  return { id, at: 1, kind: "text", text, from: "a", name: "Ava", reacts: {}, ...fields };
}

test("the respondent can identify who spoke in the scene and answer the latest question once", () => {
  const question = "Who is going back?";
  const rows = [
    message("1", "Good night", { from: "me", tag: "group" }),
    message("2", "Heading back!", { name: 'Engineer "A"' }),
    message("3", "I can see two desks.", { tag: "group-reply", name: "Bo" }),
    message("4", question, { from: "me", tag: "group" }),
    message("5", "Posted later"),
  ];
  const prompt = autoGroupPrompt(question, rows, "4");
  expect(prompt.split("\n").slice(-4)).toEqual([
    'User: "Good night"',
    String.raw`Office chatter from "Engineer \"A\"": "Heading back!"`,
    'Group reply from "Bo": "I can see two desks."',
    'Latest message from the user: "Who is going back?"',
  ]);
  expect(prompt.match(/Who is going back\?/g)).toHaveLength(1);
  expect(prompt).toContain("simulated dialogue");
  expect(prompt).not.toContain("Posted later");
});

test("group prompts exclude directed and recalled content, notices, attachments and system lines", () => {
  const reply = { id: "x", name: "You", text: "secret" };
  const fields: Partial<EngineMessage>[] = [
    { from: "me" },
    { reply },
    { reply, from: "__director" },
    { tag: "delivery" },
    { tag: "future-private-tag" },
    { from: undefined },
    { tag: "group-reply", recalled: true },
    { kind: "sys" },
    { kind: "photo" },
    { tag: "group", from: "me", photo: {} },
    { tag: "group", from: "me", sticker: 0 },
    { poll: { q: "secret", opts: [] } },
    { remind: { title: "secret", at: 1, repeat: "", yes: [], no: [] } },
  ];
  const rows = fields.map((field, i) => message(String(i), "secret", field));
  rows.push(message("visible", "Public answer", { tag: "group-reply", reply }));
  const prompt = autoGroupPrompt("Hi", rows, "new");
  expect(prompt).toContain("Public answer");
  expect(prompt).not.toContain("secret");
});

test("the context contains at most six prior public lines of bounded length", () => {
  const rows = Array.from({ length: 8 }, (_, index) => message(String(index), `Note ${index}`));
  rows.push(message("long", "a".repeat(500), { name: "b".repeat(100) }));
  const prompt = autoGroupPrompt("Hello", rows, "new");
  expect(prompt).not.toContain("Note 2");
  expect(prompt).toContain("Note 3");
  expect(prompt).toContain("Note 7");
  expect(prompt).toContain(`${"b".repeat(47)}…`);
  expect(prompt).toContain(`${"a".repeat(199)}…`);
  expect(prompt).not.toContain("a".repeat(200));
});

test("the chat store preserves routing tags and accepts messages from older builds", () => {
  const tags = ["group", "group-reply", "delivery", "future-private-tag", undefined];
  const file = { ...emptyChat(), msgs: tags.map((tag, i) => message(String(i), "line", { tag })) };
  const stored = ChatFileSchema.parse(JSON.parse(JSON.stringify(file)));
  expect(stored.msgs.map((m) => m.tag)).toEqual(tags);
});
