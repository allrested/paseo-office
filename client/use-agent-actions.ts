import { useMemo } from "react";
import { usePaseo } from "@getpaseo/plugin/client";
import { extra } from "../shared/host-extras.js";
import type { AskResponse } from "./ask-form.js";
import type { SessionCommand } from "./session-extras.js";

/** What a send may ask for: "steer" joins the running turn, where the daemon interrupts it by default. */
export interface SendOptions {
  activeTurnBehavior?: "steer" | "interrupt";
}

export interface AgentActions {
  send(agentId: string, text: string, options?: SendOptions): Promise<void>;
  respond(agentId: string, requestId: string, allow: boolean): Promise<void>;
  /**
   * The provider's own request behind one the agent waits on, for a plan's text or a question's
   * form; null when the agent no longer waits on it. Absent where requests cannot be read.
   */
  pending?(agentId: string, requestId: string): Promise<unknown>;
  /** Answers a plan or a question with more than yes or no. */
  answer?(agentId: string, requestId: string, response: AskResponse): Promise<void>;
  /** The slash commands and skills the running session lists. Absent where they cannot be read. */
  commands?(agentId: string): Promise<SessionCommand[]>;
  /** The session's own options and how its provider wants them drawn; null for an agent that is gone. */
  controls?(agentId: string): Promise<{ controls: unknown; options: unknown } | null>;
  /** Changes one of the session's options; rejects when the provider cannot apply it live. */
  setOption?(agentId: string, key: string, value: string | boolean): Promise<void>;
  /** Stops the running turn; null where the host's SDK has no cancel(), so no Stop is offered. */
  cancel: ((agentId: string) => Promise<void>) | null;
}

export function useAgentActions(): AgentActions {
  const paseo = usePaseo();
  return useMemo((): AgentActions => {
    // `agents.ref` sends nothing, so a made-up id is enough to ask whether the handle can cancel.
    const canCancel = extra(paseo.agents.ref("probe"), "cancel") !== null;
    return {
      send: (agentId, text, options) =>
        options === undefined
          ? paseo.agents.ref(agentId).send(text)
          : paseo.agents.ref(agentId).send(text, options),
      respond: (agentId, requestId, allow) =>
        paseo.agents.ref(agentId).respondToPermission({
          requestId,
          response: allow ? { behavior: "allow" } : { behavior: "deny" },
        }),
      pending: async (agentId, requestId) => {
        const result = await paseo.agents.ref(agentId).refresh();
        return result?.agent.pendingPermissions.find((request) => request.id === requestId) ?? null;
      },
      answer: (agentId, requestId, response) =>
        paseo.agents.ref(agentId).respondToPermission({ requestId, response }),
      commands: async (agentId) => {
        const { commands, error } = await paseo.agents.ref(agentId).commands();
        if (error !== null && commands.length === 0) throw new Error(error);
        return commands.map(({ name, description }) => ({ name, description }));
      },
      controls: async (agentId) => {
        const result = await paseo.agents.ref(agentId).refresh();
        if (result === null) return null;
        return { controls: result.agent.controls, options: result.agent.options };
      },
      setOption: (agentId, key, value) => paseo.agents.ref(agentId).setOptions({ [key]: value }),
      cancel: canCancel ? (agentId) => extra(paseo.agents.ref(agentId), "cancel")!() : null,
    };
  }, [paseo]);
}
