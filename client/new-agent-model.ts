import type { AgentModelDefinition, ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import type { PaseoWorkspace } from "@getpaseo/client";

export interface NewAgentChoice {
  workspaceId: string | null;
  provider: string | null;
  model: string | null;
  prompt: string;
}

export interface WorkspaceOption {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  /** The folder an agent started in this workspace runs in. */
  directory: string;
}

export interface WorkspaceGroup {
  projectId: string;
  projectName: string;
  workspaces: WorkspaceOption[];
}

export interface ModelOption {
  id: string;
  label: string;
  isDefault: boolean;
}

export interface ProviderOption {
  id: string;
  label: string;
  models: ModelOption[];
}

/** The provider and model kept on the device from the last agent started here. */
export interface LastAgent {
  provider: string;
  model: string;
}

/** Why Create is not offered yet; null when the form can be sent. */
export function newAgentProblem(choice: NewAgentChoice): string | null {
  if (choice.workspaceId === null) return "Choose a workspace.";
  if (choice.provider === null) return "Choose a provider.";
  if (choice.model === null) return "Choose a model.";
  if (choice.prompt.trim() === "") return "Write the first prompt.";
  return null;
}

const byName = (a: string, b: string): number =>
  a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b);

/** Workspaces grouped by project, each group and each list in name order, filtered by a search. */
export function workspaceGroups(
  workspaces: readonly WorkspaceOption[],
  query: string,
): WorkspaceGroup[] {
  const needle = query.trim().toLowerCase();
  const groups = new Map<string, WorkspaceGroup>();
  for (const workspace of workspaces) {
    const matches =
      needle === "" ||
      workspace.name.toLowerCase().includes(needle) ||
      workspace.projectName.toLowerCase().includes(needle);
    if (!matches) continue;
    const group = groups.get(workspace.projectId) ?? {
      projectId: workspace.projectId,
      projectName: workspace.projectName,
      workspaces: [],
    };
    group.workspaces.push(workspace);
    groups.set(workspace.projectId, group);
  }
  const sorted = [...groups.values()].sort((a, b) => byName(a.projectName, b.projectName));
  // The groups are this function's own: their lists are sorted where they are.
  for (const group of sorted) group.workspaces.sort((a, b) => byName(a.name, b.name));
  return sorted;
}

function defaultModel(models: readonly ModelOption[]): string | null {
  return (models.find((model) => model.isDefault) ?? models[0])?.id ?? null;
}

/**
 * The provider and model to start with: the last choice if it is still offered, else the first
 * provider that has a model and its default model. A provider with no model is never the start.
 */
export function startingAgent(
  providers: readonly ProviderOption[],
  last: LastAgent | null,
): { provider: string | null; model: string | null } {
  const kept = providers.find((entry) => entry.id === last?.provider);
  if (kept !== undefined && kept.models.some((model) => model.id === last?.model)) {
    return { provider: kept.id, model: last?.model ?? null };
  }
  const first = providers.find((entry) => entry.models.length > 0);
  if (first === undefined) return { provider: null, model: null };
  return { provider: first.id, model: defaultModel(first.models) };
}

function modelOption(model: AgentModelDefinition): ModelOption {
  return { id: model.id, label: model.label, isDefault: model.isDefault === true };
}

/** The providers a new agent can run on: ready and enabled, with the models that can be chosen. */
export function providerOptions(entries: readonly ProviderSnapshotEntry[]): ProviderOption[] {
  return entries
    .filter((entry) => entry.status === "ready" && entry.enabled)
    .map((entry) => ({
      id: entry.provider,
      label: entry.label ?? entry.provider,
      models: (entry.models ?? []).filter((model) => model.isSelectable !== false).map(modelOption),
    }));
}

/** The workspaces an agent can start in: not being archived, each with the folder it runs in. */
export function workspaceOptions(workspaces: readonly PaseoWorkspace[]): WorkspaceOption[] {
  return workspaces
    .filter((workspace) => !workspace.archivingAt)
    .map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      projectId: workspace.projectId,
      projectName: workspace.projectDisplayName,
      directory: workspace.workspaceDirectory ?? workspace.projectRootPath,
    }));
}

/** A form with nothing chosen. */
export const EMPTY_CHOICE: NewAgentChoice = {
  workspaceId: null,
  provider: null,
  model: null,
  prompt: "",
};
