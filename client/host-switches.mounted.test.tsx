/**
 * @vitest-environment jsdom
 */
// The header's host settings, mounted. The settings hook and the text field are the host's, so
// stand-ins record what the header saved.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import type { SettingsState } from "@getpaseo/plugin/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { IncidentsState } from "../shared/contracts.js";
import { officeHostSettings } from "../shared/settings.js";
import { PLAN_DESKS } from "./world/adapter.js";
import { stockSave } from "./stock-save.test.js";
import { HostSwitches } from "./host-switches.js";
import { useOfficeStyles } from "./styles.js";
import type { BoardActions } from "./use-board-actions.js";

type HostSettings = SettingsState<typeof officeHostSettings.schema>;
type HostValues = Extract<HostSettings, { status: "ready" }>["values"];

interface Saved {
  values: HostValues;
  revision: string;
}

let saved: Saved[];
let calls: { name: string; input: unknown }[];
let rpcAnswer: { ok: true } | { ok: false; problem: string };
let modesAnswer: unknown;
const CLAUDE_MODES = {
  ok: true,
  provider: "Claude",
  modes: [
    { id: "acceptEdits", label: "Accept File Edits" },
    { id: "auto", label: "Auto mode" },
    { id: "bypassPermissions", label: "Bypass" },
  ],
  modeId: "acceptEdits",
  fellBack: false,
};
let saveError: string | null;
/** Set to keep each save waiting for the host's answer. */
let answer: Promise<boolean> | null;
let stored: HostValues;
const SUNDAY_TO_THURSDAY = [0, 1, 2, 3, 4];
/** The incident fields as a host that never set them holds them. */
const NO_TRACKERS = {
  jiraProjects: "",
  sentryOrg: "",
  sentryProjects: "",
  weatherMode: "off" as const,
  weatherManual: "season" as const,
  weatherUrl: "",
  sentryUrl: "https://sentry.io",
};

// Desk counts unlike the real table's, so a hint that copied the real numbers would not match.
vi.mock("./world/adapter.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./world/adapter.js")>()),
  PLAN_DESKS: { pro: 7, cozy: 5 },
}));

vi.mock("@getpaseo/plugin/client", () => ({
  // The two tracker calls: what was sent is recorded, and `rpcAnswer` is the host's reply.
  useRpc: (contract: { name: string }) => async (input: unknown) => {
    // The mode row asks as it shows; only the tracker calls are recorded.
    if (contract.name === "office.notes.modes.request") return modesAnswer;
    calls.push({ name: contract.name, input });
    return rpcAnswer;
  },
  useSettings: (): HostSettings => ({
    status: "ready",
    revision: "r1",
    values: stored,
    saving: false,
    saveError,
    // As the app's hook: values the schema refuses are not sent, and its messages are the error.
    save: async (values: HostValues, revision: string) => {
      const checked = officeHostSettings.schema.safeParse(values);
      if (!checked.success) {
        saveError = checked.error.issues.map((issue) => issue.message).join("\n");
        return false;
      }
      if (!(await stockSave(officeHostSettings)(values))) return false;
      saved.push({ values, revision });
      return answer ?? true;
    },
    reset: async () => true,
    reload: async () => undefined,
  }),
}));

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { TextInput } = await import("react-native");
  return { TextInput, Icon: () => null };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const ACTIONS = {
  setWakesPaused: async () => undefined,
} as unknown as BoardActions;
const WAKE = { paused: false, queued: {} };

type Trackers = Pick<IncidentsState, "jiraReady" | "sentryReady" | "scheduleError" | "connections">;

interface HarnessProps {
  scheduleError: string | null;
  incidents: Trackers | undefined;
}

function Harness({ scheduleError, incidents }: HarnessProps) {
  const styles = useOfficeStyles(THEME, false, false);
  return (
    <HostSwitches
      wake={WAKE}
      actions={ACTIONS}
      styles={styles}
      deviceProblem={null}
      scheduleError={scheduleError}
      incidents={incidents}
    />
  );
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  saved = [];
  calls = [];
  rpcAnswer = { ok: true };
  modesAnswer = CLAUDE_MODES;
  saveError = null;
  answer = null;
  stored = {
    archiveOnDeparture: false,
    agentTools: false,
    notesFolder: "",
    notesTimeZone: "Asia/Riyadh",
    notesMode: "",
    notesDays: SUNDAY_TO_THURSDAY,
    floorPlan: "pro",
    streamerMode: true,
    historyVault: false,
    pinnedNotes: "",
    cacheClock: "1h",
    chatCulture: "international",
    stickyNotes: "",
    ...NO_TRACKERS,
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = (scheduleError: string | null = null, incidents?: Trackers) =>
  act(async () => root.render(<Harness scheduleError={scheduleError} incidents={incidents} />));

function field(label: string): HTMLInputElement {
  const found = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!found) throw new Error(`No field is labelled "${label}"`);
  return found;
}

async function type(label: string, text: string): Promise<void> {
  const input = field(label);
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function leave(label: string): Promise<void> {
  await act(async () => field(label).blur());
}

async function submit(label: string): Promise<void> {
  await act(async () => {
    field(label).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

test("the notes folder saves once it loses focus, trimmed, and keeps the other settings", async () => {
  await mount();
  await type("Notes folder", " /workspace/");
  await type("Notes folder", " /workspace/notes ");
  expect(saved).toEqual([]);

  await leave("Notes folder");
  expect(saved).toEqual([
    {
      values: {
        archiveOnDeparture: false,
        agentTools: false,
        notesFolder: "/workspace/notes",
        notesTimeZone: "Asia/Riyadh",
        notesMode: "",
        notesDays: SUNDAY_TO_THURSDAY,
        floorPlan: "pro",
        streamerMode: true,
        historyVault: false,
        pinnedNotes: "",
        cacheClock: "1h",
        chatCulture: "international",
        stickyNotes: "",
        ...NO_TRACKERS,
      },
      revision: "r1",
    },
  ]);
});

test("a submitted time zone saves once, though the submit also takes the focus away", async () => {
  let reply: (saved: boolean) => void = () => undefined;
  answer = new Promise((resolve) => {
    reply = resolve;
  });
  await mount();
  await type("Time zone", "Europe/Berlin");
  await submit("Time zone");
  // The field loses its focus while the host has not answered yet.
  await leave("Time zone");
  expect(saved.map((save) => save.values.notesTimeZone)).toEqual(["Europe/Berlin"]);
  expect(field("Time zone").value).toBe("Europe/Berlin");
  await act(async () => reply(true));
});

test("a field left as it was saves nothing", async () => {
  await mount();
  await type("Time zone", " Asia/Riyadh ");
  await leave("Time zone");
  expect(saved).toEqual([]);
});

test("the archive switch is off until enabled and saves the host preference", async () => {
  await mount();
  const control = container.querySelector<HTMLElement>('[aria-label="Archive idle sessions"]')!;
  expect(control.getAttribute("aria-checked")).toBe("false");
  await act(async () => control.click());
  expect(saved.map((save) => save.values.archiveOnDeparture)).toEqual([true]);
  stored = saved[0]!.values;
  await mount();
  expect(control.getAttribute("aria-checked")).toBe("true");
  await act(async () => control.click());
  expect(saved.at(-1)?.values.archiveOnDeparture).toBe(false);
});

test("the switch keeps the notes settings when it saves", async () => {
  await mount();
  await act(async () =>
    container.querySelector<HTMLElement>('[aria-label="Agent tools"]')?.click(),
  );
  expect(saved.map((save) => save.values)).toEqual([
    {
      archiveOnDeparture: false,
      agentTools: true,
      notesFolder: "",
      notesTimeZone: "Asia/Riyadh",
      notesMode: "",
      notesDays: SUNDAY_TO_THURSDAY,
      floorPlan: "pro",
      streamerMode: true,
      historyVault: false,
      pinnedNotes: "",
      cacheClock: "1h",
      chatCulture: "international",
      stickyNotes: "",
      ...NO_TRACKERS,
    },
  ]);
});

/** The text of the field's block: its label, the field, its hint and its failure. */
const fieldBlock = (label: string) => field(label).parentElement?.textContent ?? "";
const alerts = () =>
  [...container.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent);

test("the schedule's failure shows under the Time zone field", async () => {
  await mount("Invalid cron time zone: Mars/Base");
  expect(fieldBlock("Time zone")).toBe(
    "Time zone" +
      "For the 8:00 run. Empty uses this host's." +
      "Unable to schedule the stand-up notes: Invalid cron time zone: Mars/Base",
  );
  expect(alerts()).toHaveLength(1);
});

test("a refused save shows under the field it was for", async () => {
  await mount();
  await type("Notes folder", "/notes");
  await leave("Notes folder");
  // The hook reports the refusal on its next render.
  saveError = "Settings changed on another client. Reload before saving again.";
  await mount();
  expect(alerts()).toEqual([
    "Unable to save the Notes folder setting: Settings changed on another client. Reload before saving again.",
  ]);
  expect(fieldBlock("Notes folder")).toContain("Unable to save the Notes folder setting");
});

test("a bad key shows the schema's message and is not saved", async () => {
  await mount();
  await type("Jira projects", "SHOP, shop");
  await leave("Jira projects");
  expect(saved).toEqual([]);
  // The hook reports the refusal on its next render.
  await mount();
  expect(fieldBlock("Jira projects")).toContain(
    'Unable to save the Jira projects setting: jiraProjects: "shop" is not a Jira project key',
  );
  expect(field("Jira projects").value).toBe("");
});

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayRow(): HTMLElement {
  const found = container.querySelector<HTMLElement>('[role="group"][aria-label="Stand-up days"]');
  if (!found) throw new Error("No Stand-up days group");
  return found;
}

/** Each day's button as `<name> <aria-pressed>`, in the row's order. */
const dayButtons = () =>
  [...dayRow().querySelectorAll('[role="button"]')].map(
    (button) => `${button.getAttribute("aria-label")} ${button.getAttribute("aria-pressed")}`,
  );

async function pressDay(day: string): Promise<void> {
  await act(async () =>
    dayRow().querySelector<HTMLElement>(`[role="button"][aria-label="${day}"]`)?.click(),
  );
}

test("the stand-up days are seven buttons, pressed for the stored days", async () => {
  await mount();
  expect(dayButtons()).toEqual(DAYS.map((day, index) => `${day} ${index <= 4}`));
});

test("a pressed day saves the new list, in order, and keeps every other setting", async () => {
  let reply: (saved: boolean) => void = () => undefined;
  answer = new Promise((resolve) => {
    reply = resolve;
  });
  await mount();
  await pressDay("Saturday");
  // The press shows at once, before the host has answered.
  expect(dayButtons().at(6)).toBe("Saturday true");
  expect(saved).toEqual([{ values: { ...stored, notesDays: [0, 1, 2, 3, 4, 6] }, revision: "r1" }]);
  await act(async () => reply(true));

  answer = null;
  await pressDay("Sunday");
  expect(saved.at(-1)?.values).toEqual({ ...stored, notesDays: [1, 2, 3, 4] });
});

test("while the host has not answered a day, the days take no press", async () => {
  let reply: (saved: boolean) => void = () => undefined;
  answer = new Promise((resolve) => {
    reply = resolve;
  });
  await mount();
  await pressDay("Saturday");
  await pressDay("Friday");
  expect(saved.map((save) => save.values.notesDays)).toEqual([[0, 1, 2, 3, 4, 6]]);
  const disabled = () =>
    [...dayRow().querySelectorAll('[role="button"]')].map((button) =>
      button.getAttribute("aria-disabled"),
    );
  expect(disabled()).toEqual(DAYS.map(() => "true"));

  await act(async () => reply(true));
  answer = null;
  expect(disabled()).toEqual(DAYS.map(() => null));
  await pressDay("Friday");
  expect(saved.map((save) => save.values.notesDays)).toEqual([
    [0, 1, 2, 3, 4, 6],
    [0, 1, 2, 3, 4, 5],
  ]);
});

test("a refused day goes back and shows the reason under the row", async () => {
  answer = Promise.resolve(false);
  await mount();
  await pressDay("Friday");
  saveError = "Settings changed on another client. Reload before saving again.";
  await mount();
  expect(dayButtons().at(5)).toBe("Friday false");
  expect(dayRow().parentElement?.textContent).toContain(
    "Unable to save the Stand-up days setting: Settings changed on another client.",
  );
});

test("with no day chosen the hint says nothing runs at 8:00 and the bell still does", async () => {
  stored = { ...stored, notesDays: [] };
  await mount();
  expect(dayButtons().every((button) => button.endsWith(" false"))).toBe(true);
  expect(dayRow().parentElement?.textContent).toContain(
    "No day chosen: nothing runs at 8:00. The bell still starts the notes.",
  );
});

const planRow = () => {
  const found = container.querySelector('[role="group"][aria-label="Floor plan"]');
  if (!found) throw new Error("No Floor plan row");
  return found as HTMLElement;
};
/** Each plan's button as `<name> <aria-pressed>`, in the row's order. */
const planButtons = () =>
  [...planRow().querySelectorAll('[role="button"]')].map(
    (button) => `${button.getAttribute("aria-label")} ${button.getAttribute("aria-pressed")}`,
  );
async function pressPlan(name: string): Promise<void> {
  await act(async () =>
    planRow().querySelector<HTMLElement>(`[role="button"][aria-label="${name}"]`)?.click(),
  );
}

test("the floor plan row has three buttons, the stored one pressed", async () => {
  await mount();
  expect(planButtons()).toEqual(["Company floor true", "Cozy room false", "Headquarters false"]);
  stored = { ...stored, floorPlan: "cozy" };
  await mount();
  expect(planButtons()).toEqual(["Company floor false", "Cozy room true", "Headquarters false"]);
});

test("the hint says the plan is for the 3D floor only, and what a change does", async () => {
  await mount();
  const text = planRow().parentElement?.textContent ?? "";
  expect(text).toContain("For the 3D view.");
  expect(text).toContain(`Headquarters ${PLAN_DESKS.hq}`);
  expect(text).toContain(`Company floor has ${PLAN_DESKS.pro} desks`);
  expect(text).toContain(`Cozy room ${PLAN_DESKS.cozy}`);
  expect(text).toContain("starts the 3D view again");
});

test("a pressed plan saves the whole document with only the plan changed", async () => {
  let reply: (saved: boolean) => void = () => undefined;
  answer = new Promise((resolve) => {
    reply = resolve;
  });
  await mount();
  await pressPlan("Cozy room");
  // The press shows at once, before the host has answered.
  expect(planButtons()).toEqual(["Company floor false", "Cozy room true", "Headquarters false"]);
  expect(saved).toEqual([{ values: { ...stored, floorPlan: "cozy" }, revision: "r1" }]);
  await act(async () => reply(true));
});

test("while the host has not answered the plan, the row takes no other press", async () => {
  let reply: (saved: boolean) => void = () => undefined;
  answer = new Promise((resolve) => {
    reply = resolve;
  });
  await mount();
  await pressPlan("Cozy room");
  await pressPlan("Company floor");
  expect(saved.map((save) => save.values.floorPlan)).toEqual(["cozy"]);
  const disabled = () =>
    [...planRow().querySelectorAll('[role="button"]')].map((button) =>
      button.getAttribute("aria-disabled"),
    );
  expect(disabled()).toEqual(["true", "true", "true"]);

  await act(async () => reply(true));
  answer = null;
  // The host now holds the cozy room.
  stored = { ...stored, floorPlan: "cozy" };
  await mount();
  expect(disabled()).toEqual([null, null, null]);
  await pressPlan("Company floor");
  expect(saved.map((save) => save.values.floorPlan)).toEqual(["cozy", "pro"]);
});

test("pressing the plan already stored saves nothing", async () => {
  await mount();
  await pressPlan("Company floor");
  expect(saved).toEqual([]);
});

test("a refused plan goes back and shows the reason under the row", async () => {
  answer = Promise.resolve(false);
  await mount();
  await pressPlan("Cozy room");
  saveError = "Settings changed on another client. Reload before saving again.";
  await mount();
  expect(planButtons()).toEqual(["Company floor true", "Cozy room false", "Headquarters false"]);
  expect(planRow().parentElement?.textContent).toContain(
    "Unable to save the Floor plan setting: Settings changed on another client.",
  );
});

function modeRow(): HTMLElement {
  const row = container.querySelector<HTMLElement>('[role="group"][aria-label="Writer mode"]');
  if (!row) throw new Error("No writer mode row");
  return row;
}
const modePills = () =>
  [...modeRow().querySelectorAll('[role="button"]')].map(
    (pill) => `${pill.getAttribute("aria-label")} ${pill.getAttribute("aria-pressed")}`,
  );

test("the writer mode row lists the provider's modes, the office's choice pressed while none is set", async () => {
  await mount();
  expect(modePills()).toEqual([
    "Office's choice true",
    "Accept File Edits false",
    "Auto mode false",
    "Bypass false",
  ]);
  await act(async () =>
    modeRow().querySelector<HTMLElement>('[role="button"][aria-label="Bypass"]')?.click(),
  );
  expect(saved.at(-1)?.values.notesMode).toBe("bypassPermissions");
});

test("a mode that asks for nothing says so, and one the provider lacks says what is used", async () => {
  stored = { ...stored, notesMode: "bypassPermissions" };
  await mount();
  expect(modeRow().parentElement?.textContent).toContain(
    "In this mode the writer runs any tool or command without asking.",
  );

  stored = { ...stored, notesMode: "full-access" };
  modesAnswer = { ...CLAUDE_MODES, fellBack: true };
  await mount();
  expect(modePills().at(-1)).toBe("full-access true");
  expect(modeRow().parentElement?.textContent).toContain(
    'Claude has no mode "full-access": the writer starts in Accept File Edits.',
  );

  modesAnswer = { ok: false, problem: "No agent provider is ready on this host" };
  stored = { ...stored, notesMode: "" };
  await mount();
  expect(modeRow().parentElement?.textContent).toContain(
    "The writer's modes cannot be listed: No agent provider is ready on this host",
  );
});

const JIRA_HINT = "Project keys, comma separated. New bugs in them ring the incident alarm.";
const JIRA_UNSET = "No Jira connection on this host: save one above";
const SENTRY_UNSET = "No Sentry token on this host: save one above";

async function press(name: string): Promise<void> {
  const button = container.querySelector<HTMLElement>(`[role="button"][aria-label="${name}"]`);
  if (!button) throw new Error(`No button is named "${name}"`);
  await act(async () => button.click());
}

const SAVED_JIRA: Trackers = {
  jiraReady: true,
  sentryReady: false,
  scheduleError: null,
  connections: {
    jira: { source: "saved", baseUrl: "https://acme.atlassian.net", email: "a@acme.test" },
    sentry: { source: "none" },
  },
};

test("the Jira connection shows the host's address and email, never a token", async () => {
  await mount(null, SAVED_JIRA);
  expect(field("Jira address").value).toBe("https://acme.atlassian.net");
  expect(field("Jira email").value).toBe("a@acme.test");
  expect(field("Jira API token").value).toBe("");
  expect(field("Jira API token").type).toBe("password");
  expect(field("Sentry auth token").type).toBe("password");
  expect(container.textContent).toContain("Jira connection saved on this host");
  expect(container.textContent).toContain("No Sentry connection on this host");
});

test("Save connection sends what is typed, and the token field empties", async () => {
  await mount(null, { ...SAVED_JIRA, connections: undefined });
  await type("Jira address", "https://acme.atlassian.net");
  await type("Jira email", "a@acme.test");
  await type("Jira API token", "typed-token");
  await press("Save Jira connection");
  expect(calls).toEqual([
    {
      name: "office.trackers.save.request",
      input: {
        action: "save-jira",
        baseUrl: "https://acme.atlassian.net",
        email: "a@acme.test",
        token: "typed-token",
      },
    },
  ]);
  expect(field("Jira API token").value).toBe("");

  await type("Sentry auth token", "sentry-token");
  await press("Save Sentry connection");
  expect(calls.at(-1)).toEqual({
    name: "office.trackers.save.request",
    input: { action: "save-sentry", token: "sentry-token" },
  });
});

test("Test connection says what the tracker answered, and saves nothing", async () => {
  await mount(null, SAVED_JIRA);
  await press("Test Jira connection");
  expect(calls).toEqual([
    {
      name: "office.trackers.test.request",
      input: {
        tracker: "jira",
        baseUrl: "https://acme.atlassian.net",
        email: "a@acme.test",
        token: "",
      },
    },
  ]);
  expect(container.textContent).toContain("Jira accepted the sign-in");

  rpcAnswer = { ok: false, problem: "Jira refused the token: check the Jira API token" };
  await press("Test Jira connection");
  expect(alerts()).toEqual([
    "Unable to test connection: Jira refused the token: check the Jira API token",
  ]);
  expect(container.textContent).not.toContain("Jira accepted the sign-in");
});

test("only a saved connection can be removed", async () => {
  await mount(null, SAVED_JIRA);
  expect(container.querySelector('[aria-label="Remove saved Sentry connection"]')).toBeNull();
  await press("Remove saved Jira connection");
  expect(calls).toEqual([
    { name: "office.trackers.save.request", input: { action: "clear", tracker: "jira" } },
  ]);
});

test("a tracker's field set while the host has no sign-in for it says so under it", async () => {
  stored = { ...stored, jiraProjects: "SHOP", sentryOrg: "acme" };
  await mount(null, { jiraReady: false, sentryReady: false, scheduleError: null });
  expect(fieldBlock("Jira projects")).toBe("Jira projects" + JIRA_HINT + JIRA_UNSET);
  expect(fieldBlock("Sentry organisation")).toContain(SENTRY_UNSET);
  // An empty field says nothing, nor does the address left at its default.
  expect(fieldBlock("Sentry projects")).not.toContain(SENTRY_UNSET);
  expect(fieldBlock("Sentry address")).not.toContain(SENTRY_UNSET);

  await mount(null, { jiraReady: true, sentryReady: false, scheduleError: null });
  expect(fieldBlock("Jira projects")).toBe("Jira projects" + JIRA_HINT);
  // Before the host has said, nothing is claimed.
  await mount(null, undefined);
  expect(fieldBlock("Sentry organisation")).not.toContain(SENTRY_UNSET);
});

test("an address other than sentry.io counts as set: it names the Sentry token too", async () => {
  stored = { ...stored, sentryUrl: "https://sentry.acme.dev" };
  await mount(null, { jiraReady: true, sentryReady: false, scheduleError: null });
  expect(fieldBlock("Sentry address")).toBe(
    "Sentry address" +
      "Where the Sentry token is sent. https, or http on the host itself." +
      SENTRY_UNSET,
  );

  await mount(null, { jiraReady: true, sentryReady: true, scheduleError: null });
  expect(fieldBlock("Sentry address")).not.toContain(SENTRY_UNSET);
});

test("the incidents schedule's failure shows under the incidents fields", async () => {
  await mount(null, { jiraReady: true, sentryReady: true, scheduleError: "Unknown handler" });
  expect(alerts()).toEqual(["Unable to schedule the incidents check: Unknown handler"]);
  const alert = container.querySelector('[role="alert"]');
  if (!alert) throw new Error("No alert");
  const after = field("Sentry address").compareDocumentPosition(alert);
  expect(after & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

test("weather defaults off, manual and service expose their own controls", async () => {
  await mount();
  const button = (label: string) =>
    container.querySelector<HTMLElement>(`[role="button"][aria-label="${label}"]`);
  expect(button("Off")?.getAttribute("aria-pressed")).toBe("true");
  expect(button("Storm")).toBeNull();
  await act(async () => button("Manual")?.click());
  expect(saved.at(-1)?.values.weatherMode).toBe("manual");
  stored = { ...stored, weatherMode: "manual" };
  await mount();
  expect(button("Follow the season")?.getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("Storm")?.click());
  expect(saved.at(-1)?.values.weatherManual).toBe("storm");
  stored = { ...stored, weatherMode: "service" };
  await mount();
  expect(field("Weather address").value).toBe("");
  expect(container.textContent).toContain("No address");
  await type("Weather address", "http://weather.test/?key=SECRET");
  await leave("Weather address");
  await mount();
  expect(container.textContent).toContain("plain http only on this machine");
  expect(container.textContent).not.toContain("SECRET");
});
