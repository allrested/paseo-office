import { expect, test } from "vitest";
import { z } from "zod";
import {
  NO_ROSTER,
  ROSTER_MEMBER_KEY,
  RosterTeamsSchema,
  nextEdition,
  refuseBadTeams,
  rosterOf,
  shownTeamName,
  storedRosterMark,
  seatOf,
  tidyMemberName,
  type Roster,
  type RosterTeam,
} from "./roster.js";
import { TEAM_NAME_KEY } from "./team-name.js";

const DEV: RosterTeam = {
  id: "t1",
  name: "PR-DEV",
  members: [
    { id: "m1", name: "Tze Jun Tan" },
    { id: "m2", name: "Kharisma Muzaki Ghufron" },
  ],
};
const QA: RosterTeam = { id: "t2", name: "PR-QA", members: [{ id: "m3", name: "Rosalyn" }] };
const ON: Roster = { on: true, edition: 1, teams: [DEV, QA] };

const Checked = RosterTeamsSchema.superRefine(refuseBadTeams);

test("a stored mark is an id or a whole edition, else nothing", () => {
  expect(storedRosterMark("t1")).toBe("t1");
  expect(storedRosterMark(0)).toBe(0);
  expect(storedRosterMark(3)).toBe(3);
  expect(storedRosterMark("")).toBeUndefined();
  expect(storedRosterMark(-1)).toBeUndefined();
  expect(storedRosterMark(1.5)).toBeUndefined();
  expect(storedRosterMark(false)).toBeUndefined();
  expect(storedRosterMark(null)).toBeUndefined();
});

test("a teammate is found by id with its team, and only while the roster is on", () => {
  expect(seatOf(ON, "m3")).toEqual({ team: QA, member: QA.members[0] });
  expect(seatOf(ON, "m2")?.team).toBe(DEV);
  expect(seatOf(ON, "m2")?.member.name).toBe("Kharisma Muzaki Ghufron");
  // A team's id names no teammate, nor does one that is gone or a passed-over mark.
  expect(seatOf(ON, "t2")).toBeNull();
  expect(seatOf(ON, "gone")).toBeNull();
  expect(seatOf(ON, 1)).toBeNull();
  expect(seatOf(ON, undefined)).toBeNull();
  expect(seatOf({ ...ON, on: false }, "m3")).toBeNull();
});

test("the settings' three values read as one roster", () => {
  expect(rosterOf({ rosterOn: true, rosterEdition: 4, teams: [DEV] })).toEqual({
    on: true,
    edition: 4,
    teams: [DEV],
  });
  expect(NO_ROSTER).toEqual({ on: false, edition: 0, teams: [] });
});

test("names are tidied to one line and their length", () => {
  expect(tidyMemberName("  Tze   Jun\nTan ")).toBe("Tze Jun Tan");
  expect(tidyMemberName("x".repeat(80))).toHaveLength(60);
  const parsed = Checked.parse([
    { id: "t1", name: "  PR-DEV  ", members: [{ id: "m1", name: " TJ " }] },
  ]);
  expect(parsed).toEqual([{ id: "t1", name: "PR-DEV", members: [{ id: "m1", name: "TJ" }] }]);
});

test("an empty name, a name twice and an id twice are refused", () => {
  const messages = (teams: unknown) => {
    const result = Checked.safeParse(teams);
    return result.success ? [] : result.error.issues.map((issue) => issue.message);
  };
  expect(messages([{ id: "t1", name: " ", members: [] }])).not.toEqual([]);
  expect(messages([{ id: "t1", name: "A", members: [{ id: "m1", name: "" }] }])).not.toEqual([]);
  expect(
    messages([
      { id: "t1", name: "A", members: [] },
      { id: "t2", name: "a", members: [] },
    ]),
  ).toEqual(['teams: "a" is there twice']);
  expect(
    messages([
      {
        id: "t1",
        name: "A",
        members: [
          { id: "m1", name: "TJ" },
          { id: "m2", name: "tj" },
        ],
      },
    ]),
  ).toEqual(['teams: "tj" is twice in A']);
  expect(
    messages([
      { id: "t1", name: "A", members: [{ id: "m1", name: "TJ" }] },
      { id: "t2", name: "B", members: [{ id: "m1", name: "Zaki" }] },
    ]),
  ).toEqual(["teams: an id is there twice"]);
  expect(messages([DEV, QA])).toEqual([]);
});

test("too many teams or teammates are refused", () => {
  const many = Array.from({ length: 51 }, (_, index) => ({
    id: `t${index}`,
    name: `Team ${index}`,
    members: [],
  }));
  expect(z.object({ teams: RosterTeamsSchema }).safeParse({ teams: many }).success).toBe(false);
});

test("the edition goes up when a team or a teammate is added or the roster is switched on", () => {
  const before: Roster = { on: true, edition: 2, teams: [DEV] };
  expect(nextEdition(before, { on: true, teams: [DEV] })).toBe(2);
  expect(nextEdition(before, { on: true, teams: [DEV, QA] })).toBe(3);
  expect(
    nextEdition(before, {
      on: true,
      teams: [{ ...DEV, members: [...DEV.members, { id: "m9", name: "Shashwat Gupta" }] }],
    }),
  ).toBe(3);
  // A rename, a removal and a new order hand nothing new out.
  expect(nextEdition(before, { on: true, teams: [{ ...DEV, name: "DEV" }] })).toBe(2);
  expect(nextEdition(before, { on: true, teams: [] })).toBe(2);
  expect(nextEdition({ ...before, on: false }, { on: true, teams: [DEV] })).toBe(3);
  expect(nextEdition(before, { on: false, teams: [DEV, QA] })).toBe(3);
});

test("an agent's team is the name typed on its workspace, then its teammate's team, then the workspace's", () => {
  const plain = { name: "paseo-7f3a", metadata: {} };
  const typed = { name: "paseo-7f3a", metadata: { [TEAM_NAME_KEY]: "Payments" } };
  expect(shownTeamName(plain, ON)).toBe("paseo-7f3a");
  expect(shownTeamName(plain, ON, "m3")).toBe("PR-QA");
  expect(shownTeamName(typed, ON, "m3")).toBe("Payments");
  expect(shownTeamName(plain, { ...ON, on: false }, "m3")).toBe("paseo-7f3a");
  // Passed over, a teammate that is gone, and what is no mark at all.
  expect(shownTeamName(plain, ON, 1)).toBe("paseo-7f3a");
  expect(shownTeamName(plain, ON, "gone")).toBe("paseo-7f3a");
  expect(shownTeamName(plain, ON, { id: "m3" })).toBe("paseo-7f3a");
  expect(ROSTER_MEMBER_KEY).toBe("office.roster.member");
});
