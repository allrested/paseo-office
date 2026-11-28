/**
 * @vitest-environment jsdom
 */
// The intake's settings, mounted: each field saves its setting, the status line says where the
// intake stands, and Read now runs it. The host's settings hook is a stand-in.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { IntakeState } from "../shared/contracts.js";
import { officeHostSettings } from "../shared/settings.js";
import type { HostValues } from "./host-switches.js";
import { IntakeSettings, type IntakeSetting } from "./intake-settings.js";
import { useOfficeStyles } from "./styles.js";

let calls: string[];
let answer: IntakeState;
let refusal: Error | null;
let saved: Partial<HostValues>[];

vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (contract: { name: string }) => async () => {
    calls.push(contract.name);
    if (refusal) throw refusal;
    return answer;
  },
}));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { TextInput } = await import("react-native");
  return { TextInput, Icon: () => null };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const VALUES: HostValues = officeHostSettings.schema.parse({});
const HINT_JQL =
  "Tickets this matches become lobby tasks, each once. Leave imported tickets out of it, for example by a label.";
const HINT_START =
  "A ticket's text reaches an agent without you reading it first. Leave it off unless only people you trust can write tickets.";
const HINT_COMMENT =
  "The comment is the result as the agent wrote it, readable by everyone who can read the ticket.";

/** A local time, as the line shows it: the device's clock. */
const AT = new Date(2026, 10, 28, 12, 40).toISOString();
const SET_UP: IntakeState = {
  jira: { configured: true, problem: null, lastRun: AT, imported: 3 },
  github: { configured: false, problem: null, lastRun: null, imported: 0 },
  waiting: false,
};
const GITHUB_ON: IntakeState["github"] = {
  configured: true,
  problem: null,
  lastRun: AT,
  imported: 2,
};
const HINT_GITHUB =
  "Read with the host's gh CLI and its sign-in. The office keeps no GitHub token.";
const REPOS = "GitHub repositories to bring in from";
const SEARCH = "GitHub search";

async function change(_setting: IntakeSetting, patch: Partial<HostValues>): Promise<boolean> {
  saved.push(patch);
  return true;
}
const noProblem = () => null;

function Harness({ intake, values }: { intake: IntakeState | undefined; values: HostValues }) {
  const styles = useOfficeStyles(THEME, false, false);
  return (
    <IntakeSettings
      values={values}
      intake={intake}
      change={change}
      saveProblem={noProblem}
      styles={styles}
    />
  );
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  calls = [];
  saved = [];
  refusal = null;
  answer = SET_UP;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = (intake: IntakeState | undefined = SET_UP, values: HostValues = VALUES) =>
  act(async () => root.render(<Harness intake={intake} values={values} />));

function jql(): HTMLTextAreaElement {
  const found = container.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="Jira tickets to bring in (JQL)"]',
  );
  if (!found) throw new Error("No JQL field");
  return found;
}

const button = (name: string) =>
  container.querySelector<HTMLElement>(`[role="button"][aria-label="${name}"]`);
const switchNamed = (name: string) =>
  container.querySelector<HTMLElement>(`[role="switch"][aria-label="${name}"]`);

test("the JQL is a field of three lines that saves, trimmed, once it loses focus", async () => {
  await mount();
  expect(jql().getAttribute("rows")).toBe("3");
  expect(jql().getAttribute("maxlength")).toBe("1000");
  await act(async () => {
    jql().focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      jql(),
      ' labels = agent\nAND status = "To Do" ',
    );
    jql().dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(saved).toEqual([]);
  await act(async () => jql().blur());
  expect(saved).toEqual([{ jiraIntakeJql: 'labels = agent\nAND status = "To Do"' }]);
});

test("the hints are shown exactly", async () => {
  await mount();
  const text = container.textContent ?? "";
  expect(text).toContain(HINT_JQL);
  expect(text).toContain(HINT_START);
  expect(text).toContain(HINT_COMMENT);
});

test("Imported tasks go to Backlog or To do, the stored one pressed, and a press saves it", async () => {
  await mount();
  expect(button("Backlog")?.getAttribute("aria-pressed")).toBe("true");
  expect(button("To do")?.getAttribute("aria-pressed")).toBe("false");
  await act(async () => button("To do")?.click());
  expect(saved).toEqual([{ intakeLands: "todo" }]);
});

test("the two switches save their settings", async () => {
  await mount();
  expect(switchNamed("Let the gate start imported tasks")?.getAttribute("aria-checked")).toBe(
    "false",
  );
  await act(async () => switchNamed("Let the gate start imported tasks")?.click());
  await act(async () => switchNamed("Comment the result on the ticket")?.click());
  expect(saved).toEqual([{ intakeAutoStart: true }, { intakeWriteBack: true }]);
});

const line = () => container.querySelector('[data-testid="intake-status"]')?.textContent;

test("a source that is not set up says what it needs, and Read now is off", async () => {
  await mount({ ...SET_UP, jira: { ...SET_UP.jira, configured: false } });
  expect(line()).toBe("Not set up: needs a JQL and the Jira connection.");
  expect(button("Read now")?.getAttribute("aria-disabled")).toBe("true");
});

test("the last run says how many it imported, or that nothing was new", async () => {
  await mount();
  expect(line()).toBe("Last read 12:40: 3 imported");
  await mount({ ...SET_UP, jira: { ...SET_UP.jira, imported: 0 } });
  expect(line()).toBe("Last read 12:40: nothing new");
});

test("a source not read yet says so", async () => {
  await mount({ ...SET_UP, jira: { ...SET_UP.jira, lastRun: null } });
  expect(line()).toBe("Not read yet.");
});

test("a problem shows under the last run, and waiting says why nothing came", async () => {
  await mount({
    waiting: true,
    github: SET_UP.github,
    jira: {
      ...SET_UP.jira,
      problem: "the first 100 matches are already imported: narrow the JQL",
    },
  });
  expect(line()).toBe(
    "Last read 12:40: 3 imported" +
      "the first 100 matches are already imported: narrow the JQL" +
      "Waiting: 50 imported tasks are open.",
  );
});

test("before the office has said, no status is claimed and Read now is off", async () => {
  await act(async () => root.render(<Harness intake={undefined} values={VALUES} />));
  expect(line()).toBeUndefined();
  expect(button("Read now")?.getAttribute("aria-disabled")).toBe("true");
});

test("Read now runs the intake", async () => {
  await mount();
  await act(async () => button("Read now")?.click());
  expect(calls).toEqual(["office.intake.run.request"]);
});

test("a failed Read now shows like another action's failure", async () => {
  refusal = new Error("Jira is down");
  await mount();
  await act(async () => button("Read now")?.click());
  expect(
    [...container.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent),
  ).toEqual(["Unable to read now: Jira is down"]);
});

const githubLine = () =>
  container.querySelector('[data-testid="intake-status-github"]')?.textContent;
const repos = () => container.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${REPOS}"]`);
const search = () => container.querySelector<HTMLInputElement>(`input[aria-label="${SEARCH}"]`);
const alerts = () =>
  [...container.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent);

async function type(field: HTMLTextAreaElement | HTMLInputElement | null, text: string) {
  if (!field) throw new Error("No field");
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  await act(async () => {
    field.focus();
    Object.getOwnPropertyDescriptor(prototype.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => field.blur());
}

test("the GitHub fields sit under Jira's, with the hint exactly, repositories one per line", async () => {
  await mount(undefined, { ...VALUES, githubIntakeRepos: ["acme/web", "acme/api"] });
  expect(repos()?.value).toBe("acme/web\nacme/api");
  expect(repos()?.getAttribute("maxlength")).toBeNull();
  expect(search()?.value).toBe("label:agent is:open");
  expect(search()?.getAttribute("maxlength")).toBe("200");
  expect(container.textContent).toContain(HINT_GITHUB);
  const text = container.textContent ?? "";
  expect(text.indexOf("Jira tickets to bring in (JQL)")).toBeLessThan(text.indexOf(REPOS));
  expect(text.indexOf(REPOS)).toBeLessThan(text.indexOf(SEARCH));
});

test("the repositories save as a list: lines trimmed, blank ones dropped", async () => {
  await mount();
  await type(repos(), " acme/web \n\nacme/api\r\n");
  expect(saved).toEqual([{ githubIntakeRepos: ["acme/web", "acme/api"] }]);
  expect(alerts()).toEqual([]);
});

test("an entry the schema would refuse is told by its line and is not saved", async () => {
  await mount();
  await type(repos(), "acme/web\n-evil/x");
  expect(alerts()).toEqual(['Line 2: "-evil/x" is not owner/repo']);
  await type(repos(), "acme/web\nACME/Web");
  expect(alerts()).toEqual(['Line 2: "ACME/Web" is there twice']);
  await type(repos(), Array.from({ length: 11 }, (_, index) => `acme/r${index}`).join("\n"));
  expect(alerts()).toEqual(["At most 10 repositories"]);
  expect(saved).toEqual([]);
  await type(repos(), "acme/web");
  expect(alerts()).toEqual([]);
  expect(saved).toEqual([{ githubIntakeRepos: ["acme/web"] }]);
});

test("the search saves trimmed, and one that starts with a dash is refused before it is saved", async () => {
  await mount();
  await type(search(), "  label:agent -label:in-office ");
  expect(saved).toEqual([{ githubIntakeSearch: "label:agent -label:in-office" }]);
  await type(search(), "-label:x");
  expect(alerts()).toEqual(["The search must not start with a dash"]);
  expect(saved).toHaveLength(1);
});

test("GitHub's status says it is not set up, how the last run went, and its problem", async () => {
  await mount();
  expect(githubLine()).toBe("GitHub: not set up. Add a repository.");
  await mount({ ...SET_UP, github: GITHUB_ON });
  expect(githubLine()).toBe("GitHub: last read 12:40: 2 imported");
  await mount({ ...SET_UP, github: { ...GITHUB_ON, imported: 0 } });
  expect(githubLine()).toBe("GitHub: last read 12:40: nothing new");
  await mount({ ...SET_UP, github: { ...GITHUB_ON, lastRun: null } });
  expect(githubLine()).toBe("GitHub: not read yet.");
  await mount({
    ...SET_UP,
    github: { ...GITHUB_ON, problem: "gh is not signed in on the host" },
  });
  expect(githubLine()).toBe("GitHub: last read 12:40: 2 importedgh is not signed in on the host");
});

test("Read now is on when only GitHub is set up", async () => {
  await mount({ ...SET_UP, jira: { ...SET_UP.jira, configured: false }, github: GITHUB_ON });
  expect(button("Read now")?.getAttribute("aria-disabled")).not.toBe("true");
});
