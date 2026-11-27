import { expect, test } from "vitest";
import type { OfficeRoom } from "../../shared/model.js";
import type { WorldPeople } from "../world/adapter.js";
import { helpersText, teamsOf } from "./teams.js";

function room(id: string, name: string, agents: string[]): OfficeRoom {
  return { id, name, rows: agents.map((agentId) => ({ agent: { id: agentId } })) } as OfficeRoom;
}
/** The people with a desk, each with the team the floor seats it in. */
function people(teams: Record<string, string>): WorldPeople {
  const sessions = Object.entries(teams).map(([id, dir]) => ({ id, dir }));
  return { sessions } as unknown as WorldPeople;
}

test("without a roster a team is a room, and only who has a desk sits", () => {
  const rooms = [
    room("w1", "shop-api", ["a", "b"]),
    room("w2", "blog", ["c"]),
    room("w3", "docs", []),
  ];
  expect(teamsOf(rooms, people({ a: "shop-api", c: "blog" }))).toEqual([
    { id: "w1", board: "w1", name: "shop-api", members: ["a"] },
    { id: "w2", board: "w2", name: "blog", members: ["c"] },
  ]);
});

test("a roster team sits together across rooms, and its plate opens its first member's board", () => {
  const rooms = [room("w1", "shop-api", ["a", "b"]), room("w2", "blog", ["c", "d"])];
  const seated = people({ a: "PR-DEV", b: "QA-PR", c: "PR-DEV", d: "blog" });
  expect(teamsOf(rooms, seated)).toEqual([
    { id: "team:PR-DEV", board: "w1", name: "PR-DEV", members: ["a", "c"] },
    { id: "team:QA-PR", board: "w1", name: "QA-PR", members: ["b"] },
    { id: "w2", board: "w2", name: "blog", members: ["d"] },
  ]);
});

test("a desk's name says how many of the provider's own sub-agents are at work", () => {
  expect(helpersText(0)).toBe("");
  expect(helpersText(1)).toBe(", 1 sub-agent at work");
  expect(helpersText(3)).toBe(", 3 sub-agents at work");
});
