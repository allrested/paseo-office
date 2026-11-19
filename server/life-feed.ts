import type { LifeEvent } from "../shared/contracts.js";
import type { DirectoryView } from "./hub.js";
import type { Tenure } from "./tenure.js";

type Snapshot = Omit<LifeEvent, "type">;
export function createLifeFeed(deps: {
  tenure: Tenure;
  age(folder: string): Promise<string | null>;
  lift: { pub(now: number): LifeEvent["lift"] };
  days(): { days: number; choices: number[] };
  now(): number;
  emit(snapshot: Snapshot): void;
}) {
  const teams = new Map<string, string>();
  const live = new Set<string>();
  const ages = new Map<string, string | null>();
  const pending = new Map<string, Promise<void>>();
  const folderTeams = new Map<string, Set<string>>();
  let connected = false;
  let queuedAge = Promise.resolve();
  function snapshot(): Snapshot {
    const born = new Map<string, string>();
    // Map insertion order keeps the first answer when workspaces share a team name.
    for (const [folder, date] of ages) {
      if (!date) continue;
      for (const name of folderTeams.get(folder) ?? []) if (!born.has(name)) born.set(name, date);
    }
    return {
      born: Object.fromEntries(born),
      tenure: { ...deps.days(), projects: deps.tenure.list(live) },
      lift: deps.lift.pub(deps.now()),
    };
  }
  let previous = "";
  function changed() {
    const next = snapshot();
    // Streaming timestamps and counters would redraw the floor on each directory pulse.
    // The scenes act on transitions. A new subscriber still gets the full current ledger.
    const projects = next.tenure.projects
      .map((p) =>
        JSON.stringify([p.name, p.due, p.farewell, p.back, p.intern, p.ready, p.official]),
      )
      .sort();
    const key = JSON.stringify([next.born, projects, { ...next.lift, left: next.lift.left > 0 }]);
    if (key !== previous) {
      previous = key;
      deps.emit(next);
    }
  }
  async function readAge(folder: string) {
    try {
      ages.set(folder, await deps.age(folder));
      changed();
    } catch {
      ages.set(folder, null);
    } finally {
      pending.delete(folder);
    }
  }
  function readFolders(view: DirectoryView, names: ReadonlyMap<string, string>) {
    for (const [id, folder] of Object.entries(view.folders ?? {})) {
      const name = names.get(id);
      if (!name) continue;
      const atFolder = folderTeams.get(folder) ?? new Set<string>();
      atFolder.add(name);
      folderTeams.set(folder, atFolder);
      if (ages.has(folder) || pending.has(folder)) continue;
      queuedAge = queuedAge.then(() => readAge(folder));
      pending.set(folder, queuedAge);
    }
  }
  return {
    snapshot,
    async settled() {
      await Promise.all(pending.values());
    },
    view(view: DirectoryView | null) {
      live.clear();
      teams.clear();
      folderTeams.clear();
      connected = !!view;
      if (!view) {
        changed();
        return;
      }
      const names = new Map(view.workspaces.map((w) => [w.id, w.name]));
      const at = deps.now();
      const today = new Date(at).toDateString();
      const seeds = new Map(
        [...names.values()].map((name) => [name, { first: at, days: new Set([today]) }]),
      );
      const agents = new Map(view.agents.map((a) => [a.id, a]));
      const active = new Set<string>();
      for (const agent of view.agents) {
        let parent = agent;
        const visited = new Set<string>();
        while (parent.parentAgentId && !visited.has(parent.id)) {
          visited.add(parent.id);
          const next = agents.get(parent.parentAgentId);
          if (!next) break;
          parent = next;
        }
        const name = names.get(agent.workspaceId ?? "") ?? names.get(parent.workspaceId ?? "");
        if (!name) continue;
        teams.set(agent.id, name);
        if (agent.status === "closed") continue;
        live.add(name);
        if (agent.status !== "idle") active.add(name);
        const seed = seeds.get(name),
          first = Date.parse(agent.createdAt);
        if (seed && Number.isFinite(first)) {
          seed.first = Math.min(seed.first, first);
          seed.days.add(new Date(first).toDateString());
        }
      }
      // The directory tells its agents first and its workspaces after: a ledger seeded before
      // the workspaces would hold nobody, and every team already there would come in as an intern.
      if (view.workspaces.length > 0 && !deps.tenure.seeded())
        deps.tenure.seed(
          [...seeds].map(([name, s]) => ({ name, first: s.first, daysSeen: s.days.size })),
        );
      for (const name of active) deps.tenure.touch(name, { at });
      readFolders(view, names);
      changed();
    },
    async turnEnded(id: string, lookup?: () => Promise<string | null>) {
      const name = teams.get(id) ?? (await lookup?.());
      if (name) {
        deps.tenure.touch(name, { at: deps.now(), turn: true });
        changed();
      }
    },
    write({ op, name }: { op: "official" | "farewell"; name: string }) {
      const ok =
        connected &&
        (op === "official"
          ? deps.tenure.markOfficial(name)
          : deps.tenure.markFarewell(name, live.has(name)));
      if (ok) changed();
      return { ok };
    },
  };
}
