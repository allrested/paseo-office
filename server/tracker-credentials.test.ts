import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  changeSavedTrackers,
  createTrackerCredentialsStore,
  NO_SAVED_TRACKERS,
  trackerCredentials,
  type SavedTrackers,
} from "./tracker-credentials.js";

let directory = "";
let logs: string[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "office-trackers-"));
  logs = [];
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function file(): string {
  return join(directory, "office", "trackers.json");
}

function store() {
  return createTrackerCredentialsStore({ file: file(), log: (message) => logs.push(message) });
}

const JIRA = { baseUrl: "https://acme.atlassian.net", email: "a@acme.test", token: "jira-secret" };
const SAVED: SavedTrackers = { version: 1, jira: JIRA, sentry: { token: "sentry-secret" } };
const ENV = {
  ATLASSIAN_BASE_URL: "https://env.atlassian.net/",
  ATLASSIAN_EMAIL: "env@acme.test",
  ATLASSIAN_API_TOKEN: "env-jira",
  SENTRY_AUTH_TOKEN: "env-sentry",
};

test("a host that never saved a connection has none", async () => {
  expect(await store().load()).toEqual(NO_SAVED_TRACKERS);
});

test("what is saved is read back, from a file only its owner can read", async () => {
  await store().save(SAVED);
  expect(await store().load()).toEqual(SAVED);
  expect((await stat(file())).mode & 0o777).toBe(0o600);
});

test("a save replaces a file others could read with one they cannot", async () => {
  await mkdir(join(directory, "office"), { recursive: true });
  await writeFile(file(), "{}", { mode: 0o644 });
  await store().save(SAVED);
  expect((await stat(file())).mode & 0o777).toBe(0o600);
});

test("an unreadable file is no connection, and the log does not quote it", async () => {
  await mkdir(join(directory, "office"), { recursive: true });
  await writeFile(file(), '{"jira": "jira-secret"');
  expect(await store().load()).toEqual(NO_SAVED_TRACKERS);
  expect(logs).toHaveLength(1);
  expect(logs[0]).not.toContain("jira-secret");
});

test("a saved connection comes before the environment's", () => {
  expect(trackerCredentials(SAVED, ENV)).toEqual({
    jira: { ...JIRA, source: "saved", tokenVariable: "the saved Jira token" },
    sentry: { token: "sentry-secret", source: "saved", tokenVariable: "the saved Sentry token" },
  });
});

test("the environment's connection is used while none is saved", () => {
  expect(trackerCredentials(NO_SAVED_TRACKERS, ENV)).toEqual({
    jira: {
      baseUrl: "https://env.atlassian.net",
      email: "env@acme.test",
      token: "env-jira",
      source: "env",
      tokenVariable: "ATLASSIAN_API_TOKEN",
    },
    sentry: { token: "env-sentry", source: "env", tokenVariable: "SENTRY_AUTH_TOKEN" },
  });
  expect(trackerCredentials(NO_SAVED_TRACKERS, {})).toEqual({ jira: null, sentry: null });
});

test("saving Jira trims the fields and drops the address's trailing slash", () => {
  const changed = changeSavedTrackers(NO_SAVED_TRACKERS, {
    action: "save-jira",
    baseUrl: " https://acme.atlassian.net// ",
    email: " a@acme.test ",
    token: " jira-secret ",
  });
  expect(changed).toEqual({ saved: { version: 1, jira: JIRA } });
});

test("saving Jira with no token keeps the saved one", () => {
  const changed = changeSavedTrackers(SAVED, {
    action: "save-jira",
    baseUrl: "https://other.atlassian.net",
    email: "b@acme.test",
    token: "",
  });
  expect(changed).toEqual({
    saved: {
      ...SAVED,
      jira: { baseUrl: "https://other.atlassian.net", email: "b@acme.test", token: "jira-secret" },
    },
  });
});

test("saving Jira is refused without a token, an email or a safe address", () => {
  const input = { action: "save-jira", ...JIRA } as const;
  const none = NO_SAVED_TRACKERS;
  expect(changeSavedTrackers(none, { ...input, token: "" })).toEqual({
    problem: "Enter the Jira API token",
  });
  expect(changeSavedTrackers(none, { ...input, email: " " })).toEqual({
    problem: "Enter the Jira account's email",
  });
  expect(changeSavedTrackers(none, { ...input, baseUrl: "http://acme.atlassian.net" })).toEqual({
    problem: "The Jira address must be an https address (plain http only on this machine)",
  });
});

test("saving Sentry keeps Jira, and an empty token is refused", () => {
  expect(
    changeSavedTrackers({ version: 1, jira: JIRA }, { action: "save-sentry", token: " s " }),
  ).toEqual({ saved: { version: 1, jira: JIRA, sentry: { token: "s" } } });
  expect(changeSavedTrackers(NO_SAVED_TRACKERS, { action: "save-sentry", token: " " })).toEqual({
    problem: "Enter the Sentry auth token",
  });
});

test("clearing removes one tracker's saved connection only", () => {
  expect(changeSavedTrackers(SAVED, { action: "clear", tracker: "jira" })).toEqual({
    saved: { version: 1, sentry: { token: "sentry-secret" } },
  });
  expect(changeSavedTrackers(SAVED, { action: "clear", tracker: "sentry" })).toEqual({
    saved: { version: 1, jira: JIRA },
  });
});

test("the file holds the token as typed, and nothing else writes it", async () => {
  await store().save(SAVED);
  expect(JSON.parse(await readFile(file(), "utf8"))).toEqual(SAVED);
});
