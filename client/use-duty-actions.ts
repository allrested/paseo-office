import { useMemo } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { dutiesSaveRpc, dutyActedRpc, updateRpc } from "../shared/contracts.js";
import type { DutyDraft } from "../shared/duties.js";

export interface DutyActions {
  /** Saves the whole list; rejects with the host's reason. */
  save(duties: DutyDraft[]): Promise<void>;
  markDone(id: string): Promise<void>;
  reopen(id: string): Promise<void>;
  /** The 3D office acted out a pretend duty with this agent's figure. */
  acted(id: string, agentId: string): Promise<void>;
}

/** Each action rejects with the server's message, which ActionButton shows under the button. */
export function useDutyActions(): DutyActions {
  const save = useRpc(dutiesSaveRpc);
  const update = useRpc(updateRpc);
  const acted = useRpc(dutyActedRpc);
  return useMemo(
    (): DutyActions => ({
      async save(duties) {
        const result = await save({
          duties: duties.map((duty) => ({ ...duty, days: [...duty.days] })),
        });
        if (!result.ok) throw new Error(result.error);
      },
      async markDone(id) {
        const result = await update({ id, action: "done" });
        if (!result.ok) throw new Error(result.error);
      },
      async reopen(id) {
        const result = await update({ id, action: "reopen" });
        if (!result.ok) throw new Error(result.error);
      },
      async acted(id, agentId) {
        const result = await acted({ id, agentId });
        if (!result.ok) throw new Error(result.error);
      },
    }),
    [save, update, acted],
  );
}
