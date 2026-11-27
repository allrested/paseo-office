import { expect, test } from "vitest";
import {
  FLOOR_PLANS,
  JIRA_KEY,
  officeDeviceSettings,
  officeHostSettings,
  officeLanguageSettings,
  parseKeys,
  SENTRY_SLUG,
  stickyNotesOf,
} from "./settings.js";

const WEATHER_DEFAULTS = { weatherMode: "off", weatherManual: "season", weatherUrl: "" };
const INCIDENT_DEFAULTS = {
  jiraProjects: "",
  jiraTypes: "Bug",
  sentryOrg: "",
  sentryProjects: "",
  sentryUrl: "https://sentry.io",
  awsProfile: "",
  awsRegion: "",
  awsLogGroups: "",
  awsLogPattern: "ERROR",
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

/** A document from before the floor plan was a setting draws the company floor, as its scene always did. */
const COMPANY = {
  archiveOnDeparture: false,
  floorPlan: "pro",
  streamerMode: true,
  historyVault: false,
  pinnedNotes: "",
  cacheClock: "1h",
  chatCulture: "international",
  planHidden: [],
  awsProfile: "",
  awsRegion: "",
  awsLogGroups: "",
  awsLogPattern: "ERROR",
  stickyNotes: "",
  rosterOn: false,
  rosterEdition: 0,
  uiCards: false,
  keepWatching: false,
  notifyUrl: "",
  notifyLevel: "danger",
  teams: [],
  ...WEATHER_DEFAULTS,
};

test("version 1 settings keep their Agent tools choice and have no notes folder", async () => {
  expect(await upgraded({ agentTools: false }, 1)).toEqual({
    agentTools: false,
    notesFolder: "",
    notesTimeZone: "",
    notesMode: "",
    notesDays: SUNDAY_TO_THURSDAY,
    ...INCIDENT_DEFAULTS,
    ...COMPANY,
  });
});

test("host settings: version 2 values stay and the incident fields take their defaults", async () => {
  const stored = { agentTools: false, notesFolder: "/n", notesTimeZone: "" };
  expect(await upgraded(stored, 2)).toEqual({
    ...stored,
    // The writer's mode came later: a document without it has none set.
    notesMode: "",
    notesDays: SUNDAY_TO_THURSDAY,
    ...INCIDENT_DEFAULTS,
    ...COMPANY,
  });
});

test("a version 3 document keeps its values and its Sunday to Thursday notes", async () => {
  const stored = {
    agentTools: false,
    notesFolder: "/n",
    notesTimeZone: "Asia/Riyadh",
    notesMode: "",
    jiraProjects: "SHOP",
    jiraTypes: "Bug",
    sentryOrg: "acme",
    sentryProjects: "web",
    sentryUrl: "https://sentry.acme.dev",
  };
  expect(officeHostSettings.version).toBe(11);
  expect(await upgraded(stored, 3)).toEqual({
    ...stored,
    notesDays: SUNDAY_TO_THURSDAY,
    ...COMPANY,
  });
});

test("a version 4 document without a floor plan keeps its values and draws the company floor", async () => {
  const stored = {
    agentTools: false,
    notesFolder: "/n",
    notesTimeZone: "Asia/Riyadh",
    notesMode: "",
    notesDays: [1, 3],
    jiraProjects: "SHOP",
    jiraTypes: "Bug",
    sentryOrg: "acme",
    sentryProjects: "web",
    sentryUrl: "https://sentry.acme.dev",
  };
  expect(officeHostSettings.version).toBe(11);
  expect(await upgraded(stored, 4)).toEqual({ ...stored, ...COMPANY });
});

test("automatic archiving requires opt-in on new and existing hosts", async () => {
  expect(officeHostSettings.schema.parse({}).archiveOnDeparture).toBe(false);
  expect(await upgraded({ agentTools: true }, 6)).toMatchObject({ archiveOnDeparture: false });
  expect(officeHostSettings.schema.parse({ archiveOnDeparture: true }).archiveOnDeparture).toBe(
    true,
  );
});

test("a host with no settings draws the company floor", () => {
  expect(officeHostSettings.schema.parse({})).toMatchObject({ floorPlan: "pro" });
});

test("the cozy room is kept, and only these plans are offered yet", async () => {
  expect(hostIssues({ floorPlan: "cozy" })).toEqual([]);
  expect(await upgraded({ floorPlan: "cozy" }, 4)).toMatchObject({ floorPlan: "cozy" });
  expect(FLOOR_PLANS).toEqual(["pro", "cozy", "hq"]);
});

test("a plan this build does not know reads as the company floor and the rest is kept", async () => {
  const stored = {
    agentTools: false,
    notesFolder: "/n",
    notesTimeZone: "Asia/Riyadh",
    notesMode: "",
    notesDays: [1, 3],
    jiraProjects: "SHOP",
    jiraTypes: "Bug",
    sentryOrg: "acme",
    sentryProjects: "web",
    sentryUrl: "https://sentry.acme.dev",
  };
  for (const floorPlan of ["future-plan", "", 3, null]) {
    expect(await upgraded({ ...stored, floorPlan }, 4)).toEqual({ ...stored, ...COMPANY });
  }
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
    sound: false,
  });
});

test("device settings: a version 2 document is valid as it is and has no last agent", async () => {
  const stored = { threeD: true, view: "list", rungIncidents: { "SHOP-1": 5 } };
  const migrated = await officeDeviceSettings.migrate?.(stored, 2);
  expect(officeDeviceSettings.version).toBe(2);
  expect(await officeDeviceSettings.schema.parseAsync(migrated)).toEqual({
    ...stored,
    sound: false,
  });
});

test("device settings keep the last agent's provider and model", async () => {
  const stored = {
    threeD: true,
    rungIncidents: {},
    lastAgent: { provider: "claude", model: "opus" },
  };
  expect(await officeDeviceSettings.schema.parseAsync(stored)).toEqual({ ...stored, sound: false });
  expect(officeDeviceSettings.schema.safeParse({ lastAgent: { provider: "claude" } }).success).toBe(
    false,
  );
});

test("a device document without sound has it off, and one with it keeps it", async () => {
  expect(officeDeviceSettings.version).toBe(2);
  expect(officeDeviceSettings.schema.parse({ threeD: true })).toMatchObject({ sound: false });
  expect(officeDeviceSettings.schema.parse({ sound: true })).toMatchObject({ sound: true });
});

test("a host that never set the weather has it off, following the season, with no address", async () => {
  expect(officeHostSettings.schema.parse({})).toMatchObject(WEATHER_DEFAULTS);
  // A document of the version before this one (read its number in settings.ts) parses to the same.
  expect(await upgraded({ agentTools: true }, officeHostSettings.version - 1)).toMatchObject(
    WEATHER_DEFAULTS,
  );
});

test("the weather mode and the hand-picked choice are from their lists", () => {
  expect(hostIssues({ weatherMode: "radar" })).not.toEqual([]);
  expect(hostIssues({ weatherManual: "snow" })).not.toEqual([]);
  expect(hostIssues({ weatherMode: "service", weatherManual: "storm" })).toEqual([]);
});

test("the weather address is empty, https, or http on this machine", () => {
  const refused = ["weatherUrl: not an https address (plain http only on this machine)"];
  expect(hostIssues({ weatherUrl: "" })).toEqual([]);
  expect(hostIssues({ weatherUrl: "https://weather.example.test/v1/forecast?x=1" })).toEqual([]);
  expect(hostIssues({ weatherUrl: "http://127.0.0.1:9000/weather.json" })).toEqual([]);
  expect(hostIssues({ weatherUrl: "http://localhost:9000/weather.json" })).toEqual([]);
  expect(hostIssues({ weatherUrl: "http://[::1]:9000/weather.json" })).toEqual([]);
  expect(hostIssues({ weatherUrl: "http://weather.example.test/x" })).toEqual(refused);
  expect(hostIssues({ weatherUrl: "weather.example.test" })).toEqual(refused);
  expect(hostIssues({ weatherUrl: "ftp://127.0.0.1/x" })).toEqual(refused);
});

test("the weather address is checked in every mode, and its refusal does not hold it", () => {
  const secret = "http://weather.example.test/x?apikey=SECRET";
  for (const weatherMode of ["off", "manual", "service"]) {
    const issues = hostIssues({ weatherMode, weatherUrl: secret });
    expect(issues).toHaveLength(1);
    expect(issues[0]).not.toContain("SECRET");
    expect(issues[0]).not.toContain("weather.example.test");
  }
});

test("the language choice is a separate device document with Automatic as its default", () => {
  const setting = officeLanguageSettings;
  expect(setting.id).toBe("office-language");
  expect(setting.scope).toBe("device");
  expect(setting.schema.parse({})).toEqual({ choice: "auto" });
  for (const choice of ["auto", "en", "vi", "th", "id"])
    expect(setting.schema.parse({ choice })).toEqual({ choice });
  for (const choice of ["fr", 1]) expect(setting.schema.safeParse({ choice }).success).toBe(false);
});

test("the street is optional and preserves either explicit device choice", () => {
  expect(officeDeviceSettings.schema.parse({})).not.toHaveProperty("street");
  for (const street of [false, true])
    expect(officeDeviceSettings.schema.parse({ street }).street).toBe(street);
});

test("sticky notes are the setting's text split at ; and cut to what the board holds", () => {
  expect(stickyNotesOf("")).toEqual([]);
  expect(stickyNotesOf(" Ship 0.3.0 ; ;Call the bank\nthree;four;five")).toEqual([
    "Ship 0.3.0",
    "Call the bank",
    "three",
    "four",
  ]);
  expect(stickyNotesOf("x".repeat(90))[0]).toHaveLength(60);
  expect(officeHostSettings.schema.parse({})).toMatchObject({
    streamerMode: true,
    stickyNotes: "",
  });
});

test("the team chat writes for any office until a host chooses, and an unknown choice does too", () => {
  expect(officeHostSettings.schema.parse({}).chatCulture).toBe("international");
  expect(officeHostSettings.schema.parse({ chatCulture: "indonesian" }).chatCulture).toBe(
    "indonesian",
  );
  expect(officeHostSettings.schema.parse({ chatCulture: "martian" }).chatCulture).toBe(
    "international",
  );
});

test("AWS values that could not be CLI arguments are refused", () => {
  const { schema } = officeHostSettings;
  const good = {
    awsProfile: "nprd",
    awsRegion: "ap-southeast-1",
    awsLogGroups: "/aws/lambda/pay, app.errors#1",
  };
  expect(schema.safeParse(good).success).toBe(true);
  expect(schema.safeParse({ awsProfile: "--debug" }).success).toBe(false);
  expect(schema.safeParse({ awsRegion: "singapore" }).success).toBe(false);
  expect(schema.safeParse({ awsLogGroups: "ok, -bad" }).success).toBe(false);
  const many = Array.from({ length: 11 }, (_, index) => `g${index}`).join(",");
  expect(schema.safeParse({ awsLogGroups: many }).success).toBe(false);
});

test("the roster is off and empty until the owner writes it, and a bad team is refused", () => {
  const defaults = officeHostSettings.schema.parse({});
  expect(defaults.rosterOn).toBe(false);
  expect(defaults.rosterEdition).toBe(0);
  expect(defaults.teams).toEqual([]);
  const twice = officeHostSettings.schema.safeParse({
    teams: [
      { id: "t1", name: "PR-DEV", members: [] },
      { id: "t2", name: "PR-DEV", members: [] },
    ],
  });
  expect(twice.success).toBe(false);
  expect(officeHostSettings.version).toBe(11);
});
