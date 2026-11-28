import {
  defineAgentTool,
  type AgentToolDefinition,
  type AgentToolResult,
  type PluginHookAgent,
} from "@getpaseo/plugin/server";
import { z } from "zod";
import { waitingOn } from "../shared/board-rules.js";
import {
  DUTY,
  LOBBY,
  POST_TEXT_MAX,
  PostKindSchema,
  UpdateActionSchema,
  type Post,
} from "../shared/contracts.js";
import type { BoardService, ReadResult } from "./board-service.js";
import { indented, oneLine } from "./prompt-text.js";

export type ToolAgent = Pick<PluginHookAgent, "id" | "workspaceId" | "title">;

export interface OfficeToolPorts {
  service: BoardService;
  /**
   * The full id of the agent that `id` names (the daemon also takes a unique start of an id), or
   * null when there is none. The wake queue and the hooks know agents by their full ids only.
   */
  resolveAgent(id: string): Promise<string | null>;
  /** Queues the wake of the post's `to`, if any (the queue drops a post to its own author). */
  mentioned(post: Post): void;
  /** Remembers the caller's title for labels. */
  seen(agent: ToolAgent): void;
  label(author: string): string;
  /** A roster team's name by its id, or the id once the team is gone. */
  teamLabel(teamId: string): string;
}

const BoardChoiceSchema = z.enum(["room", "lobby"]);
/** The duty board is read, and its duties claimed and finished; it takes no post. */
const ReadChoiceSchema = z.enum(["room", "lobby", "duty"]);

export const ReadInputSchema = z.object({
  board: ReadChoiceSchema.optional(),
  since: z.number().int().nonnegative().optional(),
});
export type ReadInput = z.output<typeof ReadInputSchema>;

export const PostInputSchema = z.object({
  kind: PostKindSchema,
  text: z.string().min(1).max(POST_TEXT_MAX),
  to: z.string().min(1).optional(),
  board: BoardChoiceSchema.optional(),
  replyTo: z.string().min(1).optional(),
  team: z.string().min(1).optional(),
  after: z.array(z.string().min(1)).optional(),
});
export type PostInput = z.output<typeof PostInputSchema>;

export const UpdateInputSchema = z.object({
  id: z.string().min(1),
  action: UpdateActionSchema,
  note: z.string().min(1).max(POST_TEXT_MAX).optional(),
});
export type UpdateInput = z.output<typeof UpdateInputSchema>;

/** "room" is the caller's workspace board; without a workspace it is the lobby. */
export function boardFor(
  agent: Pick<ToolAgent, "workspaceId">,
  choice: "room" | "lobby" | "duty" | undefined,
): string {
  if (choice === "duty") return DUTY;
  return choice === "lobby" || agent.workspaceId === null ? LOBBY : agent.workspaceId;
}

/**
 * One post as one entry: its further lines are indented and every name is on one line. `posts`
 * are the boards' posts, which say whether a task still waits on the tasks of its `after`.
 */
export function postLine(
  post: Post,
  label: (author: string) => string,
  teamLabel: (teamId: string) => string = (teamId) => teamId,
  posts: readonly Post[] = [],
): string {
  const name = (author: string) => oneLine(label(author));
  const state = post.state ? ` ${post.state}` : "";
  const claim = post.claimedBy ? ` by ${name(post.claimedBy)}` : "";
  const team = post.team ? ` for team ${oneLine(teamLabel(post.team))}` : "";
  const waiting = waitingOn(post, posts).length > 0 ? " (waiting)" : "";
  const after = post.after?.length ? ` after ${post.after.join(", ")}${waiting}` : "";
  const link = post.link ? ` (${post.board === LOBBY ? "on" : "lobby"} ${post.link})` : "";
  const to = post.to ? ` to ${name(post.to)}` : "";
  const re = post.replyTo ? ` re ${post.replyTo}` : "";
  const needs = post.blocked ? `\n  needs: ${indented(post.blocked)}` : "";
  const result = post.result ? `\n  result: ${indented(post.result)}` : "";
  return `${post.id} ${post.kind}${state}${claim}${team}${after}${link}${re}, from ${name(post.author)}${to}: ${indented(post.text)}${needs}${result}`;
}

export function readText(
  board: string,
  result: ReadResult,
  label: (author: string) => string,
  teamLabel?: (teamId: string) => string,
  posts?: readonly Post[],
): string {
  const more = result.more ? ", more after it" : "";
  const header = `Board ${board}: ${result.posts.length} post(s), cursor ${result.cursor}${more}.`;
  return [header, ...result.posts.map((post) => postLine(post, label, teamLabel, posts))].join(
    "\n",
  );
}

/** Every board's posts: a task can wait on a task of another board. */
function allPosts(service: BoardService): Post[] {
  return Object.values(service.boards()).flat();
}

export function runRead(
  ports: OfficeToolPorts,
  agent: ToolAgent,
  input: ReadInput,
): AgentToolResult {
  ports.seen(agent);
  const board = boardFor(agent, input.board);
  const result = ports.service.read(board, input.since ?? null);
  return {
    text: readText(board, result, ports.label, ports.teamLabel, allPosts(ports.service)),
  };
}

export async function runPost(
  ports: OfficeToolPorts,
  agent: ToolAgent,
  input: PostInput,
): Promise<AgentToolResult> {
  ports.seen(agent);
  // A reply is addressed by the service: its root task's holder, not a `to` of the caller's. With
  // a team, `to` goes as it is, for the service to refuse the pair.
  let to: string | null | undefined;
  if (input.to !== undefined && input.replyTo === undefined)
    to = input.team === undefined ? await ports.resolveAgent(input.to) : input.to;
  if (to === null) return { text: `Unable to post: no agent ${input.to}`, isError: true };
  const result = await ports.service.post({
    board: boardFor(agent, input.board),
    kind: input.kind,
    text: input.text,
    author: agent.id,
    ...(to === undefined ? {} : { to }),
    ...(input.replyTo === undefined ? {} : { replyTo: input.replyTo }),
    ...(input.team === undefined ? {} : { team: input.team }),
    ...(input.after === undefined ? {} : { after: input.after }),
  });
  if (!result.ok) return { text: result.error, isError: true };
  ports.mentioned(result.post);
  const target = result.post.to;
  const wake =
    target !== undefined && target !== agent.id
      ? ` ${oneLine(ports.label(target))} gets it as a prompt when idle and wakes are on.`
      : "";
  const under = result.post.replyTo === undefined ? "" : ` under ${result.post.replyTo}`;
  return {
    text: `Posted ${result.post.id}${under}.${wake}`,
    structuredContent: { id: result.post.id },
  };
}

export async function runUpdate(
  ports: OfficeToolPorts,
  agent: ToolAgent,
  input: UpdateInput,
): Promise<AgentToolResult> {
  ports.seen(agent);
  const result = await ports.service.update({
    id: input.id,
    action: input.action,
    actor: agent.id,
    ...(input.note === undefined ? {} : { note: input.note }),
  });
  if (!result.ok) return { text: result.error, isError: true };
  return {
    text: postLine(result.post, ports.label, ports.teamLabel, allPosts(ports.service)),
  };
}

export function officeTools(ports: OfficeToolPorts): AgentToolDefinition[] {
  return [
    defineAgentTool({
      name: "office_read",
      description:
        "Read your workspace's office board (or board: lobby, or duty for the day's duties). Up to 30 posts, newest last; pass the cursor as since for newer only.",
      input: ReadInputSchema,
      execute: (input, { agent }) => runRead(ports, agent, input),
    }),
    defineAgentTool({
      name: "office_post",
      description:
        "Post a task or note to your workspace's office board (or board: lobby). Set to to an agent id from list_agents to wake it with the post. Set replyTo to a task id to reply under that task; its holder gets the reply. Set team to a roster team's name to give a lobby task to that team. Set after to task ids it must wait for.",
      input: PostInputSchema,
      execute: (input, { agent }) => runPost(ports, agent, input),
    }),
    defineAgentTool({
      name: "office_update",
      description:
        "Claim, finish (done) or reopen a task or a duty on an office board (the duty board too), by post id. With done, put the outcome in note. Block it with note when you need input from the user.",
      input: UpdateInputSchema,
      execute: (input, { agent }) => runUpdate(ports, agent, input),
    }),
  ];
}
