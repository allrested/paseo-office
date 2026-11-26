/**
 * @vitest-environment jsdom
 */
// The Teams section, mounted. Its saves go through the header's `change`, so a stand-in records
// each patch and answers as the host would.
import { act, useCallback, useEffect, useState, type ComponentProps } from "react";
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

// The host's values and revision: a save made from an older revision is refused, as the settings
// file refuses it.
let values: HostValues;
let revision: number;
// What the section is drawn with. The host draws a kept save only on a later turn, after the save
// has been answered, as the settings query hands its new data on.
let drawnValues: HostValues;
let drawnRevision: number;
let hidden: boolean;
let gate: Promise<void>;
let saves: { patch: Partial<HostValues>; current: boolean }[];
let problem: string | null;
let holders: RosterHolders;
let container: HTMLElement;
let root: Root;
let redraw: () => void;

function Harness() {
  const styles = useOfficeStyles(THEME, true, true);
  const [, setDrawn] = useState(0);
  useEffect(() => {
    redraw = () => setDrawn((count) => count + 1);
  }, []);
  // As the host: the values are parsed again on every render, so they are a new object each time;
  // `change` closes over the values and revision this render saw, and the patch is checked against
  // them, kept when valid and current.
  const seen = officeHostSettings.schema.parse(drawnValues);
  const seenRevision = drawnRevision;
  const change = useCallback<ChangeTeams>(
    async (_setting, patch) => {
      saves.push({ patch, current: seenRevision === revision });
      // The host draws the section again while the save is out.
      redraw();
      await gate;
      await Promise.resolve();
      const checked = officeHostSettings.schema.safeParse({ ...seen, ...patch });
      if (seenRevision !== revision) {
        problem = "The settings changed since they were read.";
      } else if (!checked.success) {
        problem = checked.error.issues.map((issue) => issue.message).join("\n");
      } else {
        values = checked.data;
        revision += 1;
        problem = null;
      }
      const kept = problem === null;
      setTimeout(() => {
        drawnValues = values;
        drawnRevision = revision;
        redraw();
      }, 0);
      return kept;
    },
    [seen, seenRevision],
  );
  return (
    <TeamsSettings
      values={hidden ? null : seen}
      revision={hidden ? null : String(seenRevision)}
      change={change}
      problem={problem}
      holders={holders}
      styles={styles}
    />
  );
}

const mount = () =>
  act(async () => {
    drawnValues = values;
    drawnRevision = revision;
    root.render(<Harness />);
  });

beforeEach(() => {
  values = { ...DEFAULTS };
  revision = 0;
  hidden = false;
  gate = Promise.resolve();
  saves = [];
  problem = null;
  holders = { members: new Set() };
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

// Lets every save the last action started be answered, and the section drawn again.
const settle = async () => {
  for (let turn = 0; turn < 5; turn += 1) {
    await act(async () => new Promise((done) => setTimeout(done, 0)));
  }
};

const patches = () => saves.map((save) => save.patch);

async function press(label: string): Promise<void> {
  await act(async () => byLabel(label).click());
  await settle();
}

function typeInto(label: string, text: string): Promise<void> {
  const input = byLabel<HTMLInputElement>(label);
  return act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const leave = (label: string) => {
  byLabel(label).dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
};

async function type(label: string, text: string): Promise<void> {
  await typeInto(label, text);
  await act(async () => leave(label));
  await settle();
}

test("the switch turns the roster on and raises the edition", async () => {
  await mount();
  const roster = byLabel("Name teams and agents from the roster");
  expect(roster.getAttribute("aria-checked")).toBe("false");
  await press("Name teams and agents from the roster");
  expect(patches()).toEqual([{ rosterOn: true, rosterEdition: 1, teams: [] }]);
  await press("Name teams and agents from the roster");
  expect(patches().at(-1)).toEqual({ rosterOn: false, rosterEdition: 1, teams: [] });
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

test("a team says how many of its teammates sit, and a held teammate is marked", async () => {
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
  holders = { members: new Set(["m1"]) };
  await mount();
  expect(container.textContent).toContain("1 of 2 at a desk");
  expect(byLabel("TJ, at a desk")).toBeTruthy();
  expect(container.querySelector('[aria-label="Zaki, at a desk"]')).toBeNull();
});

test("two Add team presses before a re-render keep both teams and raise the edition", async () => {
  values = { ...DEFAULTS, rosterOn: true, rosterEdition: 1 };
  await mount();
  await act(async () => {
    byLabel("Add team").click();
    byLabel("Add team").click();
  });
  await settle();
  expect(values.teams.map((team) => team.name)).toEqual(["Team 1", "Team 2"]);
  expect(values.rosterEdition).toBeGreaterThan(1);
  expect(saves.every((save) => save.current)).toBe(true);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

test("a rename and an Add teammate pressed before the rename is answered both land", async () => {
  values = {
    ...DEFAULTS,
    rosterOn: true,
    teams: [{ id: "t1", name: "PR-DEV", members: [] }],
  };
  await mount();
  await typeInto("PR-DEV name", "Platform");
  await act(async () => {
    leave("PR-DEV name");
    byLabel("Add teammate to PR-DEV").click();
  });
  await settle();
  expect(values.teams.map((team) => team.name)).toEqual(["Platform"]);
  expect(values.teams[0].members.map((member) => member.name)).toEqual(["Teammate 1"]);
  expect(saves.every((save) => save.current)).toBe(true);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

test("a refused save does not block the edit queued behind it", async () => {
  values = {
    ...DEFAULTS,
    rosterOn: true,
    teams: [
      { id: "t1", name: "PR-DEV", members: [] },
      { id: "t2", name: "PR-QA", members: [] },
    ],
  };
  await mount();
  await typeInto("PR-QA name", "pr-dev");
  await act(async () => {
    leave("PR-QA name");
    byLabel("Add team").click();
  });
  await settle();
  expect(values.teams.map((team) => team.name)).toEqual(["PR-DEV", "PR-QA", "Team 3"]);
  expect(byLabel<HTMLInputElement>("PR-QA name").value).toBe("PR-QA");
});

test("an edit queued while the settings cannot be read is answered, not saved later", async () => {
  values = {
    ...DEFAULTS,
    rosterOn: true,
    teams: [{ id: "t1", name: "PR-DEV", members: [] }],
  };
  await mount();
  let release = () => {};
  gate = new Promise((done) => (release = () => done()));
  await typeInto("PR-DEV name", "Platform");
  await act(async () => {
    leave("PR-DEV name");
    byLabel("Add teammate to PR-DEV").click();
  });
  hidden = true;
  await act(async () => redraw());
  release();
  await settle();
  hidden = false;
  await act(async () => redraw());
  await settle();
  expect(saves).toHaveLength(1);
  expect(values.teams[0].members).toEqual([]);
});

test("an edit that changes nothing saves nothing, and the next edit still saves", async () => {
  values = {
    ...DEFAULTS,
    rosterOn: true,
    rosterEdition: 1,
    teams: [
      { id: "t1", name: "PR-DEV", members: [] },
      { id: "t2", name: "PR-QA", members: [] },
    ],
  };
  await mount();
  await press("Move PR-DEV up");
  expect(saves).toEqual([]);
  await press("Add team");
  expect(values.teams.map((team) => team.name)).toEqual(["PR-DEV", "PR-QA", "Team 3"]);
  expect(saves.every((save) => save.current)).toBe(true);
});

const refuse = async () => false;

function Unread() {
  const styles = useOfficeStyles(THEME, true, true);
  return (
    <TeamsSettings
      values={null}
      revision={null}
      change={refuse}
      problem={null}
      holders={holders}
      styles={styles}
    />
  );
}

test("nothing can be changed while the settings are read", async () => {
  await act(async () => root.render(<Unread />));
  expect(container.querySelector('[aria-label="Add team"]')).toBeNull();
});
