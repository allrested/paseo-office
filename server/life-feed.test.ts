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
    list: () => [],
    markFarewell: vi.fn(() => true),
    markOfficial: vi.fn(() => true),
    get: () => null,
  },
  age: vi.fn(async () => "2020-02-03"),
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
  expect(feed.snapshot().born.api).toBe("2020-01-01");
  finish("2021-01-01");
  await feed.settled();
  expect(feed.snapshot().born.api).toBe("2020-01-01");
});

test("a turn with the office closed resolves its team from the hook", async () => {
  const d = deps();
  const feed = createLifeFeed(d);
  feed.view(null);
  await feed.turnEnded("unseen", async () => "api");
  expect(d.tenure.touch).toHaveBeenCalledWith("api", expect.objectContaining({ turn: true }));
});
