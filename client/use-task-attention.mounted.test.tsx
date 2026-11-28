/**
 * @vitest-environment jsdom
 */
// The Tasks card's hook, mounted: an idle claim becomes stalled with time alone, the clock being
// read again every 30 seconds while a task is claimed, and not at all while nothing is.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeAgent, Post } from "../shared/contracts.js";
import type { OfficeModel, OfficeRoom } from "../shared/model.js";
import { STALL_MS } from "./task-attention.js";
import { TICK_MS, useTaskAttention, type TaskAttention } from "./use-task-attention.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const START = Date.parse("2026-11-28T12:00:00.000Z");

function modelWith(state: Post["state"]): OfficeModel {
  const claimed: Post = {
    id: "p1",
    seq: 1,
    board: "lobby",
    kind: "task",
    text: "Task",
    author: "user",
    state,
    claimedBy: "a1",
    createdAt: new Date(START).toISOString(),
    updatedAt: new Date(START).toISOString(),
  };
  const lobby = {
    id: "lobby",
    name: "Lobby",
    lobby: true,
    posts: [claimed],
    todos: [],
    done: [],
    rows: [],
  } as unknown as OfficeRoom;
  const agents = new Map([["a1", { id: "a1", title: "Builder", status: "idle" } as OfficeAgent]]);
  return { rooms: [lobby], agents } as unknown as OfficeModel;
}

let seen: TaskAttention;
function Probe({ model }: { model: OfficeModel }) {
  seen = useTaskAttention({ model, live: true, showBoard: () => undefined });
  return null;
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ now: START });
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

test("an idle claim turns stalled once two minutes pass, with no other event", () => {
  act(() => root.render(<Probe model={modelWith("claimed")} />));
  expect(seen.rows).toEqual([]);
  act(() => void vi.advanceTimersByTime(STALL_MS - TICK_MS));
  expect(seen.rows).toEqual([]);
  act(() => void vi.advanceTimersByTime(TICK_MS));
  expect(seen.rows.map((row) => row.kind)).toEqual(["stalled"]);
  expect(seen.entry?.note?.text).toBe("1 stalled");
});

test("nothing is claimed, so no timer runs; and it stops on unmount", () => {
  act(() => root.render(<Probe model={modelWith("open")} />));
  expect(vi.getTimerCount()).toBe(0);
  act(() => root.render(<Probe model={modelWith("claimed")} />));
  expect(vi.getTimerCount()).toBe(1);
  act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  root = createRoot(container);
});
