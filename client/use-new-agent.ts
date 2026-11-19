import { useCallback, useEffect, useState } from "react";
import { usePaseo, useSettings } from "@getpaseo/plugin/client";
import type { PaseoApi } from "@getpaseo/client";
import { officeDeviceSettings } from "../shared/settings.js";
import { failureText } from "./action-button.js";
import {
  newAgentProblem,
  providerOptions,
  startingAgent,
  workspaceOptions,
  type LastAgent,
  type NewAgentChoice,
  type ProviderOption,
  type WorkspaceOption,
} from "./new-agent-model.js";

/** Workspaces come 200 at a time; a host with more than this many pages is not read further. */
const WORKSPACE_PAGES = 10;
const PAGE_SIZE = 200;

interface Loaded {
  status: "loading" | "ready" | "error";
  error: string | null;
  workspaces: WorkspaceOption[];
  providers: ProviderOption[];
}

const LOADING: Loaded = { status: "loading", error: null, workspaces: [], providers: [] };

async function readWorkspaces(paseo: PaseoApi): Promise<WorkspaceOption[]> {
  const all: WorkspaceOption[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < WORKSPACE_PAGES; page += 1) {
    const result = await paseo.workspaces.list({
      page: cursor === undefined ? { limit: PAGE_SIZE } : { limit: PAGE_SIZE, cursor },
    });
    all.push(...workspaceOptions(result.entries));
    if (!result.pageInfo.hasMore || result.pageInfo.nextCursor === null) break;
    cursor = result.pageInfo.nextCursor;
  }
  return all;
}

export interface NewAgent extends Loaded {
  retry(): void;
  chooseProvider(provider: string): void;
  /** Starts the agent and, once it exists, keeps the choice on the device. Throws the failure. */
  create(): Promise<string>;
}

interface NewAgentInput {
  choice: NewAgentChoice;
  change(patch: Partial<NewAgentChoice>): void;
}

/**
 * The form's host side: reads the workspaces and providers when it mounts, fills in the provider
 * and model the choice lacks, and creates the agent. The choice itself is the caller's, so it
 * outlives the form.
 */
export function useNewAgent({ choice, change }: NewAgentInput): NewAgent {
  const paseo = usePaseo();
  const device = useSettings(officeDeviceSettings);
  const [loaded, setLoaded] = useState(LOADING);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setLoaded(LOADING);
    Promise.all([readWorkspaces(paseo), paseo.providers.waitForReady()]).then(
      ([workspaces, snapshot]) => {
        if (!current) return undefined;
        const providers = providerOptions(snapshot.entries);
        setLoaded({ status: "ready", error: null, workspaces, providers });
        return undefined;
      },
      (failure: unknown) => {
        if (!current) return;
        setLoaded({
          ...LOADING,
          status: "error",
          error: failureText("Read workspaces and providers", failure),
        });
      },
    );
    return () => {
      current = false;
    };
  }, [paseo, attempt]);

  // The device's last choice decides the start, so a start waits for the setting to be read.
  const last = device.status === "ready" ? (device.values.lastAgent ?? null) : null;
  const settingRead = device.status !== "loading";
  const { providers } = loaded;
  const chosen = providers.find((entry) => entry.id === choice.provider);
  const stillOffered = chosen?.models.some((model) => model.id === choice.model) === true;
  useEffect(() => {
    if (loaded.status !== "ready" || !settingRead || stillOffered) return;
    change(startingAgent(providers, last));
  }, [loaded.status, settingRead, stillOffered, providers, last, change]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);
  const chooseProvider = useCallback(
    (provider: string) =>
      change(
        startingAgent(
          providers.filter((entry) => entry.id === provider),
          null,
        ),
      ),
    [providers, change],
  );
  const { save } = device;
  const revision = device.status === "ready" ? device.revision : null;
  const values = device.status === "ready" ? device.values : null;
  const create = useCallback(async (): Promise<string> => {
    const problem = newAgentProblem(choice);
    const workspace = loaded.workspaces.find((entry) => entry.id === choice.workspaceId);
    if (problem !== null || workspace === undefined)
      throw new Error(problem ?? "Choose a workspace.");
    const { provider, model } = choice;
    const handle = await paseo.agents.create({
      cwd: workspace.directory,
      config: { provider: `${provider}/${model}` },
      prompt: choice.prompt.trim(),
    });
    if (revision !== null && values !== null && provider !== null && model !== null) {
      const lastAgent: LastAgent = { provider, model };
      // The agent exists: a choice the device could not keep is not a failure to report.
      await save({ ...values, lastAgent }, revision);
    }
    return handle.id;
  }, [paseo, choice, loaded.workspaces, save, revision, values]);
  return { ...loaded, retry, chooseProvider, create };
}
