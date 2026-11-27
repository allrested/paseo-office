import type { OfficeRoom } from "../../shared/model.js";
import type { WorldPeople } from "../world/adapter.js";
import type { PlanTeam } from "./floor-plan.js";

/** What a desk's name adds while the provider's own sub-agents work in its session. */
export function helpersText(count: number): string {
  if (count === 0) return "";
  return count === 1 ? ", 1 sub-agent at work" : `, ${count} sub-agents at work`;
}

/**
 * The teams with a desk, in the rooms' order, each with the agents that sit there. A team is
 * what the 3D floor seats together: a room, or with the roster on a roster team, whose teammates
 * may work in several rooms. Its plate opens the board of the room it is named after, else of
 * its first member's room.
 */
export function teamsOf(rooms: readonly OfficeRoom[], people: WorldPeople): PlanTeam[] {
  const seated = new Map(people.sessions.map((session) => [session.id, session.dir]));
  const named = new Map(rooms.map((room) => [room.name, room.id]));
  const teams = new Map<string, { id: string; board: string; name: string; members: string[] }>();
  for (const room of rooms) {
    for (const row of room.rows) {
      const name = seated.get(row.agent.id);
      if (name === undefined) continue;
      const team = teams.get(name) ?? {
        id: named.get(name) ?? `team:${name}`,
        board: named.get(name) ?? room.id,
        name,
        members: [],
      };
      team.members.push(row.agent.id);
      teams.set(name, team);
    }
  }
  return [...teams.values()];
}
