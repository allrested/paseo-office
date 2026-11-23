import { expect, test } from "vitest";
import { TEAM_NAME_KEY, storedTeamName, teamNameOf, tidyTeamName } from "./team-name.js";

test("a team name is kept as one trimmed line of at most 40 characters", () => {
  expect(tidyTeamName("  Payments \n team ")).toBe("Payments team");
  expect(tidyTeamName("x".repeat(60))).toHaveLength(40);
  expect(tidyTeamName("   ")).toBe("");
});

test("a workspace goes by its team name, else by its own", () => {
  const named = { name: "feature/BWLT-1", metadata: { [TEAM_NAME_KEY]: " Payments " } };
  expect(teamNameOf(named)).toBe("Payments");
  expect(teamNameOf({ name: "api" })).toBe("api");
  // An empty name, or one that is not text, is no team name.
  expect(storedTeamName({ [TEAM_NAME_KEY]: "  " })).toBeNull();
  expect(storedTeamName({ [TEAM_NAME_KEY]: 7 })).toBeNull();
  expect(teamNameOf({ name: "api", metadata: null })).toBe("api");
});
