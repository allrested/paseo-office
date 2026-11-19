import { expect, test, vi } from "vitest";
import { createWorldBridge } from "./world-bridge.js";
import type { WorldStartOptions } from "./world-api.js";

function bridge() {
  const posted: { call: string; args: unknown[] }[] = [];
  const made = createWorldBridge((text) => posted.push(JSON.parse(text)));
  return { ...made, posted };
}

function options(extra: Partial<WorldStartOptions> = {}): WorldStartOptions {
  return {
    plan: "pro",
    dark: false,
    colors: {} as WorldStartOptions["colors"],
    onSelect: () => undefined,
    onBoard: () => undefined,
    onProblem: () => undefined,
    ...extra,
  };
}

test("calls go to the page in the order they were made, each with its arguments", () => {
  const { api, posted } = bridge();
  api.setSessions([]);
  api.select("a1");
  api.event({ sess: "a1", type: "edit" });
  api.focusProject("team");
  api.setMachine(null);
  expect(posted).toEqual([
    { call: "setSessions", args: [[]] },
    { call: "select", args: ["a1"] },
    { call: "event", args: [{ sess: "a1", type: "edit" }] },
    { call: "focusProject", args: ["team"] },
    { call: "setMachine", args: [null] },
  ]);
});

test("the optional calls and the theme and the board rows go too", () => {
  const { api, posted } = bridge();
  api.setTheme({ dark: true, colors: {} as never });
  api.setBoardRows([]);
  api.setIncidents?.([]);
  api.meet?.();
  api.gather?.();
  expect(posted.map((message) => message.call)).toEqual([
    "setTheme",
    "setBoardRows",
    "setIncidents",
    "meet",
    "gather",
  ]);
});

test("start sends its options without the callbacks, and the names of those given", () => {
  const { api, posted } = bridge();
  api.start(options({ onOpen: () => undefined, photo: false }));
  const [start] = posted;
  const sent = start.args[0] as Record<string, unknown>;
  expect(start.call).toBe("start");
  expect(sent.plan).toBe("pro");
  expect(sent.photo).toBe(false);
  expect(sent.callbacks).toEqual(["onSelect", "onBoard", "onProblem", "onOpen"]);
  expect(Object.keys(sent).filter((key) => key.startsWith("on"))).toEqual([]);
});

test("a callback the page posts calls the real one with its arguments", () => {
  const { api, receive } = bridge();
  const onSelect = vi.fn();
  const onBoard = vi.fn();
  api.start(options({ onSelect, onBoard }));
  receive(JSON.stringify({ callback: "onSelect", args: ["a1"] }));
  receive(JSON.stringify({ callback: "onBoard", args: [null] }));
  expect(onSelect).toHaveBeenCalledWith("a1");
  expect(onBoard).toHaveBeenCalledWith(null);
});

test("a problem the page reports goes to onProblem", () => {
  const { api, receive } = bridge();
  const onProblem = vi.fn();
  api.start(options({ onProblem }));
  receive(JSON.stringify({ problem: "Unexpected office build" }));
  expect(onProblem).toHaveBeenCalledWith("Unexpected office build");
});

test("text that is not a reply, and a callback nobody gave, are ignored", () => {
  const { api, receive } = bridge();
  const onSelect = vi.fn();
  api.start(options({ onSelect }));
  receive("not json");
  receive(JSON.stringify({ callback: "onOpen", args: ["a1"] }));
  receive(JSON.stringify({ other: true }));
  expect(onSelect).not.toHaveBeenCalled();
});

test("a logo that is not a data URL is dropped, and the sign shows the name alone", () => {
  const { api, posted } = bridge();
  api.start(options({ brand: { name: "Acme", logoUrl: "https://example.com/logo.png" } }));
  api.start(options({ brand: { name: "Acme", logoUrl: "data:image/png;base64,AAAA" } }));
  expect(posted.map((message) => (message.args[0] as { brand: unknown }).brand)).toEqual([
    { name: "Acme", logoUrl: null },
    { name: "Acme", logoUrl: "data:image/png;base64,AAAA" },
  ]);
});

test("stop sends its message", () => {
  const { api, posted } = bridge();
  api.stop();
  expect(posted).toEqual([{ call: "stop", args: [] }]);
});

test("the bridge speaks the contract's version", () => {
  expect(bridge().api.version).toBe(1);
});

test("setSound goes to the page as a call, and the scene's onSound comes back as a callback", () => {
  const { api, posted, receive } = bridge();
  const onSound = vi.fn();
  api.start(options({ onSound }));
  api.setSound?.(true);
  expect(posted.map((m) => m.call)).toEqual(["start", "setSound"]);
  expect(posted[1]).toEqual({ call: "setSound", args: [true] });
  const started = posted[0]?.args[0] as { callbacks: string[] };
  expect(started.callbacks).toContain("onSound");
  receive(JSON.stringify({ callback: "onSound", args: [true] }));
  expect(onSound).toHaveBeenCalledWith(true);
});

test("posts a full-sized street kit intact as start data", () => {
  const kit = "x".repeat(430_000);
  const { api, posted } = bridge();
  api.start(options({ street: { kit } }));
  expect(posted[0].args[0]).toMatchObject({ street: { kit } });
});
