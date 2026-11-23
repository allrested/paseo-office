import {
  memberOf,
  teamOf,
  type Roster,
  type RosterMark,
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

/**
 * Not looked at yet: no mark, or passed over at an edition before this one. An id, even of a
 * team or teammate since deleted, is a look that was had: its holder is offered no other.
 */
function open(mark: RosterMark | undefined, edition: number): boolean {
  return mark === undefined || (typeof mark === "number" && mark < edition);
}

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
 * not looked at yet, oldest first, take the first team no listed workspace holds; agents of a
 * workspace with a team, oldest first, take its first teammate no listed agent there holds. One
 * the roster has nothing left for gets the edition, so a name freed later goes to a new one and
 * never to it. Every workspace's write comes before any agent's. Nothing when the roster is off.
 */
export function planRoster(
  roster: Roster,
  workspaces: readonly RosterWorkspace[],
  agents: readonly RosterAgent[],
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
  const held = new Set<string>();
  for (const workspace of ordered) {
    const team = teamOf(roster, workspace.roster);
    if (team === null) continue;
    teams.set(workspace.id, team);
    held.add(team.id);
  }
  for (const workspace of ordered) {
    if (!open(workspace.roster, roster.edition)) continue;
    const team = roster.teams.find((candidate) => !held.has(candidate.id));
    writes.push({ kind: "workspace", id: workspace.id, mark: team?.id ?? roster.edition });
    if (team === undefined) continue;
    teams.set(workspace.id, team);
    held.add(team.id);
  }
  for (const workspace of ordered) {
    const team = teams.get(workspace.id);
    if (team === undefined) continue;
    const own = oldestFirst(members.get(workspace.id) ?? [], (agent) => agent.createdAt);
    const taken = new Set<string>();
    for (const agent of own) {
      const member = memberOf(team, agent.roster);
      if (member !== null) taken.add(member.id);
    }
    for (const agent of own) {
      if (!open(agent.roster, roster.edition)) continue;
      const member = team.members.find((candidate) => !taken.has(candidate.id));
      writes.push({ kind: "agent", id: agent.id, mark: member?.id ?? roster.edition });
      if (member !== undefined) taken.add(member.id);
    }
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
