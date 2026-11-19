// What the staff scenes read beyond the people, kept on the server: each team's repository's first
// day, the tenure list, the lift's servicing. A team is a workspace, by its name, as the 3D view
// seats it (client/world/adapter.ts). No file name, command or prompt is in it: a workspace's
// folder is read here to ask git, and never leaves the server.
import type { OfficeAgent } from "../shared/contracts.js";
import type { DirectoryView } from "./hub.js";
import type { LiftInfo } from "./lift-service.js";
import { FAREWELL_DAYS, dayOf, type SeedTeam, type Tenure, type TenureProject } from "./tenure.js";

export interface LifeSnapshot {
  /** Team name -> the day of its repository's first commit, "YYYY-MM-DD". */
  born: Record<string, string>;
  tenure: { days: number; choices: number[]; projects: TenureProject[] };
  lift: LiftInfo;
}

export interface LifeFeedDeps {
  tenure: Tenure;
  /** The day of the first commit of the repository in this folder; null when git cannot say. */
  age(folder: string): Promise<string | null>;
  lift: { pub(at: number): LiftInfo };
  now(): number;
  /** Something the scenes read changed; the snapshot as it is now. */
  emit(snapshot: LifeSnapshot): void;
}

export interface LifeFeed {
  view(view: DirectoryView | null): void;
  turnEnded(agentId: string): void;
  write(op: { op: "farewell" | "official"; name: string }): { ok: boolean };
  snapshot(): LifeSnapshot;
  /** Resolves once the ages being read now are in. */
  settled(): Promise<void>;
}

const at = (iso: string): number => Date.parse(iso);

export function createLifeFeed(deps: LifeFeedDeps): LifeFeed {
  let last: DirectoryView | null = null;
  const born: Record<string, string> = {};
  const asked = new Set<string>();
  const reading = new Set<Promise<void>>();
  // One git at a time: a host has as many folders as it has workspaces.
  let queue: Promise<void> = Promise.resolve();
  let sent = "";

  function teamOf(view: DirectoryView, agent: OfficeAgent | undefined): string | null {
    if (agent === undefined) return null;
    const own = agent.workspaceId ?? null;
    const id =
      own ?? view.agents.find((other) => other.id === agent.parentAgentId)?.workspaceId ?? null;
    return view.workspaces.find((workspace) => workspace.id === id)?.name ?? null;
  }
  const open = (view: DirectoryView) => view.agents.filter((agent) => agent.status !== "closed");
  function liveTeams(): Set<string> {
    if (last === null) return new Set();
    const view = last;
    return new Set(open(view).flatMap((agent) => teamOf(view, agent) ?? []));
  }

  function snapshot(): LifeSnapshot {
    return {
      born: { ...born },
      tenure: {
        days: FAREWELL_DAYS,
        choices: [FAREWELL_DAYS],
        projects: deps.tenure.list(liveTeams()),
      },
      lift: deps.lift.pub(deps.now()),
    };
  }
  // Told again only when something but the lift's countdown changed.
  function changed(): void {
    const now = snapshot();
    const key = JSON.stringify({ ...now, lift: { ...now.lift, left: now.lift.left > 0 } });
    if (key === sent) return;
    sent = key;
    deps.emit(now);
  }

  function seed(view: DirectoryView): void {
    const teams = new Map<string, { first: number; days: Set<string> }>();
    for (const agent of open(view)) {
      const team = teamOf(view, agent);
      const created = at(agent.createdAt);
      if (team === null || !Number.isFinite(created)) continue;
      const seen = teams.get(team) ?? { first: created, days: new Set([dayOf(deps.now())]) };
      seen.first = Math.min(seen.first, created);
      seen.days.add(dayOf(created));
      teams.set(team, seen);
    }
    const list: SeedTeam[] = [...teams].map(([name, seen]) => ({
      name,
      first: seen.first,
      daysSeen: seen.days.size,
    }));
    deps.tenure.seed(list);
  }

  async function readAge(folder: string, team: string): Promise<void> {
    const day = await deps.age(folder);
    if (day === null || Object.hasOwn(born, team)) return;
    born[team] = day;
    changed();
  }
  function readAges(view: DirectoryView): void {
    for (const workspace of view.workspaces) {
      const folder = view.folders?.[workspace.id];
      if (folder === undefined || asked.has(folder)) continue;
      asked.add(folder);
      const { name } = workspace;
      queue = queue.then(() => readAge(folder, name));
      const read = queue.finally(() => reading.delete(read));
      reading.add(read);
    }
  }

  return {
    view(view) {
      last = view;
      if (view === null) return;
      if (!deps.tenure.seeded()) seed(view);
      const working = new Set(
        open(view)
          .filter((agent) => agent.status !== "idle")
          .flatMap((agent) => teamOf(view, agent) ?? []),
      );
      for (const team of working) deps.tenure.touch(team, { at: deps.now() });
      readAges(view);
      changed();
    },
    turnEnded(agentId) {
      if (last === null) return;
      const team = teamOf(
        last,
        last.agents.find((agent) => agent.id === agentId),
      );
      if (team === null) return;
      deps.tenure.touch(team, { at: deps.now(), turn: true });
      changed();
    },
    write(op) {
      const ok =
        op.op === "farewell"
          ? deps.tenure.markFarewell(op.name, liveTeams().has(op.name))
          : deps.tenure.markOfficial(op.name);
      if (ok) changed();
      return { ok };
    },
    snapshot,
    async settled() {
      await Promise.all(reading);
    },
  };
}
