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
    const next = snapshot(),
      key = JSON.stringify([next.born, next.tenure]);
    if (key !== previous) {
      previous = key;
      deps.emit(next);
    }
  }
  async function readAge(folder: string) {
    try {
      ages.set(folder, await deps.age(folder));
      changed();
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
      pending.set(folder, readAge(folder));
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
        const name = names.get(parent.workspaceId ?? "") ?? names.get(agent.workspaceId ?? "");
        if (!name) continue;
        teams.set(agent.id, name);
        if (agent.status !== "closed") live.add(name);
        if (agent.status === "running" || agent.status === "initializing") active.add(name);
        const seed = seeds.get(name),
          first = Date.parse(agent.createdAt);
        if (seed && Number.isFinite(first)) {
          seed.first = Math.min(seed.first, first);
          seed.days.add(new Date(first).toDateString());
        }
      }
      if (!deps.tenure.seeded())
        deps.tenure.seed(
          [...seeds].map(([name, s]) => ({ name, first: s.first, daysSeen: s.days.size })),
        );
      for (const name of active) deps.tenure.touch(name, { at });
      readFolders(view, names);
      changed();
    },
    turnEnded(id: string) {
      const name = teams.get(id);
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
