import { waitingOnOf } from "../shared/model.js";
import type { OfficeSnapshot } from "../shared/contracts.js";
import type { Paseo } from "./paseo-holder.js";

// Several open floors can see the same person leave. Archive once per session and idle period.
export function createDepartureArchiver(read: () => Promise<OfficeSnapshot>) {
  const pending = new Map<string, Promise<boolean>>();

  async function archive(paseo: Paseo, agentId: string, idleSince: string) {
    const { agents } = await read();
    const row = agents.find((agent) => agent.id === agentId);
    if (
      !row ||
      row.status !== "idle" ||
      row.idleSince !== idleSince ||
      row.permissions.length ||
      waitingOnOf(agents).has(agentId)
    )
      return false;
    const ref = paseo.agents.ref(agentId);
    const result = await ref.refresh();
    const agent = result?.agent;
    if (
      !agent ||
      agent.archivedAt ||
      agent.status !== "idle" ||
      agent.pendingPermissions.length ||
      agent.updatedAt !== idleSince
    )
      return false;
    await ref.archive();
    return true;
  }

  return (paseo: Paseo, agentId: string, idleSince: string) => {
    const key = JSON.stringify([agentId, idleSince]);
    const current = pending.get(key);
    if (current) return current;
    const work = archive(paseo, agentId, idleSince).finally(() => pending.delete(key));
    pending.set(key, work);
    return work;
  };
}
