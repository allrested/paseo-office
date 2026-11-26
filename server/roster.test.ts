import { expect, test } from "vitest";
import type { Roster, RosterMark } from "../shared/roster.js";
import {
  byChance,
  firstFree,
  planRoster,
  rosterNames,
  type PickMember,
  type RosterAgent,
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
const member = (id: string, mark: RosterMark): RosterWrite => ({ id, mark });

/** The agents once every planned write is stored. */
function stored(agents: readonly RosterAgent[], writes: readonly RosterWrite[]): RosterAgent[] {
  const marks = new Map(writes.map((write) => [write.id, write.mark]));
  return agents.map((entry) => ({ ...entry, roster: marks.get(entry.id) ?? entry.roster }));
}

test("agents fill the first team, then the second, whatever workspace each is in", () => {
  const agents = [
    agent("a1", "w1", 1),
    agent("a2", "w2", 2),
    agent("a3", "w3", 3),
    agent("a4", "w1", 4),
    agent("a5", "w4", 5),
    agent("a6", "w2", 6),
    agent("a7", "w5", 7),
  ];
  expect(planRoster(ROSTER, agents)).toEqual([
    member("a1", "tj"),
    member("a2", "zaki"),
    member("a3", "shashwat"),
    member("a4", "taufik"),
    member("a5", "rosalyn"),
    member("a6", "qx"),
    // The roster has nobody left: the seventh keeps its own name and its workspace's team.
    member("a7", 1),
  ]);
});

test("agents are served oldest first whatever order they are listed in, ties by id", () => {
  const agents = [agent("young", "w1", 9), agent("b", "w2", 1), agent("a", "w3", 1)];
  expect(planRoster(ROSTER, agents)).toEqual([
    member("a", "tj"),
    member("b", "zaki"),
    member("young", "shashwat"),
  ]);
});

test("the owner's floor: three hold PR-DEV and one PR-QA, so the next two complete PR-DEV then PR-QA", () => {
  const agents = [
    agent("a1", "w1", 1, "taufik"),
    agent("a2", "w2", 2, "tj"),
    agent("a3", "w3", 3, "shashwat"),
    agent("a4", "w4", 4, "qx"),
  ];
  expect(planRoster(ROSTER, agents)).toEqual([]);
  const next = [...agents, agent("a5", "w5", 5), agent("a6", "w6", 6), agent("a7", "w7", 7)];
  expect(planRoster(ROSTER, next)).toEqual([
    member("a5", "zaki"),
    member("a6", "rosalyn"),
    member("a7", 1),
  ]);
});

test("a teammate freed by an archive goes to the next new agent, not to one passed over", () => {
  // The holder of zaki was archived: it is no longer listed. a7 was passed over at this edition.
  const agents = [
    agent("a1", "w1", 1, "tj"),
    agent("a3", "w1", 3, "shashwat"),
    agent("a4", "w2", 4, "taufik"),
    agent("a5", "w2", 5, "rosalyn"),
    agent("a6", "w3", 6, "qx"),
    agent("a7", "w3", 7, 1),
  ];
  expect(planRoster(ROSTER, agents)).toEqual([]);
  expect(planRoster(ROSTER, [...agents, agent("a8", "w4", 8)])).toEqual([member("a8", "zaki")]);
});

test("a longer roster reaches what was passed over, oldest first", () => {
  const grown: Roster = {
    on: true,
    edition: 2,
    teams: [...ROSTER.teams, { id: "ops", name: "PR-OPS", members: [{ id: "ali", name: "Ali" }] }],
  };
  const agents = [
    agent("a1", "w1", 1, "tj"),
    agent("a2", "w1", 2, "zaki"),
    agent("a3", "w1", 3, "shashwat"),
    agent("a4", "w1", 4, "taufik"),
    agent("a5", "w2", 5, "rosalyn"),
    agent("a6", "w2", 6, "qx"),
    agent("a7", "w3", 7, 1),
    agent("a8", "w3", 8, 1),
  ];
  expect(planRoster(grown, agents)).toEqual([member("a7", "ali"), member("a8", 2)]);
});

test("switching on with no team marks everyone, and the first team then reaches them", () => {
  const empty: Roster = { on: true, edition: 1, teams: [] };
  const agents = [agent("a1", "w1", 1)];
  const first = planRoster(empty, agents);
  expect(first).toEqual([member("a1", 1)]);
  const withTeam: Roster = { on: true, edition: 2, teams: [ROSTER.teams[0]] };
  expect(planRoster(withTeam, stored(agents, first))).toEqual([member("a1", "tj")]);
});

test("a deleted teammate gives its holder no other, until the roster grows", () => {
  const agents = [agent("a1", "w1", 1, "gone-member"), agent("a2", "w1", 2)];
  const first = planRoster(ROSTER, agents);
  // a1 is not offered a teammate; a2 is new and takes the first.
  expect(first).toEqual([member("a1", 1), member("a2", "tj")]);
  const after = stored(agents, first);
  expect(planRoster(ROSTER, after)).toEqual([]);
  expect(planRoster({ ...ROSTER, edition: 2 }, after)).toEqual([member("a1", "zaki")]);
});

test("one teammate carried by two agents stays with the oldest, and the other is looked at again", () => {
  // 0.2.13 handed a team's teammates out once per workspace, so two workspaces each had a tj.
  const agents = [
    agent("old", "w1", 1, "tj"),
    agent("new", "w2", 2, "tj"),
    agent("other", "w2", 3, "qx"),
  ];
  expect([...rosterNames(ROSTER, agents).members]).toEqual([
    ["old", "Tze Jun Tan"],
    ["other", "QX"],
  ]);
  const planned = planRoster(ROSTER, agents);
  expect(planned).toEqual([member("new", "zaki")]);
  expect(planRoster(ROSTER, stored(agents, planned))).toEqual([]);
});

test("a second carrier with nobody left for it is passed over", () => {
  const one: Roster = {
    on: true,
    edition: 4,
    teams: [{ ...ROSTER.teams[1], members: [{ id: "qx", name: "QX" }] }],
  };
  const agents = [agent("old", "w1", 1, "qx"), agent("new", "w2", 2, "qx")];
  expect(planRoster(one, agents)).toEqual([member("new", 4)]);
});

test("the marks are kept through off and on again", () => {
  const agents = [
    agent("a1", "w1", 1, "tj"),
    agent("a2", "w1", 2, "zaki"),
    agent("b1", "w2", 3, 1),
  ];
  expect(planRoster({ ...ROSTER, on: false }, agents)).toEqual([]);
  expect(planRoster(ROSTER, agents)).toEqual([]);
  expect(rosterNames({ ...ROSTER, on: false }, agents).members.size).toBe(0);
});

test("a sub-agent takes a teammate like any agent", () => {
  const agents = [agent("parent", "w1", 1), agent("child", "w1", 2)];
  expect(planRoster(ROSTER, agents)).toEqual([member("parent", "tj"), member("child", "zaki")]);
});

test("a closed agent takes no teammate and is not marked, and is looked at once it is open again", () => {
  const closed = { ...agent("old", "w1", 1), status: "closed" };
  const agents = [closed, agent("new", "w2", 2)];
  expect(planRoster(ROSTER, agents)).toEqual([member("new", "tj")]);
  expect(planRoster(ROSTER, [{ ...closed, status: "idle" }, agent("new", "w2", 2, "tj")])).toEqual([
    member("old", "zaki"),
  ]);
  // What a closed agent holds stays its own.
  const holder = { ...agent("old", "w1", 1, "tj"), status: "closed" };
  expect(planRoster(ROSTER, [holder, agent("new", "w2", 2)])).toEqual([member("new", "zaki")]);
});

test("an agent without a workspace is left alone", () => {
  expect(planRoster(ROSTER, [agent("a1", null, 1)])).toEqual([]);
});

test("planning what was just planned plans nothing more", () => {
  const agents = [agent("a1", "w1", 1), agent("a2", "w2", 2)];
  expect(planRoster(ROSTER, stored(agents, planRoster(ROSTER, agents)))).toEqual([]);
});

test("the names are the teammate and its team, for who holds one", () => {
  const agents = [
    agent("a1", "w1", 1, "tj"),
    agent("a2", "w1", 2, 1),
    agent("b1", "w2", 3, "qx"),
    agent("gone", "w2", 4, "gone-member"),
    agent("fresh", "w2", 5),
  ];
  const names = rosterNames(ROSTER, agents);
  expect([...names.members]).toEqual([
    ["a1", "Tze Jun Tan"],
    ["b1", "QX"],
  ]);
  expect([...names.teams]).toEqual([
    ["a1", "PR-DEV"],
    ["b1", "PR-QA"],
  ]);
});

test("the pick chooses among the first unfilled team's free teammates only, and each is taken once", () => {
  const seen: string[][] = [];
  const last: PickMember = (free) => {
    seen.push(free.map((entry) => entry.id));
    return free[free.length - 1];
  };
  const agents = [
    agent("a1", "w1", 1),
    agent("a2", "w1", 2),
    agent("a3", "w2", 3),
    agent("a4", "w2", 4),
    agent("a5", "w3", 5),
  ];
  expect(planRoster(ROSTER, agents, last)).toEqual([
    member("a1", "taufik"),
    member("a2", "shashwat"),
    member("a3", "zaki"),
    member("a4", "tj"),
    member("a5", "qx"),
  ]);
  expect(seen).toEqual([
    ["tj", "zaki", "shashwat", "taufik"],
    ["tj", "zaki", "shashwat"],
    ["tj", "zaki"],
    ["tj"],
    ["rosalyn", "qx"],
  ]);
});

test("a pick by chance takes the teammate its number falls on, and never one out of range", () => {
  const free = ROSTER.teams[0].members;
  expect(byChance(() => 0)(free).id).toBe("tj");
  expect(byChance(() => 0.5)(free).id).toBe("shashwat");
  expect(byChance(() => 0.999)(free).id).toBe("taufik");
  expect(byChance(() => 1)(free).id).toBe("taufik");
  expect(firstFree(free).id).toBe("tj");
});
