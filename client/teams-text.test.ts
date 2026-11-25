import { expect, test } from "vitest";
import type { OfficeAgent, OfficeWorkspace } from "../shared/contracts.js";
import type { RosterTeam } from "../shared/roster.js";
import {
  addMember,
  addTeam,
  holdersOf,
  moveMember,
  moved,
  moveTeam,
  newId,
  removeMember,
  removeTeam,
  renameMember,
  renameTeam,
} from "./teams-text.js";

const TEAMS: RosterTeam[] = [
  {
    id: "t1",
    name: "PR-DEV",
    members: [
      { id: "m1", name: "TJ" },
      { id: "m2", name: "Zaki" },
    ],
  },
  { id: "t2", name: "PR-QA", members: [] },
];

test("a new team and a new teammate start with a numbered name nobody has", () => {
  expect(addTeam(TEAMS, "t3").at(-1)).toEqual({ id: "t3", name: "Team 3", members: [] });
  expect(addTeam([{ id: "t9", name: "Team 2", members: [] }], "t3").at(-1)?.name).toBe("Team 3");
  expect(addMember(TEAMS, "t1", "m3")[0].members.at(-1)).toEqual({ id: "m3", name: "Teammate 3" });
  expect(addMember(TEAMS, "t2", "m3")[1].members).toEqual([{ id: "m3", name: "Teammate 1" }]);
});

test("a rename keeps the id and tidies the name; an empty one changes nothing", () => {
  expect(renameTeam(TEAMS, "t2", "  PR  QA ")[1]).toEqual({ id: "t2", name: "PR QA", members: [] });
  expect(renameTeam(TEAMS, "t2", "  ")).toEqual(TEAMS);
  expect(renameMember(TEAMS, "t1", "m2", "Kharisma")[0].members[1]).toEqual({
    id: "m2",
    name: "Kharisma",
  });
  expect(renameMember(TEAMS, "t1", "m2", "")).toEqual(TEAMS);
});

test("a removal takes one team or one teammate", () => {
  expect(removeTeam(TEAMS, "t1").map((team) => team.id)).toEqual(["t2"]);
  expect(removeMember(TEAMS, "t1", "m1")[0].members.map((member) => member.id)).toEqual(["m2"]);
});

test("a move swaps with the neighbour and stops at the ends", () => {
  expect(moved(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
  expect(moved(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  expect(moved(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
  expect(moved(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
});

test("a team or teammate is moved by its id, so a second move acts on the list as it now is", () => {
  expect(moveTeam(TEAMS, "t2", -1).map((team) => team.id)).toEqual(["t2", "t1"]);
  expect(moveTeam(TEAMS, "t1", -1)).toEqual(TEAMS);
  expect(moveTeam(TEAMS, "gone", 1)).toEqual(TEAMS);
  expect(moveMember(TEAMS, "t1", "m2", -1)[0].members.map((member) => member.id)).toEqual([
    "m2",
    "m1",
  ]);
  expect(moveMember(TEAMS, "t1", "m2", 1)).toEqual(TEAMS);
  expect(moveMember(TEAMS, "t1", "gone", 1)).toEqual(TEAMS);
});

test("ids are short and differ", () => {
  const first = newId("t");
  expect(first).toMatch(/^t[a-z0-9]{6,12}$/);
  expect(newId("t")).not.toBe(first);
});

test("the holders are the workspaces and agents whose mark is an id", () => {
  const workspaces = [
    { id: "w1", name: "PR-DEV", workspaceName: "paseo-7f3a", roster: "t1" },
    { id: "w2", name: "Payments", workspaceName: "paseo-91bc", roster: "t2" },
    { id: "w3", name: "paseo-aa", roster: 1 },
  ] as OfficeWorkspace[];
  const agents = [
    { id: "a1", roster: "m1" },
    { id: "a2", roster: 1 },
    { id: "a3" },
  ] as OfficeAgent[];
  const holders = holdersOf(workspaces, agents);
  // The workspace's own name in Paseo, whatever the team is shown as.
  expect([...holders.teams]).toEqual([
    ["t1", "paseo-7f3a"],
    ["t2", "paseo-91bc"],
  ]);
  expect([...holders.members]).toEqual(["m1"]);
});

test("a team that workspaces share names the first and counts the rest", () => {
  const workspaces = [
    { id: "w1", name: "PR-DEV", workspaceName: "paseo-7f3a", roster: "t1" },
    { id: "w2", name: "PR-DEV", workspaceName: "paseo-91bc", roster: "t1" },
    { id: "w3", name: "PR-DEV", workspaceName: "paseo-aa", roster: "t1" },
  ] as OfficeWorkspace[];
  expect([...holdersOf(workspaces, []).teams]).toEqual([["t1", "paseo-7f3a and 2 more"]]);
});
