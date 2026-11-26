import { z } from "zod";
import { TEAM_NAME_MAX, storedTeamName, tidyTeamName } from "./team-name.js";

/**
 * On a workspace, until 0.2.13: the roster team it held. A team is its teammates' now, whatever
 * their workspaces, so the office neither reads nor writes it; what is stored stays.
 */
export const ROSTER_TEAM_KEY = "office.roster.team";
/** On an agent: the roster teammate it holds, by id, or the edition it was passed over at. */
export const ROSTER_MEMBER_KEY = "office.roster.member";
export const ROSTER_TEAMS_MAX = 50;
export const ROSTER_MEMBERS_MAX = 50;
export const MEMBER_NAME_MAX = 60;
const ID_MAX = 40;

/** A teammate name as it is kept: one line, trimmed, at most MEMBER_NAME_MAX characters. */
export function tidyMemberName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, MEMBER_NAME_MAX);
}

const id = z.string().min(1).max(ID_MAX);
const RosterMemberSchema = z.object({
  id,
  name: z.string().transform(tidyMemberName).pipe(z.string().min(1)),
});
const RosterTeamSchema = z.object({
  id,
  name: z.string().transform(tidyTeamName).pipe(z.string().min(1).max(TEAM_NAME_MAX)),
  members: z.array(RosterMemberSchema).max(ROSTER_MEMBERS_MAX).default([]),
});
export const RosterTeamsSchema = z.array(RosterTeamSchema).max(ROSTER_TEAMS_MAX).default([]);
export type RosterTeam = z.output<typeof RosterTeamSchema>;
export type RosterMember = z.output<typeof RosterMemberSchema>;

/** A name is the same name whatever its capitals: nobody tells "TJ" from "tj" on the floor. */
const same = (name: string) => name.toLowerCase();

/** Two teams of one name, two teammates of one name in a team, and an id used twice. */
export function refuseBadTeams(teams: readonly RosterTeam[], context: z.RefinementCtx): void {
  const refuse = (message: string) =>
    context.addIssue({ code: "custom", path: ["teams"], message: `teams: ${message}` });
  const ids = new Set<string>();
  const names = new Set<string>();
  let idTwice = false;
  for (const team of teams) {
    if (names.has(same(team.name))) refuse(`"${team.name}" is there twice`);
    names.add(same(team.name));
    idTwice ||= ids.has(team.id);
    ids.add(team.id);
    const members = new Set<string>();
    for (const member of team.members) {
      if (members.has(same(member.name))) refuse(`"${member.name}" is twice in ${team.name}`);
      members.add(same(member.name));
      idTwice ||= ids.has(member.id);
      ids.add(member.id);
    }
  }
  if (idTwice) refuse("an id is there twice");
}

/** The roster as the server and the planner read it. */
export interface Roster {
  on: boolean;
  /** Raised when the roster grows or is switched on: what was passed over before is looked at again. */
  edition: number;
  teams: readonly RosterTeam[];
}
export const NO_ROSTER: Roster = { on: false, edition: 0, teams: [] };

export function rosterOf(values: {
  rosterOn: boolean;
  rosterEdition: number;
  teams: readonly RosterTeam[];
}): Roster {
  return { on: values.rosterOn, edition: values.rosterEdition, teams: values.teams };
}

/** What is stored on a workspace or an agent: an id, or the edition it was passed over at. */
export type RosterMark = string | number;

export function storedRosterMark(value: unknown): RosterMark | undefined {
  if (typeof value === "string") return value === "" ? undefined : value;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * The teammate a mark names, with its team; null for a passed-over mark, a deleted teammate and a
 * roster that is off. A teammate's id is in one team only (`refuseBadTeams`).
 */
export function seatOf(
  roster: Roster,
  mark: RosterMark | undefined,
): { team: RosterTeam; member: RosterMember } | null {
  if (!roster.on || typeof mark !== "string") return null;
  for (const team of roster.teams) {
    const member = team.members.find((candidate) => candidate.id === mark);
    if (member !== undefined) return { team, member };
  }
  return null;
}

function idsOf(teams: readonly RosterTeam[]): Set<string> {
  return new Set(teams.flatMap((team) => [team.id, ...team.members.map((member) => member.id)]));
}

/**
 * The edition a save carries: one more when it adds a team or a teammate or switches the roster
 * on, else the same. A rename, a removal and a new order hand nothing new out.
 */
export function nextEdition(
  before: Roster,
  after: { on: boolean; teams: readonly RosterTeam[] },
): number {
  const known = idsOf(before.teams);
  const grew = [...idsOf(after.teams)].some((entry) => !known.has(entry));
  const switchedOn = after.on && !before.on;
  return grew || switchedOn ? before.edition + 1 : before.edition;
}

/**
 * The team an agent's turns count for: the name typed by hand on its workspace, else the roster
 * team of the teammate the agent holds, else the workspace's name.
 */
export function shownTeamName(
  workspace: { name: string; metadata?: Readonly<Record<string, unknown>> | null },
  roster: Roster,
  agentMark?: unknown,
): string {
  return (
    storedTeamName(workspace.metadata) ??
    seatOf(roster, storedRosterMark(agentMark))?.team.name ??
    workspace.name
  );
}
