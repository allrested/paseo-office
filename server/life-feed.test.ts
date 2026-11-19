import { expect, test, vi } from "vitest";
import type { OfficeAgent } from "../shared/contracts.js";
import type { DirectoryView } from "./hub.js";
import { createLifeFeed, type LifeFeedDeps } from "./life-feed.js";
import type { Tenure } from "./tenure.js";

const agent = (id: string, patch: Partial<OfficeAgent> = {}): OfficeAgent => ({
  id,
  title: null,
  provider: "claude",
  model: null,
  status: "idle",
  workspaceId: "w1",
  parentAgentId: null,
  permissions: [],
  createdAt: "2026-10-01T12:00:00Z",
  ...patch,
});
const view = (agents: OfficeAgent[] = [agent("a1")]): DirectoryView => ({
  agents,
  workspaces: [{ id: "w1", name: "api", projectName: "shop" }],
  folders: { w1: "/work/api" },
});

function deps() {
  const tenure = {
    touch: vi.fn<Tenure["touch"]>(() => null),
    seed: vi.fn<Tenure["seed"]>(),
    seeded: vi.fn<Tenure["seeded"]>(() => false),
    list: vi.fn<Tenure["list"]>(() => []),
    markFarewell: vi.fn<Tenure["markFarewell"]>(() => true),
    markOfficial: vi.fn<Tenure["markOfficial"]>(() => true),
    get: vi.fn<Tenure["get"]>(() => null),
  };
  const made = {
    tenure,
    age: vi.fn<LifeFeedDeps["age"]>(async () => "2020-02-03"),
    lift: { pub: () => ({ left: 1, total: 2, newBuild: false, sticker: null }) },
    now: () => Date.parse("2026-11-19T12:00:00Z"),
    emit: vi.fn<LifeFeedDeps["emit"]>(),
  };
  return made;
}

test("the first view seeds the ledger with each team, its first agent and their days", () => {
  const d = deps();
  createLifeFeed(d).view(view([agent("a1"), agent("a2", { createdAt: "2026-10-05T12:00:00Z" })]));
  expect(d.tenure.seed).toHaveBeenCalledWith([
    { name: "api", first: Date.parse("2026-10-01T12:00:00Z"), daysSeen: 3 },
  ]);
});

test("a repository's age is read once per folder and told by team name", async () => {
  const d = deps();
  const feed = createLifeFeed(d);
  feed.view(view());
  feed.view(view());
  await feed.settled();
  expect(d.age.mock.calls).toEqual([["/work/api"]]);
  expect(feed.snapshot()).toEqual({
    born: { api: "2020-02-03" },
    tenure: { days: 30, choices: [30], projects: [] },
    lift: { left: 1, total: 2, newBuild: false, sticker: null },
  });
  expect(d.emit).toHaveBeenLastCalledWith(feed.snapshot());
});

test("a team at work is seen at each view, and a turn that ends counts", () => {
  const d = deps();
  const feed = createLifeFeed(d);
  feed.view(view([agent("a1", { status: "running" }), agent("a2", { workspaceId: null })]));
  expect(d.tenure.touch.mock.calls).toEqual([["api", { at: d.now() }]]);
  feed.turnEnded("a1");
  expect(d.tenure.touch).toHaveBeenLastCalledWith("api", { at: d.now(), turn: true });
});

test("an agent in the lobby belongs to no team", () => {
  const d = deps();
  const feed = createLifeFeed(d);
  feed.view(view([agent("a2", { workspaceId: null, status: "running" })]));
  feed.turnEnded("a2");
  expect(d.tenure.touch).not.toHaveBeenCalled();
  expect(d.tenure.seed).toHaveBeenCalledWith([]);
});

test("a farewell or an official write goes to the ledger with whether the team is here", () => {
  const d = deps();
  const feed = createLifeFeed(d);
  feed.view(view());
  expect(feed.write({ op: "farewell", name: "api" })).toEqual({ ok: true });
  expect(feed.write({ op: "farewell", name: "web" })).toEqual({ ok: true });
  expect(d.tenure.markFarewell.mock.calls).toEqual([
    ["api", true],
    ["web", false],
  ]);
  d.tenure.markOfficial.mockReturnValue(false);
  expect(feed.write({ op: "official", name: "api" })).toEqual({ ok: false });
});

test("the scenes are told again only when something but the lift's countdown changed", () => {
  const d = deps();
  let left = 5;
  d.lift.pub = () => ({ left, total: 10, newBuild: false, sticker: null });
  const feed = createLifeFeed(d);
  feed.view(view());
  left = 4;
  feed.view(view());
  expect(d.emit).toHaveBeenCalledTimes(1);
  left = 0;
  feed.view(view());
  expect(d.emit).toHaveBeenCalledTimes(2);
});

test("the ages are read one folder at a time, so a host of many workspaces starts one git, not one each", async () => {
  const d = deps();
  const answers: ((day: string | null) => void)[] = [];
  d.age.mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
  const feed = createLifeFeed(d);
  feed.view({
    agents: [],
    workspaces: [
      { id: "w1", name: "api", projectName: "shop" },
      { id: "w2", name: "web", projectName: "shop" },
    ],
    folders: { w1: "/work/api", w2: "/work/web" },
  });
  await Promise.resolve();
  expect(d.age.mock.calls).toEqual([["/work/api"]]);
  answers[0]?.(null);
  await vi.waitFor(() => expect(d.age.mock.calls).toEqual([["/work/api"], ["/work/web"]]));
  answers[1]?.("2021-03-04");
  await feed.settled();
  expect(feed.snapshot().born).toEqual({ web: "2021-03-04" });
});
