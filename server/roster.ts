import { seatOf, type Roster, type RosterMark, type RosterMember } from "../shared/roster.js";

export interface RosterAgent {
  id: string;
  workspaceId: string | null;
  createdAt: string;
  /** "closed" for an agent that is listed and not at work any more: it is handed nothing. */
  status?: string;
  roster?: RosterMark;
}

/** The mark to store on an agent: the teammate it takes, or the edition it is passed over at. */
export interface RosterWrite {
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

/** Not looked at yet: no mark, or passed over at an edition before this one. */
function open(mark: RosterMark | undefined, edition: number): boolean {
  return mark === undefined || (typeof mark === "number" && mark < edition);
}

/** The agents the roster names, oldest first. One without a workspace is left alone. */
function oldestFirst(agents: readonly RosterAgent[]): RosterAgent[] {
  return agents
    .filter((agent) => agent.workspaceId !== null)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
}

/**
 * Who holds each teammate, by the teammate's id. Two agents can carry one teammate's id (0.2.13
 * handed a team's teammates out once per workspace): the oldest holds it.
 */
function holders(roster: Roster, ordered: readonly RosterAgent[]): Map<string, string> {
  const held = new Map<string, string>();
  for (const agent of ordered) {
    const seat = seatOf(roster, agent.roster);
    if (seat !== null && !held.has(seat.member.id)) held.set(seat.member.id, agent.id);
  }
  return held;
}

/**
 * The marks to store so every agent the roster can name has one. A team is its teammates, whatever
 * workspace each agent is in: agents not looked at yet, oldest first, take a teammate of the first
 * team in the settings' order that has one free, so the first team fills before the second. Among
 * that team's free teammates `pick` chooses, the first in order unless told otherwise. An agent
 * the roster has nobody left for gets the edition, so a name freed later goes to a new agent and
 * never to it. An id that names no teammate any more is written over with the edition: its
 * holder is passed over, and only a longer roster reaches it. An agent that carries a teammate an
 * older agent holds is looked at again. A closed agent is handed nothing. Nothing when the roster
 * is off.
 */
export function planRoster(
  roster: Roster,
  agents: readonly RosterAgent[],
  pick: PickMember = firstFree,
): RosterWrite[] {
  if (!roster.on) return [];
  const ordered = oldestFirst(agents);
  const held = holders(roster, ordered);
  const writes: RosterWrite[] = [];
  for (const agent of ordered) {
    const seat = seatOf(roster, agent.roster);
    if (seat !== null && held.get(seat.member.id) === agent.id) continue;
    // A closed agent keeps what it holds and takes nothing: the names are for who is on the floor.
    // It is not marked either, so one that is opened again is looked at then.
    if (agent.status === "closed") continue;
    if (seat === null && typeof agent.roster === "string") {
      writes.push({ id: agent.id, mark: roster.edition });
      continue;
    }
    if (seat === null && !open(agent.roster, roster.edition)) continue;
    const team = roster.teams.find((candidate) =>
      candidate.members.some((member) => !held.has(member.id)),
    );
    if (team === undefined) {
      writes.push({ id: agent.id, mark: roster.edition });
      continue;
    }
    const member = pick(team.members.filter((candidate) => !held.has(candidate.id)));
    writes.push({ id: agent.id, mark: member.id });
    held.set(member.id, agent.id);
  }
  return writes;
}

/** The roster's teammate name and team name for each agent that holds a teammate, by agent id. */
export function rosterNames(
  roster: Roster,
  agents: readonly RosterAgent[],
): { members: Map<string, string>; teams: Map<string, string> } {
  const members = new Map<string, string>();
  const teams = new Map<string, string>();
  const ordered = oldestFirst(agents);
  const held = holders(roster, ordered);
  for (const agent of ordered) {
    const seat = seatOf(roster, agent.roster);
    if (seat === null || held.get(seat.member.id) !== agent.id) continue;
    members.set(agent.id, seat.member.name);
    teams.set(agent.id, seat.team.name);
  }
  return { members, teams };
}
