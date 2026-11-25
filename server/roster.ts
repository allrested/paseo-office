import {
  memberOf,
  teamOf,
  type Roster,
  type RosterMark,
  type RosterMember,
  type RosterTeam,
} from "../shared/roster.js";

export interface RosterWorkspace {
  id: string;
  /** Absent on a host that does not say when a workspace was made. */
  createdAt?: string;
  roster?: RosterMark;
}

export interface RosterAgent {
  id: string;
  workspaceId: string | null;
  createdAt: string;
  roster?: RosterMark;
}

export interface RosterWrite {
  kind: "workspace" | "agent";
  id: string;
  mark: RosterMark;
}

/** Which of a team's free teammates the next agent takes; `free` is never empty. */
export type PickMember = (free: readonly RosterMember[]) => RosterMember;

/** The first in the settings' order: what the planner does when it is told no other way. */
export const firstFree: PickMember = (free) => free[0];

/** One of the free teammates by chance, from a number in [0, 1) such as Math.random gives. */
export function byChance(random: () => number): PickMember {
  return (free) => free[Math.min(free.length - 1, Math.floor(random() * free.length))];
}

/**
 * Not looked at yet: no mark, or passed over at an edition before this one. An id, even of a
 * team or teammate since deleted, is a look that was had: its holder is offered no other.
 */
function open(mark: RosterMark | undefined, edition: number): boolean {
  return mark === undefined || (typeof mark === "number" && mark < edition);
}

/** An id that names nothing here any more: its holder is passed over at this edition. */
const lost = (mark: RosterMark | undefined, found: unknown): boolean =>
  typeof mark === "string" && found === null;

function oldestFirst<Entry extends { id: string }>(
  entries: readonly Entry[],
  madeAt: (entry: Entry) => string | undefined,
): Entry[] {
  // No time sorts last: "￿" is after every ISO date.
  const key = (entry: Entry) => madeAt(entry) ?? "￿";
  return [...entries].sort(
    (left, right) => key(left).localeCompare(key(right)) || left.id.localeCompare(right.id),
  );
}

function agentsByWorkspace(agents: readonly RosterAgent[]): Map<string, RosterAgent[]> {
  const byWorkspace = new Map<string, RosterAgent[]>();
  for (const agent of agents) {
    if (agent.workspaceId === null) continue;
    byWorkspace.set(agent.workspaceId, [...(byWorkspace.get(agent.workspaceId) ?? []), agent]);
  }
  return byWorkspace;
}

/**
 * The metadata to write so every workspace and agent the roster can name has a mark. Workspaces
 * that hold no team, oldest first, take the team the fewest listed workspaces hold, the first in
 * the settings' order among equals: a team is shared once every team is held, so no workspace
 * goes without one while the roster has a team. Agents of a workspace with a team, oldest first,
 * take one of its teammates no listed agent there holds: the one `pick` chooses among them, the
 * first in order unless told otherwise. An agent the team has nobody left for gets the edition,
 * so a name freed later goes to a new one and never to it, and so does a workspace when the
 * roster has no team at all. An id that no longer names a teammate of the workspace's team is
 * written over with the edition: its holder is passed over, and only a longer roster reaches it.
 * Every workspace's write comes before any agent's. Nothing when the roster is off.
 */
export function planRoster(
  roster: Roster,
  workspaces: readonly RosterWorkspace[],
  agents: readonly RosterAgent[],
  pick: PickMember = firstFree,
): RosterWrite[] {
  if (!roster.on) return [];
  const members = agentsByWorkspace(agents);
  const oldestAgent = (workspace: RosterWorkspace) =>
    oldestFirst(members.get(workspace.id) ?? [], (agent) => agent.createdAt)[0]?.createdAt;
  const ordered = oldestFirst(
    workspaces,
    (workspace) => workspace.createdAt ?? oldestAgent(workspace),
  );
  const writes: RosterWrite[] = [];
  const teams = new Map<string, RosterTeam>();
  const holders = new Map<string, number>(roster.teams.map((team) => [team.id, 0]));
  const take = (workspace: RosterWorkspace, team: RosterTeam) => {
    teams.set(workspace.id, team);
    holders.set(team.id, (holders.get(team.id) ?? 0) + 1);
  };
  for (const workspace of ordered) {
    const team = teamOf(roster, workspace.roster);
    if (team !== null) take(workspace, team);
  }
  for (const workspace of ordered) {
    if (teams.has(workspace.id)) continue;
    // The first of the least held: reduce keeps the earlier team on a tie.
    const team = roster.teams.reduce<RosterTeam | undefined>(
      (least, candidate) =>
        least === undefined || holders.get(candidate.id)! < holders.get(least.id)!
          ? candidate
          : least,
      undefined,
    );
    if (team === undefined) {
      // No team at all: the mark says it was looked at, and the first team reaches it.
      if (open(workspace.roster, roster.edition) || typeof workspace.roster === "string")
        writes.push({ kind: "workspace", id: workspace.id, mark: roster.edition });
      continue;
    }
    writes.push({ kind: "workspace", id: workspace.id, mark: team.id });
    take(workspace, team);
  }
  for (const workspace of ordered) {
    const team = teams.get(workspace.id);
    if (team === undefined) continue;
    const own = oldestFirst(members.get(workspace.id) ?? [], (agent) => agent.createdAt);
    writes.push(...planMembers(team, own, roster.edition, pick));
  }
  return writes;
}

/** The writes for the agents of one workspace with a team, oldest first. */
function planMembers(
  team: RosterTeam,
  own: readonly RosterAgent[],
  edition: number,
  pick: PickMember,
): RosterWrite[] {
  const writes: RosterWrite[] = [];
  const taken = new Set<string>();
  for (const agent of own) {
    const member = memberOf(team, agent.roster);
    if (member !== null) taken.add(member.id);
  }
  for (const agent of own) {
    if (lost(agent.roster, memberOf(team, agent.roster))) {
      writes.push({ kind: "agent", id: agent.id, mark: edition });
      continue;
    }
    if (!open(agent.roster, edition)) continue;
    const free = team.members.filter((candidate) => !taken.has(candidate.id));
    if (free.length === 0) {
      writes.push({ kind: "agent", id: agent.id, mark: edition });
      continue;
    }
    const member = pick(free);
    writes.push({ kind: "agent", id: agent.id, mark: member.id });
    taken.add(member.id);
  }
  return writes;
}

/** The roster's name for each workspace and agent whose stored mark still names one. */
export function rosterNames(
  roster: Roster,
  workspaces: readonly RosterWorkspace[],
  agents: readonly RosterAgent[],
): { teams: Map<string, string>; members: Map<string, string> } {
  const byWorkspace = new Map<string, RosterTeam>();
  const teams = new Map<string, string>();
  for (const workspace of workspaces) {
    const team = teamOf(roster, workspace.roster);
    if (team === null) continue;
    byWorkspace.set(workspace.id, team);
    teams.set(workspace.id, team.name);
  }
  const members = new Map<string, string>();
  for (const agent of agents) {
    if (agent.workspaceId === null) continue;
    const member = memberOf(byWorkspace.get(agent.workspaceId) ?? null, agent.roster);
    if (member !== null) members.set(agent.id, member.name);
  }
  return { teams, members };
}
