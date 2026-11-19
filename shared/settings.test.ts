import { expect, test } from "vitest";
import {
  JIRA_KEY,
  officeDeviceSettings,
  officeHostSettings,
  parseKeys,
  SENTRY_SLUG,
} from "./settings.js";

const INCIDENT_DEFAULTS = {
  jiraProjects: "",
  sentryOrg: "",
  sentryProjects: "",
  sentryUrl: "https://sentry.io",
};

function hostIssues(values: Record<string, unknown>): string[] {
  const parsed = officeHostSettings.schema.safeParse(values);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

/** As the daemon reads a stored document of an older version: migrate, then parse. */
async function upgraded(stored: Record<string, unknown>, fromVersion: number): Promise<unknown> {
  const migrated = await officeHostSettings.migrate?.(stored, fromVersion);
  return officeHostSettings.schema.parseAsync(migrated);
}

const SUNDAY_TO_THURSDAY = [0, 1, 2, 3, 4];

test("version 1 settings keep their Agent tools choice and have no notes folder", async () => {
  expect(await upgraded({ agentTools: false }, 1)).toEqual({
    agentTools: false,
    notesFolder: "",
    notesTimeZone: "",
    notesDays: SUNDAY_TO_THURSDAY,
    ...INCIDENT_DEFAULTS,
  });
});

test("host settings: version 2 values stay and the incident fields take their defaults", async () => {
  const stored = { agentTools: false, notesFolder: "/n", notesTimeZone: "" };
  expect(await upgraded(stored, 2)).toEqual({
    ...stored,
    notesDays: SUNDAY_TO_THURSDAY,
    ...INCIDENT_DEFAULTS,
  });
});

test("a version 3 document keeps its values and its Sunday to Thursday notes", async () => {
  const stored = {
    agentTools: false,
    notesFolder: "/n",
    notesTimeZone: "Asia/Riyadh",
    jiraProjects: "SHOP",
    sentryOrg: "acme",
    sentryProjects: "web",
    sentryUrl: "https://sentry.acme.dev",
  };
  expect(officeHostSettings.version).toBe(4);
  expect(await upgraded(stored, 3)).toEqual({ ...stored, notesDays: SUNDAY_TO_THURSDAY });
});

test("a document with its own days keeps them", async () => {
  const stored = { notesFolder: "/n", notesDays: [1, 3] };
  expect(await upgraded(stored, 3)).toMatchObject({ notesDays: [1, 3] });
  expect(officeHostSettings.schema.parse({ notesDays: [] })).toMatchObject({ notesDays: [] });
});

test("a host with no settings writes its notes Monday to Friday", () => {
  expect(officeHostSettings.schema.parse({})).toMatchObject({ notesDays: [1, 2, 3, 4, 5] });
});

test("the notes days are stored in order", () => {
  expect(officeHostSettings.schema.parse({ notesDays: [5, 0, 3] })).toMatchObject({
    notesDays: [0, 3, 5],
  });
});

test("a day that is not 0 to 6, or is there twice, is refused", () => {
  const notWeekday = (day: number) => [
    `notesDays: ${day} is not a day from 0 (Sunday) to 6 (Saturday)`,
  ];
  expect(hostIssues({ notesDays: [1, 7] })).toEqual(notWeekday(7));
  expect(hostIssues({ notesDays: [-1] })).toEqual(notWeekday(-1));
  expect(hostIssues({ notesDays: [1.5] })).toEqual(notWeekday(1.5));
  expect(hostIssues({ notesDays: [3, 1, 3] })).toEqual(["notesDays: 3 is there twice"]);
  expect(hostIssues({ notesDays: [0, 6] })).toEqual([]);
});

test("a Jira list with a bad key is refused", () => {
  expect(hostIssues({ jiraProjects: "SHOP, shop" })).toEqual([
    'jiraProjects: "shop" is not a Jira project key',
  ]);
  expect(hostIssues({ jiraProjects: "SHOP, QA_2" })).toEqual([]);
});

test("a Sentry list with a bad slug is refused", () => {
  expect(hostIssues({ sentryProjects: "web, Bad Slug" })).toEqual([
    'sentryProjects: "Bad Slug" is not a Sentry project slug',
  ]);
  expect(hostIssues({ sentryProjects: "web, api_2, back-end" })).toEqual([]);
});

test("a Sentry organisation that is not one slug is refused", () => {
  expect(hostIssues({ sentryOrg: "acme, other" })).toEqual([
    'sentryOrg: "acme, other" is not a Sentry organisation slug',
  ]);
  expect(hostIssues({ sentryOrg: "acme" })).toEqual([]);
});

test("the Sentry address must be https off loopback", () => {
  const refused = (address: string) => [
    `sentryUrl: "${address}" is not an https address (plain http only on this machine)`,
  ];
  expect(hostIssues({ sentryUrl: "http://sentry.example.com" })).toEqual(
    refused("http://sentry.example.com"),
  );
  expect(hostIssues({ sentryUrl: "sentry.example.com" })).toEqual(refused("sentry.example.com"));
  expect(hostIssues({ sentryUrl: "" })).toEqual(refused(""));
  expect(hostIssues({ sentryUrl: "ftp://127.0.0.1" })).toEqual(refused("ftp://127.0.0.1"));
  expect(hostIssues({ sentryUrl: "https://sentry.example.com" })).toEqual([]);
  expect(hostIssues({ sentryUrl: "http://127.0.0.1:9000" })).toEqual([]);
  expect(hostIssues({ sentryUrl: "http://127.1.2.3:9000" })).toEqual([]);
  expect(hostIssues({ sentryUrl: "http://localhost:9000" })).toEqual([]);
  expect(hostIssues({ sentryUrl: "http://[::1]:9000" })).toEqual([]);
});

test("parseKeys trims and drops empty entries", () => {
  expect(parseKeys(" SHOP , ,QA ", JIRA_KEY)).toEqual(["SHOP", "QA"]);
  expect(parseKeys("", SENTRY_SLUG)).toEqual([]);
});

test("device settings: version 1 values stay and rungIncidents is {}", async () => {
  const stored = { threeD: false, view: "2d" };
  const migrated = await officeDeviceSettings.migrate?.(stored, 1);
  expect(officeDeviceSettings.version).toBe(2);
  expect(await officeDeviceSettings.schema.parseAsync(migrated)).toEqual({
    ...stored,
    rungIncidents: {},
  });
});

test("device settings: a version 2 document is valid as it is and has no last agent", async () => {
  const stored = { threeD: true, view: "list", rungIncidents: { "SHOP-1": 5 } };
  const migrated = await officeDeviceSettings.migrate?.(stored, 2);
  expect(officeDeviceSettings.version).toBe(2);
  expect(await officeDeviceSettings.schema.parseAsync(migrated)).toEqual(stored);
});

test("device settings keep the last agent's provider and model", async () => {
  const stored = {
    threeD: true,
    rungIncidents: {},
    lastAgent: { provider: "claude", model: "opus" },
  };
  expect(await officeDeviceSettings.schema.parseAsync(stored)).toEqual(stored);
  expect(officeDeviceSettings.schema.safeParse({ lastAgent: { provider: "claude" } }).success).toBe(
    false,
  );
});
