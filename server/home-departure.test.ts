import { expect, test, vi } from "vitest";
import { createDepartureArchiver } from "./home-departure.js";
import { PARENT_AGENT_ID_LABEL, projectAgent, type DirectoryAgentInput } from "./directory.js";
import type { OfficeSnapshot } from "../shared/contracts.js";
import type { Paseo } from "./paseo-holder.js";

const idleSince = "2026-11-19T17:00:00.000Z";
const record: DirectoryAgentInput = {
  id: "departing",
  title: "Session",
  provider: "codex",
  model: null,
  createdAt: idleSince,
  updatedAt: idleSince,
  status: "idle",
  pendingPermissions: [],
};

function setup(child?: DirectoryAgentInput) {
  let current = { ...record };
  const archive = vi.fn(async () => {
    current = { ...current, archivedAt: idleSince };
  });
  const ref = vi.fn(() => ({ refresh: async () => ({ agent: current }), archive }));
  const paseo = { agents: { ref } } as unknown as Paseo;
  const read = async () =>
    ({
      agents: [record, ...(child ? [child] : [])].map((a) => projectAgent(a)!),
    }) as OfficeSnapshot;
  const report = createDepartureArchiver(read);
  return {
    archive,
    ref,
    depart: () => report(paseo, record.id, idleSince),
    change: (patch: Partial<DirectoryAgentInput>) => {
      current = { ...current, ...patch };
    },
    reopen: () => projectAgent(current),
  };
}

test("two floors archive only the departed session and it stays out of a newly opened directory", async () => {
  const f = setup();
  await expect(Promise.all([f.depart(), f.depart()])).resolves.toEqual([true, true]);
  expect(f.ref).toHaveBeenCalledWith(record.id);
  expect(f.archive).toHaveBeenCalledTimes(1);
  expect(f.reopen()).toBeNull();
  await expect(f.depart()).resolves.toBe(false);
});

test("work resuming or a newer idle period supersedes the departure", async () => {
  const f = setup();
  f.change({ status: "running" });
  await expect(f.depart()).resolves.toBe(false);
  f.change({ status: "idle", pendingPermissions: [{ id: "p", name: "Shell", kind: "tool" }] });
  await expect(f.depart()).resolves.toBe(false);
  f.change({ status: "idle", pendingPermissions: [], updatedAt: "2026-11-19T18:00:00.000Z" });
  await expect(f.depart()).resolves.toBe(false);
  expect(f.archive).not.toHaveBeenCalled();
});

test("an idle parent stays while its child is working", async () => {
  const f = setup({
    ...record,
    id: "child",
    status: "running",
    labels: { [PARENT_AGENT_ID_LABEL]: record.id },
  });
  await expect(f.depart()).resolves.toBe(false);
  expect(f.archive).not.toHaveBeenCalled();
});
