import {
  defineAgentTool,
  type AgentToolDefinition,
  type AgentToolResult,
  type PluginHookAgent,
} from "@getpaseo/plugin/server";
import { z } from "zod";
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
});
export type PostInput = z.output<typeof PostInputSchema>;

export const UpdateInputSchema = z.object({ id: z.string().min(1), action: UpdateActionSchema });
export type UpdateInput = z.output<typeof UpdateInputSchema>;

/** "room" is the caller's workspace board; without a workspace it is the lobby. */
export function boardFor(
  agent: Pick<ToolAgent, "workspaceId">,
  choice: "room" | "lobby" | "duty" | undefined,
): string {
  if (choice === "duty") return DUTY;
  return choice === "lobby" || agent.workspaceId === null ? LOBBY : agent.workspaceId;
}

/** One post as one entry: its further lines are indented and every name is on one line. */
export function postLine(post: Post, label: (author: string) => string): string {
  const name = (author: string) => oneLine(label(author));
  const state = post.state ? ` ${post.state}` : "";
  const claim = post.claimedBy ? ` by ${name(post.claimedBy)}` : "";
  const to = post.to ? ` to ${name(post.to)}` : "";
  return `${post.id} ${post.kind}${state}${claim}, from ${name(post.author)}${to}: ${indented(post.text)}`;
}

export function readText(
  board: string,
  result: ReadResult,
  label: (author: string) => string,
): string {
  const more = result.more ? ", more after it" : "";
  const header = `Board ${board}: ${result.posts.length} post(s), cursor ${result.cursor}${more}.`;
  return [header, ...result.posts.map((post) => postLine(post, label))].join("\n");
}

export function runRead(
  ports: OfficeToolPorts,
  agent: ToolAgent,
  input: ReadInput,
): AgentToolResult {
  ports.seen(agent);
  const board = boardFor(agent, input.board);
  return { text: readText(board, ports.service.read(board, input.since ?? null), ports.label) };
}

export async function runPost(
  ports: OfficeToolPorts,
  agent: ToolAgent,
  input: PostInput,
): Promise<AgentToolResult> {
  ports.seen(agent);
  const to = input.to === undefined ? undefined : await ports.resolveAgent(input.to);
  if (to === null) return { text: `Unable to post: no agent ${input.to}`, isError: true };
  const result = await ports.service.post({
    board: boardFor(agent, input.board),
    kind: input.kind,
    text: input.text,
    author: agent.id,
    ...(to === undefined ? {} : { to }),
  });
  if (!result.ok) return { text: result.error, isError: true };
  ports.mentioned(result.post);
  const target = result.post.to;
  const wake =
    target !== undefined && target !== agent.id
      ? ` ${oneLine(ports.label(target))} gets it as a prompt when idle and wakes are on.`
      : "";
  return { text: `Posted ${result.post.id}.${wake}`, structuredContent: { id: result.post.id } };
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
  });
  if (!result.ok) return { text: result.error, isError: true };
  return { text: postLine(result.post, ports.label) };
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
        "Post a task or note to your workspace's office board (or board: lobby). Set to to an agent id from list_agents to wake it with the post.",
      input: PostInputSchema,
      execute: (input, { agent }) => runPost(ports, agent, input),
    }),
    defineAgentTool({
      name: "office_update",
      description:
        "Claim, finish (done) or reopen a task or a duty on an office board (the duty board too), by post id.",
      input: UpdateInputSchema,
      execute: (input, { agent }) => runUpdate(ports, agent, input),
    }),
  ];
}
