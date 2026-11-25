import { expect, test } from "vitest";
import type { Roster, RosterMark } from "../shared/roster.js";
import {
  byChance,
  firstFree,
  planRoster,
  rosterNames,
  type PickMember,
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

test("the second workspace is PR-QA, and the third shares PR-DEV with its own teammates", () => {
  const workspaces = [ws("w1", 0, "dev"), ws("w2", 1), ws("w3", 2)];
  const agents = [agent("a1", "w1", 3, "tj"), agent("b1", "w2", 4), agent("c1", "w3", 5)];
  expect(planRoster(ROSTER, workspaces, agents)).toEqual([
    team("w2", "qa"),
    team("w3", "dev"),
    member("b1", "rosalyn"),
    // tj is held in w1 only: w3 hands the team's teammates out on its own.
    member("c1", "tj"),
  ]);
});

test("a shared team is the one the fewest workspaces hold, the first in order among equals", () => {
  const workspaces = [ws("w1", 0), ws("w2", 1), ws("w3", 2), ws("w4", 3), ws("w5", 4)];
  expect(planRoster(ROSTER, workspaces, [])).toEqual([
    team("w1", "dev"),
    team("w2", "qa"),
    team("w3", "dev"),
    team("w4", "qa"),
    team("w5", "dev"),
  ]);
  // PR-DEV is held twice and PR-QA once: the new workspace evens them out.
  const uneven = [ws("w1", 0, "dev"), ws("w2", 1, "dev"), ws("w3", 2, "qa"), ws("w4", 3)];
  expect(planRoster(ROSTER, uneven, [])).toEqual([team("w4", "qa")]);
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
  ).toEqual([team("wc", "dev"), team("wa", "qa"), team("wb", "dev")]);
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

test("a workspace passed over before teams were shared takes a team at once", () => {
  // 0.2.12 and earlier marked w3 and w4 as passed over at this edition.
  const workspaces = [ws("w1", 0, "dev"), ws("w2", 1, "qa"), ws("w3", 2, 1), ws("w4", 3, 1)];
  const agents = [agent("c1", "w3", 4), agent("c2", "w3", 5)];
  const planned = planRoster(ROSTER, workspaces, agents);
  expect(planned).toEqual([
    team("w3", "dev"),
    team("w4", "qa"),
    member("c1", "tj"),
    member("c2", "zaki"),
  ]);
  const after = stored(workspaces, agents, planned);
  expect(planRoster(ROSTER, after.workspaces, after.agents)).toEqual([]);
});

test("a new team is not taken from who holds another: the next new workspace takes it", () => {
  const grown: Roster = {
    on: true,
    edition: 2,
    teams: [...ROSTER.teams, { id: "ops", name: "PR-OPS", members: [{ id: "ali", name: "Ali" }] }],
  };
  const workspaces = [ws("w1", 0, "dev"), ws("w2", 1, "qa"), ws("w3", 2, "dev")];
  expect(planRoster(grown, workspaces, [])).toEqual([]);
  const agents = [agent("d1", "w4", 4), agent("d2", "w4", 5)];
  expect(planRoster(grown, [...workspaces, ws("w4", 3)], agents)).toEqual([
    team("w4", "ops"),
    member("d1", "ali"),
    member("d2", 2),
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

test("a deleted team's workspace takes another, and a deleted teammate's holder is passed over", () => {
  const workspaces = [ws("w1", 0, "gone-team"), ws("w2", 1, "dev")];
  const agents = [
    agent("a0", "w1", 1, "gone-member"),
    agent("a1", "w2", 2, "gone-member"),
    agent("a2", "w2", 3),
  ];
  // w1 takes PR-QA, the team nobody holds, and its a0 is passed over like any holder of a
  // teammate that is gone; a1 is not offered a teammate; a2 is new and takes the first.
  expect(planRoster(ROSTER, workspaces, agents)).toEqual([
    team("w1", "qa"),
    member("a0", 1),
    member("a1", 1),
    member("a2", "tj"),
  ]);
});

test("with no team left in the roster a deleted team's workspace is marked, once", () => {
  const empty: Roster = { on: true, edition: 3, teams: [] };
  const workspaces = [ws("w1", 0, "gone-team")];
  const planned = planRoster(empty, workspaces, []);
  expect(planned).toEqual([team("w1", 3)]);
  expect(planRoster(empty, stored(workspaces, [], planned).workspaces, [])).toEqual([]);
});

test("a deleted teammate's holder is offered a name again once the roster grows", () => {
  const workspaces = [ws("w1", 0, "dev")];
  const agents = [agent("a1", "w1", 1, "gone-member")];
  const first = planRoster(ROSTER, workspaces, agents);
  expect(first).toEqual([member("a1", 1)]);
  const after = stored(workspaces, agents, first);
  expect(planRoster(ROSTER, after.workspaces, after.agents)).toEqual([]);
  expect(planRoster({ ...ROSTER, edition: 2 }, after.workspaces, after.agents)).toEqual([
    member("a1", "tj"),
  ]);
});

test("a teammate of another team reads as passed over", () => {
  const workspaces = [ws("w2", 1, "qa")];
  const agents = [agent("moved", "w2", 2, "tj"), agent("b1", "w2", 3)];
  expect(planRoster(ROSTER, workspaces, agents)).toEqual([
    member("moved", 1),
    member("b1", "rosalyn"),
  ]);
});

test("an agent that moves away and back does not show the teammate handed on meanwhile", () => {
  const workspaces = [ws("w1", 0, "dev"), ws("w2", 1, "qa")];
  // m held tj in w1 and is now in w2; n is new in w1.
  const away = [agent("m", "w2", 1, "tj"), agent("n", "w1", 2)];
  const planned = planRoster(ROSTER, workspaces, away);
  expect(planned).toEqual([member("n", "tj"), member("m", 1)]);
  const after = stored(workspaces, away, planned);
  const back = after.agents.map((entry) =>
    entry.id === "m" ? { ...entry, workspaceId: "w1" } : entry,
  );
  expect(planRoster(ROSTER, after.workspaces, back)).toEqual([]);
  expect([...rosterNames(ROSTER, after.workspaces, back).members]).toEqual([["n", "Tze Jun Tan"]]);
});

test("the marks are kept through off and on again", () => {
  const workspaces = [ws("w1", 0, "dev"), ws("w2", 1, "qa"), ws("w3", 2, "dev")];
  const agents = [
    agent("a1", "w1", 1, "tj"),
    agent("a2", "w1", 2, "zaki"),
    agent("b1", "w2", 3, 1),
  ];
  expect(planRoster({ ...ROSTER, on: false }, workspaces, agents)).toEqual([]);
  expect(planRoster(ROSTER, workspaces, agents)).toEqual([]);
});

test("a longer roster and an archive together: the passed over are looked at first", () => {
  const grown: Roster = {
    ...ROSTER,
    edition: 2,
    teams: [
      { ...ROSTER.teams[0], members: [...ROSTER.teams[0].members, { id: "ali", name: "Ali" }] },
      ROSTER.teams[1],
    ],
  };
  // a2 (zaki) was archived; a5 was passed over at edition 1; a6 is new.
  const workspaces = [ws("w1", 0, "dev")];
  const agents = [
    agent("a1", "w1", 1, "tj"),
    agent("a3", "w1", 3, "shashwat"),
    agent("a4", "w1", 4, "taufik"),
    agent("a5", "w1", 5, 1),
    agent("a6", "w1", 6),
  ];
  expect(planRoster(grown, workspaces, agents)).toEqual([
    member("a5", "zaki"),
    member("a6", "ali"),
  ]);
});

test("a sub-agent draws from its workspace's list like any agent", () => {
  // child is a1's sub-agent in the caller's eyes; the planner sees two agents of w1.
  const workspaces = [ws("w1", 0, "dev")];
  const agents = [agent("a1", "w1", 1, "tj"), agent("child", "w1", 2)];
  expect(planRoster(ROSTER, workspaces, agents)).toEqual([member("child", "zaki")]);
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

test("the pick chooses among the free teammates only, and each is taken once", () => {
  const offered: string[][] = [];
  const last: PickMember = (free) => {
    offered.push(free.map((entry) => entry.id));
    return free[free.length - 1];
  };
  const workspaces = [ws("w1", 0, "dev")];
  const agents = [
    agent("a1", "w1", 1, "zaki"),
    agent("a2", "w1", 2),
    agent("a3", "w1", 3),
    agent("a4", "w1", 4),
    agent("a5", "w1", 5),
  ];
  expect(planRoster(ROSTER, workspaces, agents, last)).toEqual([
    member("a2", "taufik"),
    member("a3", "shashwat"),
    member("a4", "tj"),
    member("a5", 1),
  ]);
  // zaki is held and never offered; nothing is asked once none is free.
  expect(offered).toEqual([["tj", "shashwat", "taufik"], ["tj", "shashwat"], ["tj"]]);
});

test("a pick by chance takes the teammate its number falls on, and never one out of range", () => {
  const free = ROSTER.teams[0].members;
  expect(byChance(() => 0)(free).id).toBe("tj");
  expect(byChance(() => 0.5)(free).id).toBe("shashwat");
  expect(byChance(() => 0.999)(free).id).toBe("taufik");
  expect(byChance(() => 1)(free).id).toBe("taufik");
  expect(firstFree(free).id).toBe("tj");
});

test("teams still go to workspaces in the settings' order, whatever the pick", () => {
  const last: PickMember = (free) => free[free.length - 1];
  expect(planRoster(ROSTER, [ws("w1", 0), ws("w2", 1)], [], last)).toEqual([
    team("w1", "dev"),
    team("w2", "qa"),
  ]);
});
