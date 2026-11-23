import type { OfficeAgent, OfficeWorkspace } from "../shared/contracts.js";
import { tidyMemberName, type RosterTeam } from "../shared/roster.js";
import { tidyTeamName } from "../shared/team-name.js";

/** The Teams section's setting, as its failure is reported. */
export const TEAMS_LABEL = "Teams";

/** An id for a new team ("t") or teammate ("m"): never shown, only stored. */
export function newId(prefix: "t" | "m"): string {
  return `${prefix}${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
}

/** `<word> <n>` for the first n from `from` that no name in `taken` has. */
function freeName(word: string, from: number, taken: readonly string[]): string {
  const lower = new Set(taken.map((name) => name.toLowerCase()));
  let number = from;
  while (lower.has(`${word} ${number}`.toLowerCase())) number += 1;
  return `${word} ${number}`;
}

export function addTeam(teams: readonly RosterTeam[], id: string): RosterTeam[] {
  const name = freeName(
    "Team",
    teams.length + 1,
    teams.map((team) => team.name),
  );
  return [...teams, { id, name, members: [] }];
}

function inTeam(
  teams: readonly RosterTeam[],
  teamId: string,
  change: (team: RosterTeam) => RosterTeam,
): RosterTeam[] {
  return teams.map((team) => (team.id === teamId ? change(team) : team));
}

export function addMember(teams: readonly RosterTeam[], teamId: string, id: string): RosterTeam[] {
  return inTeam(teams, teamId, (team) => ({
    ...team,
    members: [
      ...team.members,
      {
        id,
        name: freeName(
          "Teammate",
          team.members.length + 1,
          team.members.map((member) => member.name),
        ),
      },
    ],
  }));
}

/** An empty name changes nothing: the roster has no nameless team. */
export function renameTeam(teams: readonly RosterTeam[], teamId: string, name: string) {
  const next = tidyTeamName(name);
  return next === "" ? [...teams] : inTeam(teams, teamId, (team) => ({ ...team, name: next }));
}

export function renameMember(
  teams: readonly RosterTeam[],
  teamId: string,
  memberId: string,
  name: string,
): RosterTeam[] {
  const next = tidyMemberName(name);
  if (next === "") return [...teams];
  return inTeam(teams, teamId, (team) => ({
    ...team,
    members: team.members.map((member) =>
      member.id === memberId ? { ...member, name: next } : member,
    ),
  }));
}

export function removeTeam(teams: readonly RosterTeam[], teamId: string): RosterTeam[] {
  return teams.filter((team) => team.id !== teamId);
}

export function removeMember(
  teams: readonly RosterTeam[],
  teamId: string,
  memberId: string,
): RosterTeam[] {
  return inTeam(teams, teamId, (team) => ({
    ...team,
    members: team.members.filter((member) => member.id !== memberId),
  }));
}

/** The list with the entry at `index` one place up (-1) or down (1); unchanged at an end. */
export function moved<Entry>(list: readonly Entry[], index: number, by: -1 | 1): Entry[] {
  const to = index + by;
  const next = [...list];
  if (to < 0 || to >= next.length) return next;
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Who holds what: each held team's workspace, by its own name in Paseo, and the held teammates. */
export interface RosterHolders {
  teams: ReadonlyMap<string, string>;
  members: ReadonlySet<string>;
}

export const NO_HOLDERS: RosterHolders = { teams: new Map(), members: new Set() };

export function holdersOf(
  workspaces: readonly OfficeWorkspace[],
  agents: readonly OfficeAgent[],
): RosterHolders {
  const teams = new Map<string, string>();
  for (const workspace of workspaces)
    if (typeof workspace.roster === "string")
      teams.set(workspace.roster, workspace.workspaceName ?? workspace.name);
  const members = new Set<string>();
  for (const agent of agents) if (typeof agent.roster === "string") members.add(agent.roster);
  return { teams, members };
}
