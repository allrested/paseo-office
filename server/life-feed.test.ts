import { expect, test, vi } from "vitest";
import { createLifeFeed } from "./life-feed.js";
import type { DirectoryView } from "./hub.js";

const view = (
  over: Partial<DirectoryView> & { folders?: Record<string, string> } = {},
): DirectoryView =>
  ({
    agents: [
      {
        id: "a1",
        workspaceId: "w1",
        status: "idle",
        createdAt: "2026-10-01T00:00:00Z",
        parentAgentId: null,
      } as never,
    ],
    workspaces: [{ id: "w1", name: "api", projectName: "p" } as never],
    folders: { w1: "/work/api" },
    ...over,
  }) as DirectoryView;

const deps = (extra = {}) => ({
  tenure: {
    touch: vi.fn(),
    seed: vi.fn(),
    seeded: () => false,
    list: vi.fn<import("./tenure.js").Tenure["list"]>(() => []),
    markFarewell: vi.fn(() => true),
    markOfficial: vi.fn(() => true),
    get: () => null,
    rename: vi.fn(() => true),
  },
  age: vi.fn(async (_folder: string): Promise<string | null> => "2020-02-03"),
  lift: { pub: () => ({ left: 1, total: 2, newBuild: false, sticker: null }) },
  days: () => ({ choices: [30], days: 30 }),
  now: () => Date.parse("2026-11-19T00:00:00Z"),
  emit: vi.fn(),
  ...extra,
});

test("the first view seeds the ledger with each team and its agents' days", () => {
  const d = deps();
  const feed = createLifeFeed(d);
  feed.view(view());
  expect(d.tenure.seed).toHaveBeenCalledWith([
    { name: "api", first: Date.parse("2026-10-01T00:00:00Z"), daysSeen: 2 },
  ]);
});

test("a repository's age is read once per folder and sent by team name", async () => {
  const d = deps();
  const feed = createLifeFeed(d);
  feed.view(view());
  feed.view(view());
  await feed.settled();
  expect(d.age).toHaveBeenCalledTimes(1);
  expect(feed.snapshot().born).toEqual({ api: "2020-02-03" });
});

test("a workspace that goes by another name keeps its team's tenure", () => {
  const d = deps();
  const feed = createLifeFeed(d);
  feed.view(view());
  feed.view(view({ workspaces: [{ id: "w1", name: "Payments", projectName: "p" } as never] }));
  expect(d.tenure.rename).toHaveBeenCalledTimes(1);
  expect(d.tenure.rename).toHaveBeenCalledWith("api", "Payments");
  // The same name again is no rename, and neither is a workspace seen for the first time.
  feed.view(view({ workspaces: [{ id: "w1", name: "Payments", projectName: "p" } as never] }));
  expect(d.tenure.rename).toHaveBeenCalledTimes(1);
  feed.renamed("Payments", "Checkout");
  expect(d.tenure.rename).toHaveBeenLastCalledWith("Payments", "Checkout");
});

test("a turn that ends touches its team", () => {
  const d = deps();
  const feed = createLifeFeed(d);
  feed.view(view());
  feed.turnEnded("a1");
  expect(d.tenure.touch).toHaveBeenCalledWith("api", expect.objectContaining({ turn: true }));
});

test("an agent in the lobby belongs to no team", () => {
  const d = deps();
  const feed = createLifeFeed(d);
  feed.view(
    view({
      agents: [
        {
          id: "a2",
          workspaceId: null,
          status: "idle",
          createdAt: "2026-10-01T00:00:00Z",
          parentAgentId: null,
        } as never,
      ],
    }),
  );
  feed.turnEnded("a2");
  expect(d.tenure.touch).not.toHaveBeenCalled();
});

test("a farewell or an official write is passed to the ledger with who is live", () => {
  const d = deps();
  const feed = createLifeFeed(d);
  feed.view(view());
  expect(feed.write({ op: "farewell", name: "api" })).toEqual({ ok: true });
  expect(d.tenure.markFarewell).toHaveBeenCalledWith("api", true);
  expect(feed.write({ op: "official", name: "api" })).toEqual({ ok: true });
});

test("agents without their own workspace contribute to the parent's team", () => {
  const d = deps(),
    feed = createLifeFeed(d),
    v = view();
  feed.view({
    ...v,
    agents: [
      ...v.agents,
      { ...v.agents[0]!, id: "child", workspaceId: null, parentAgentId: "a1", status: "running" },
    ],
  });
  feed.turnEnded("child");
  expect(d.tenure.touch.mock.calls).toEqual([
    ["api", { at: d.now() }],
    ["api", { at: d.now(), turn: true }],
  ]);
});

test("workspaces sharing a name retain the first repository age to arrive", async () => {
  let finish!: (date: string) => void;
  const slow = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const d = deps({
    age: (folder: string) => (folder === "/slow" ? slow : Promise.resolve("2020-01-01")),
  });
  const feed = createLifeFeed(d);
  const first = view();
  feed.view({
    ...first,
    workspaces: [...first.workspaces, { ...first.workspaces[0]!, id: "w2" }],
    folders: { w1: "/slow", w2: "/fast" },
  });
  await Promise.resolve();
  expect(feed.snapshot().born.api).toBeUndefined();
  finish("2021-01-01");
  await feed.settled();
  expect(feed.snapshot().born.api).toBe("2021-01-01");
});

test("a turn with the office closed resolves its team from the hook", async () => {
  const d = deps();
  const feed = createLifeFeed(d);
  feed.view(null);
  await feed.turnEnded("unseen", async () => "api");
  expect(d.tenure.touch).toHaveBeenCalledWith("api", expect.objectContaining({ turn: true }));
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

test("how lately a listed team worked is not news: the scenes read who is due, away, back, an intern, ready or permanent", () => {
  const d = deps();
  const listed = (last: number, patch: object = {}) => [
    {
      name: "api",
      last,
      days: 1,
      turns: last,
      due: false,
      farewell: 0,
      back: 0,
      intern: true,
      ready: false,
      official: 0,
      ...patch,
    },
  ];
  d.tenure.list.mockReturnValueOnce(listed(1));
  const feed = createLifeFeed(d);
  feed.view({ ...view(), folders: {} });
  expect(d.emit).toHaveBeenCalledTimes(1);
  d.tenure.list.mockReturnValueOnce(listed(2));
  feed.view({ ...view(), folders: {} });
  expect(d.emit).toHaveBeenCalledTimes(1);
  d.tenure.list.mockReturnValueOnce(listed(3, { ready: true }));
  feed.view({ ...view(), folders: {} });
  expect(d.emit).toHaveBeenCalledTimes(2);
});

test("the first complete directory seeds even a workspace without agents", () => {
  const d = deps();
  const initial = view();
  createLifeFeed(d).view({ ...initial, agents: [] });
  expect(d.tenure.seed).toHaveBeenCalledWith([{ name: "api", first: d.now(), daysSeen: 1 }]);
});

test("the ledger is not seeded before the directory has said its workspaces", () => {
  const d = deps();
  const feed = createLifeFeed(d);
  // The directory tells its agents first and its workspaces after.
  feed.view(view({ workspaces: [] }));
  expect(d.tenure.seed).not.toHaveBeenCalled();
  expect(d.tenure.touch).not.toHaveBeenCalled();
  feed.view(view());
  expect(d.tenure.seed).toHaveBeenCalledTimes(1);
  expect(d.tenure.seed).toHaveBeenCalledWith([
    { name: "api", first: Date.parse("2026-10-01T00:00:00Z"), daysSeen: 2 },
  ]);
});
