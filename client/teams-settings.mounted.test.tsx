/**
 * @vitest-environment jsdom
 */
// The Teams section, mounted. Its saves go through the header's `change`, so a stand-in records
// each patch and answers as the host would.
import { act, useCallback, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { officeHostSettings } from "../shared/settings.js";
import type { HostValues } from "./host-switches.js";
import { useOfficeStyles } from "./styles.js";
import { TeamsSettings } from "./teams-settings.js";
import type { RosterHolders } from "./teams-text.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { TextInput } = await import("react-native");
  return { TextInput, Icon: () => null };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const DEFAULTS: HostValues = officeHostSettings.schema.parse({});

type ChangeTeams = ComponentProps<typeof TeamsSettings>["change"];

let values: HostValues;
let patches: Partial<HostValues>[];
let problem: string | null;
let holders: RosterHolders;
let container: HTMLElement;
let root: Root;

function Harness() {
  const styles = useOfficeStyles(THEME, true, true);
  // As the host: the patch is checked, kept when valid, and the section drawn again.
  const change = useCallback<ChangeTeams>(async (_setting, patch) => {
    patches.push(patch);
    const checked = officeHostSettings.schema.safeParse({ ...values, ...patch });
    if (!checked.success) {
      problem = checked.error.issues.map((issue) => issue.message).join("\n");
      return false;
    }
    values = checked.data;
    problem = null;
    return true;
  }, []);
  return (
    <TeamsSettings
      values={values}
      change={change}
      problem={problem}
      holders={holders}
      styles={styles}
    />
  );
}

const mount = () => act(async () => root.render(<Harness />));

beforeEach(() => {
  values = { ...DEFAULTS };
  patches = [];
  problem = null;
  holders = { teams: new Map(), members: new Set() };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function byLabel<Found extends HTMLElement>(label: string): Found {
  const found = container.querySelector<Found>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`Nothing is labelled "${label}"`);
  return found;
}

async function press(label: string): Promise<void> {
  await act(async () => byLabel(label).click());
  await mount();
}

async function type(label: string, text: string): Promise<void> {
  const input = byLabel<HTMLInputElement>(label);
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
  await mount();
}

test("the switch turns the roster on and raises the edition", async () => {
  await mount();
  const roster = byLabel("Name teams and agents from the roster");
  expect(roster.getAttribute("aria-checked")).toBe("false");
  await press("Name teams and agents from the roster");
  expect(patches).toEqual([{ rosterOn: true, rosterEdition: 1, teams: [] }]);
  await press("Name teams and agents from the roster");
  expect(patches.at(-1)).toEqual({ rosterOn: false, rosterEdition: 1, teams: [] });
});

test("a team and its teammates are added, renamed, moved and removed", async () => {
  values = { ...DEFAULTS, rosterOn: true, rosterEdition: 1 };
  await mount();
  await press("Add team");
  expect(values.teams.map((team) => team.name)).toEqual(["Team 1"]);
  expect(values.rosterEdition).toBe(2);
  await type("Team 1 name", "PR-DEV");
  expect(values.teams[0].name).toBe("PR-DEV");
  // A rename hands nothing new out.
  expect(values.rosterEdition).toBe(2);
  await press("Add teammate to PR-DEV");
  await type("PR-DEV teammate 1", "Tze Jun Tan");
  await press("Add teammate to PR-DEV");
  await type("PR-DEV teammate 2", "Kharisma Muzaki Ghufron");
  expect(values.teams[0].members.map((member) => member.name)).toEqual([
    "Tze Jun Tan",
    "Kharisma Muzaki Ghufron",
  ]);
  expect(values.rosterEdition).toBe(4);
  await press("Move Kharisma Muzaki Ghufron up");
  expect(values.teams[0].members.map((member) => member.name)).toEqual([
    "Kharisma Muzaki Ghufron",
    "Tze Jun Tan",
  ]);
  await press("Remove Tze Jun Tan");
  expect(values.teams[0].members.map((member) => member.name)).toEqual(["Kharisma Muzaki Ghufron"]);
  await press("Add team");
  await press("Move Team 2 up");
  expect(values.teams.map((team) => team.name)).toEqual(["Team 2", "PR-DEV"]);
  await press("Remove team Team 2");
  expect(values.teams.map((team) => team.name)).toEqual(["PR-DEV"]);
});

test("a name the settings refuse is reported and not kept", async () => {
  values = {
    ...DEFAULTS,
    rosterOn: true,
    teams: [
      { id: "t1", name: "PR-DEV", members: [] },
      { id: "t2", name: "PR-QA", members: [] },
    ],
  };
  await mount();
  await type("PR-QA name", "pr-dev");
  expect(values.teams[1].name).toBe("PR-QA");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(
    '"pr-dev" is there twice',
  );
  expect(byLabel<HTMLInputElement>("PR-QA name").value).toBe("PR-QA");
});

test("a held team says which workspace has it, and a held teammate is marked", async () => {
  values = {
    ...DEFAULTS,
    rosterOn: true,
    teams: [
      {
        id: "t1",
        name: "PR-DEV",
        members: [
          { id: "m1", name: "TJ" },
          { id: "m2", name: "Zaki" },
        ],
      },
    ],
  };
  holders = { teams: new Map([["t1", "paseo-7f3a"]]), members: new Set(["m1"]) };
  await mount();
  expect(container.textContent).toContain("Workspace paseo-7f3a");
  expect(byLabel("TJ, at a desk")).toBeTruthy();
  expect(container.querySelector('[aria-label="Zaki, at a desk"]')).toBeNull();
});

const refuse = async () => false;

function Unread() {
  const styles = useOfficeStyles(THEME, true, true);
  return (
    <TeamsSettings values={null} change={refuse} problem={null} holders={holders} styles={styles} />
  );
}

test("nothing can be changed while the settings are read", async () => {
  await act(async () => root.render(<Unread />));
  expect(container.querySelector('[aria-label="Add team"]')).toBeNull();
});
