import { expect, test } from "vitest";
import { officeColumnSettings } from "../shared/settings.js";
import {
  COLUMN_TABS,
  NO_SESSIONS,
  clampColumn,
  closeSession,
  countLabel,
  keepKnown,
  openSession,
  showTab,
} from "./column-model.js";

const view = (agentId: string) => ({ kind: "session" as const, agentId });

test("the tabs are Attention, Sessions, Activity and Chat, in that order", () => {
  expect(COLUMN_TABS.map((each) => each.label)).toEqual([
    "Attention",
    "Sessions",
    "Activity",
    "Chat",
  ]);
});

test("a width is kept between the least and the most", () => {
  expect(clampColumn(100, 1280)).toBe(280);
  expect(clampColumn(400, 1280)).toBe(400);
  expect(clampColumn(900, 1280)).toBe(560);
});

test("the floor keeps its least width on a narrow surface", () => {
  // 700 wide: the floor's 320 leaves 380 for the column.
  expect(clampColumn(500, 700)).toBe(380);
  // Too narrow for both: the column is at its least and the floor gives way.
  expect(clampColumn(500, 500)).toBe(280);
});

test("a surface not measured yet leaves the width within the column's own limits", () => {
  expect(clampColumn(400, 0)).toBe(400);
  expect(clampColumn(900, 0)).toBe(560);
});

test("a count shows as a number, capped, and nothing at zero", () => {
  expect(countLabel(0)).toBeNull();
  expect(countLabel(3)).toBe("3");
  expect(countLabel(120)).toBe("99+");
});

test("a device that never set the column has it open at the default width", () => {
  expect(officeColumnSettings.schema.parse({})).toEqual({ width: 360, collapsed: false });
});

test("the column starts on Sessions with no session open", () => {
  expect(NO_SESSIONS).toEqual({
    open: [],
    view: { kind: "tab", tab: "sessions" },
  });
});

test("opening a session adds its tab at the end and shows it", () => {
  const one = openSession(NO_SESSIONS, "a");
  const two = openSession(one, "b");
  expect(two).toEqual({ open: ["a", "b"], view: view("b") });
});

test("opening a session that is open selects its tab and keeps the order", () => {
  const tabs = openSession(openSession(openSession(NO_SESSIONS, "a"), "b"), "a");
  expect(tabs).toEqual({ open: ["a", "b"], view: view("a") });
});

test("closing the shown session shows the one to its left, or Sessions", () => {
  const two = openSession(openSession(NO_SESSIONS, "a"), "b");
  expect(closeSession(two, "b")).toEqual({ open: ["a"], view: view("a") });
  expect(closeSession(closeSession(two, "b"), "a")).toEqual(NO_SESSIONS);
});

test("closing the first of several shown sessions shows the next one", () => {
  const two = openSession(openSession(NO_SESSIONS, "a"), "b");
  const onFirst = openSession(two, "a");
  expect(closeSession(onFirst, "a")).toEqual({ open: ["b"], view: view("b") });
});

test("closing a session that is not shown leaves the view", () => {
  const two = openSession(openSession(NO_SESSIONS, "a"), "b");
  expect(closeSession(two, "a")).toEqual({ open: ["b"], view: view("b") });
  expect(closeSession(two, "zz")).toBe(two);
});

test("a fixed tab shows without closing any session", () => {
  const one = openSession(NO_SESSIONS, "a");
  expect(showTab(one, "chat")).toEqual({
    open: ["a"],
    view: { kind: "tab", tab: "chat" },
  });
});

test("a session whose agent is gone is dropped", () => {
  const two = openSession(openSession(NO_SESSIONS, "a"), "b");
  expect(keepKnown(two, new Set(["a"]))).toEqual({
    open: ["a"],
    view: view("a"),
  });
  expect(keepKnown(two, new Set(["a", "b"]))).toBe(two);
});
