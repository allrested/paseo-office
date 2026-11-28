import { useCallback, useMemo } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import {
  NO_ROSTER,
  rosterOf,
  rosterTeamById,
  type Roster,
  type RosterTeam,
} from "../shared/roster.js";
import { officeHostSettings } from "../shared/settings.js";

const NO_TEAMS: readonly RosterTeam[] = [];

/** The roster as the host's settings hold it; off until they are read. */
function useRoster(): Roster {
  const settings = useSettings(officeHostSettings);
  const values = settings.status === "ready" ? settings.values : null;
  return useMemo(() => (values === null ? NO_ROSTER : rosterOf(values)), [values]);
}

export interface RosterTeams {
  /** The teams the lobby's form can give a task to: none while the roster is off. */
  teams: readonly RosterTeam[];
  /** A team's name by its id; the id itself once the team is gone or the roster is off. */
  teamName(teamId: string): string;
}

/** What the boards need of the roster: the teams to choose from, and a team's name for a card. */
export function useRosterTeams(): RosterTeams {
  const roster = useRoster();
  const teams = roster.on ? roster.teams : NO_TEAMS;
  const teamName = useCallback(
    (teamId: string) => rosterTeamById(roster, teamId)?.name ?? teamId,
    [roster],
  );
  return { teams, teamName };
}
