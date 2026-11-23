import { z } from "zod";
import type { OfficeAgent } from "./contracts.js";
import { agentTitle } from "./model.js";

/** A checkout with work nobody has finished: files not committed, commits on no remote, a stash. */
export const ForgottenSchema = z.object({
  /** The team's name, or the folder's for a worktree no workspace has. */
  name: z.string(),
  /** Null for a worktree no workspace has. */
  workspaceId: z.string().nullable(),
  changed: z.number(),
  unpushed: z.number(),
  stashes: z.number(),
});
export type Forgotten = z.output<typeof ForgottenSchema>;

function count(n: number, one: string, many: string): string | null {
  if (n === 0) return null;
  return `${n} ${n === 1 ? one : many}`;
}

/** "3 changed files, 2 unpushed commits, 1 stash". */
export function forgottenText(item: Forgotten): string {
  return [
    count(item.changed, "changed file", "changed files"),
    count(item.unpushed, "unpushed commit", "unpushed commits"),
    count(item.stashes, "stash", "stashes"),
  ]
    .filter((part) => part !== null)
    .join(", ");
}

export interface CoordinatorModels {
  id: string;
  name: string;
  /** Null when its provider names no model. */
  model: string | null;
  /** Its sub-agents by model, the most used first. */
  subs: { model: string; count: number }[];
}

/** Each agent that has sub-agents, with its model and the models they run on. */
export function coordinatorModels(agents: readonly OfficeAgent[]): CoordinatorModels[] {
  const byParent = new Map<string, Map<string, number>>();
  for (const agent of agents) {
    if (agent.parentAgentId === null || agent.status === "closed") continue;
    const models = byParent.get(agent.parentAgentId) ?? new Map<string, number>();
    const model = agent.model ?? "an unnamed model";
    models.set(model, (models.get(model) ?? 0) + 1);
    byParent.set(agent.parentAgentId, models);
  }
  const coordinators: CoordinatorModels[] = [];
  for (const agent of agents) {
    const models = byParent.get(agent.id);
    if (models === undefined) continue;
    coordinators.push({
      id: agent.id,
      name: agentTitle(agent),
      model: agent.model,
      subs: [...models]
        .map(([model, n]) => ({ model, count: n }))
        .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model)),
    });
  }
  return coordinators;
}

/** "2 on sonnet, 1 on haiku". */
export function subModelsText(subs: CoordinatorModels["subs"]): string {
  return subs.map((sub) => `${sub.count} on ${sub.model}`).join(", ");
}
