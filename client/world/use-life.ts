import { useCallback } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { chatRpc } from "../../shared/contracts.js";

export interface LifeState {
  /** A moment of the office's life for the team chat: the server words it. */
  say(kind: string, vars: Record<string, string>): void;
}

/** The 3D office's staff scenes, as the plugin's server hears from them. */
export function useLife(): LifeState {
  const chat = useRpc(chatRpc);
  // Neither waits nor reports: a line that does not arrive is a moment the chat does not tell.
  const say = useCallback(
    (kind: string, vars: Record<string, string>) => {
      void chat({ op: "life", kind, vars }).catch(() => undefined);
    },
    [chat],
  );
  return { say };
}
