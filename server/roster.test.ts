import { expect, test } from "vitest";
import type { Roster, RosterMark } from "../shared/roster.js";
import {
  planRoster,
  rosterNames,
  type RosterAgent,
  type RosterWorkspace,
  type RosterWrite,
} from "./roster.js";

const ROSTER: Roster = {
  on: true,
  edition: 1,
  teams: [
    {
      id: "dev",
      name: "PR-DEV",
      members: [
        { id: "tj", name: "Tze Jun Tan" },
        { id: "zaki", name: "Kharisma Muzaki Ghufron" },
        { id: "shashwat", name: "Shashwat Gupta" },
        { id: "taufik", name: "Taufik Suryaman" },
      ],
    },
    {
      id: "qa",
      name: "PR-QA",
      members: [
        { id: "rosalyn", name: "Rosalyn" },
        { id: "qx", name: "QX" },
      ],
    },
  ],
};

const at = (minute: number) => `2026-11-23T08:${String(minute).padStart(2, "0")}:00.000Z`;
const ws = (id: string, minute: number, roster?: RosterMark): RosterWorkspace => ({
  id,
  createdAt: at(minute),
  ...(roster === undefined ? {} : { roster }),
});
const agent = (
  id: string,
  workspaceId: string | null,
  minute: number,
  roster?: RosterMark,
): RosterAgent => ({
  id,
  workspaceId,
  createdAt: at(minute),
  ...(roster === undefined ? {} : { roster }),
});
const team = (id: string, mark: RosterMark): RosterWrite => ({ kind: "workspace", id, mark });
const member = (id: string, mark: RosterMark): RosterWrite => ({ kind: "agent", id, mark });

/** The view once every planned write is stored. */
function stored(
  workspaces: readonly RosterWorkspace[],
  agents: readonly RosterAgent[],
  writes: readonly RosterWrite[],
): { workspaces: RosterWorkspace[]; agents: RosterAgent[] } {
  const marks = new Map(writes.map((write) => [`${write.kind}:${write.id}`, write.mark]));
  return {
    workspaces: workspaces.map((entry) => ({
      ...entry,
      roster: marks.get(`workspace:${entry.id}`) ?? entry.roster,
    })),
    agents: agents.map((entry) => ({
      ...entry,
      roster: marks.get(`agent:${entry.id}`) ?? entry.roster,
    })),
  };
}

test("the first workspace is PR-DEV and its agents take the teammates in order", () => {
  const workspaces = [ws("w1", 0)];
  const agents = [agent("a1", "w1", 1), agent("a2", "w1", 2)];
  expect(planRoster(ROSTER, workspaces, agents)).toEqual([
    team("w1", "dev"),
    member("a1", "tj"),
    member("a2", "zaki"),
  ]);
});

test("a later agent takes the next teammate, and the fifth is passed over", () => {
  const workspaces = [ws("w1", 0, "dev")];
  const agents = [
    agent("a1", "w1", 1, "tj"),
    agent("a2", "w1", 2, "zaki"),
    agent("a3", "w1", 3),
    agent("a4", "w1", 4),
    agent("a5", "w1", 5),
  ];
  expect(planRoster(ROSTER, workspaces, agents)).toEqual([
    member("a3", "shashwat"),
    member("a4", "taufik"),
    member("a5", 1),
  ]);
});

test("the second workspace is PR-QA and the third is passed over with its agents untouched", () => {
  const workspaces = [ws("w1", 0, "dev"), ws("w2", 1), ws("w3", 2)];
  const agents = [agent("b1", "w2", 3), agent("c1", "w3", 4)];
  expect(planRoster(ROSTER, workspaces, agents)).toEqual([
    team("w2", "qa"),
    team("w3", 1),
    member("b1", "rosalyn"),
  ]);
});

test("workspaces are served oldest first whatever order they are listed in", () => {
  const workspaces = [ws("young", 9), ws("old", 1)];
  expect(planRoster(ROSTER, workspaces, [])).toEqual([team("old", "dev"), team("young", "qa")]);
});

test("a workspace without a creation time goes by its oldest agent, then by id", () => {
  const workspaces: RosterWorkspace[] = [{ id: "wb" }, { id: "wa" }, { id: "wc" }];
  const agents = [agent("x", "wc", 1), agent("y", "wa", 5), agent("z", "wa", 3)];
  // wc's oldest agent is the oldest; wa's is next; wb has none and comes last.
  expect(
    planRoster(ROSTER, workspaces, agents).filter((write) => write.kind === "workspace"),
  ).toEqual([team("wc", "dev"), team("wa", "qa"), team("wb", 1)]);
});

test("a teammate freed by an archive goes to the next new agent, not to one passed over", () => {
  // a2 (zaki) was archived: it is no longer listed. a5 was passed over at this edition.
  const workspaces = [ws("w1", 0, "dev")];
  const agents = [
    agent("a1", "w1", 1, "tj"),
    agent("a3", "w1", 3, "shashwat"),
    agent("a4", "w1", 4, "taufik"),
    agent("a5", "w1", 5, 1),
  ];
  expect(planRoster(ROSTER, workspaces, agents)).toEqual([]);
  expect(planRoster(ROSTER, workspaces, [...agents, agent("a6", "w1", 6)])).toEqual([
    member("a6", "zaki"),
  ]);
});

test("a team freed by an archive goes to the next new workspace, not to one passed over", () => {
  // w1 (PR-DEV) was archived. w3 was passed over at this edition.
  const workspaces = [ws("w2", 1, "qa"), ws("w3", 2, 1)];
  expect(planRoster(ROSTER, workspaces, [])).toEqual([]);
  expect(planRoster(ROSTER, [...workspaces, ws("w4", 3)], [])).toEqual([team("w4", "dev")]);
});

test("a longer roster reaches what was passed over, oldest first", () => {
  const grown: Roster = {
    on: true,
    edition: 2,
    teams: [...ROSTER.teams, { id: "ops", name: "PR-OPS", members: [{ id: "ali", name: "Ali" }] }],
  };
  const workspaces = [ws("w1", 0, "dev"), ws("w2", 1, "qa"), ws("w3", 2, 1), ws("w4", 3, 1)];
  const agents = [agent("c1", "w3", 4), agent("c2", "w3", 5)];
  expect(planRoster(grown, workspaces, agents)).toEqual([
    team("w3", "ops"),
    team("w4", 2),
    member("c1", "ali"),
    member("c2", 2),
  ]);
});

test("switching on with no team marks everything, and the first team then reaches it", () => {
  const empty: Roster = { on: true, edition: 1, teams: [] };
  const workspaces = [ws("w1", 0)];
  const agents = [agent("a1", "w1", 1)];
  const first = planRoster(empty, workspaces, agents);
  expect(first).toEqual([team("w1", 1)]);
  const after = stored(workspaces, agents, first);
  const withTeam: Roster = { on: true, edition: 2, teams: [ROSTER.teams[0]] };
  expect(planRoster(withTeam, after.workspaces, after.agents)).toEqual([
    team("w1", "dev"),
    member("a1", "tj"),
  ]);
});

test("a deleted team or teammate gives its holder no other", () => {
  const workspaces = [ws("w1", 0, "gone-team"), ws("w2", 1, "dev")];
  const agents = [agent("a1", "w2", 2, "gone-member"), agent("a2", "w2", 3)];
  // w1 is not offered PR-QA; a1 is not offered a teammate; a2 is new and takes the first.
  expect(planRoster(ROSTER, workspaces, agents)).toEqual([member("a2", "tj")]);
});

test("a teammate of another team reads as passed over", () => {
  const workspaces = [ws("w2", 1, "qa")];
  const agents = [agent("moved", "w2", 2, "tj"), agent("b1", "w2", 3)];
  expect(planRoster(ROSTER, workspaces, agents)).toEqual([member("b1", "rosalyn")]);
});

test("an agent without a workspace and a roster that is off are left alone", () => {
  expect(planRoster(ROSTER, [], [agent("lobby", null, 1)])).toEqual([]);
  expect(planRoster({ ...ROSTER, on: false }, [ws("w1", 0)], [agent("a1", "w1", 1)])).toEqual([]);
});

test("planning what was just planned plans nothing more", () => {
  const workspaces = [ws("w1", 0), ws("w2", 1), ws("w3", 2)];
  const agents = [agent("a1", "w1", 3), agent("b1", "w2", 4), agent("c1", "w3", 5)];
  const after = stored(workspaces, agents, planRoster(ROSTER, workspaces, agents));
  expect(planRoster(ROSTER, after.workspaces, after.agents)).toEqual([]);
});

test("the names are those of what is stored", () => {
  const workspaces = [ws("w1", 0, "dev"), ws("w2", 1, 1), ws("w3", 2, "gone")];
  const agents = [
    agent("a1", "w1", 1, "tj"),
    agent("a2", "w1", 2, 1),
    agent("a3", "w1", 3, "rosalyn"),
    agent("b1", "w2", 4, "tj"),
    agent("new", "w1", 5),
  ];
  const names = rosterNames(ROSTER, workspaces, agents);
  expect([...names.teams]).toEqual([["w1", "PR-DEV"]]);
  expect([...names.members]).toEqual([["a1", "Tze Jun Tan"]]);
  const off = rosterNames({ ...ROSTER, on: false }, workspaces, agents);
  expect(off.teams.size + off.members.size).toBe(0);
});
