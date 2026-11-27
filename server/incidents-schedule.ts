import type { IncidentSource } from "../shared/contracts.js";
import {
  AWS_LOG_GROUP,
  AWS_PROFILE,
  AWS_REGION,
  JIRA_KEY,
  JIRA_TYPE,
  parseKeys,
  SENTRY_SLUG,
} from "../shared/settings.js";
import { createCloudWatchReader } from "./incidents-cloudwatch.js";
import type { TrackerReader } from "./incidents-http.js";
import { createJiraReader } from "./incidents-jira.js";
import { createSentryReader } from "./incidents-sentry.js";
import type { OfficeCadence, OfficeSchedules } from "./local-schedules.js";
import { createScheduleFollower, type OfficeSchedule } from "./schedule-follower.js";
import type { TrackerCredentials } from "./tracker-credentials.js";

/** The check's schedule's name among the office's schedules, and the handler that answers it. */
export const INCIDENTS_SCHEDULE = "incidents";
const INCIDENTS: OfficeSchedule = {
  name: INCIDENTS_SCHEDULE,
  label: "Incidents",
  logName: "incidents",
};
const EVERY_MS = 300_000;

export interface IncidentsSettings {
  jiraProjects: string;
  jiraTypes: string;
  sentryOrg: string;
  sentryProjects: string;
  sentryUrl: string;
  awsProfile: string;
  awsRegion: string;
  awsLogGroups: string;
  awsLogPattern: string;
}

/**
 * The trackers that are on: each needs a sign-in in `credentials` and a project in the settings,
 * and Sentry an organisation too. CloudWatch needs a profile and a region: the sign-in is the
 * host's own AWS CLI's.
 */
export function incidentsReaders(
  values: IncidentsSettings,
  credentials: TrackerCredentials,
): Partial<Record<IncidentSource, TrackerReader>> {
  const readers: Partial<Record<IncidentSource, TrackerReader>> = {};
  const { jira, sentry } = credentials;
  const jiraProjects = parseKeys(values.jiraProjects, JIRA_KEY);
  if (jira !== null && jiraProjects.length > 0) {
    const types = parseKeys(values.jiraTypes, JIRA_TYPE);
    readers.jira = createJiraReader(jira, jiraProjects, fetch, types.length > 0 ? types : ["Bug"]);
  }
  const org = values.sentryOrg.trim();
  const sentryProjects = parseKeys(values.sentryProjects, SENTRY_SLUG);
  if (sentry !== null && org !== "" && sentryProjects.length > 0) {
    readers.sentry = createSentryReader({
      url: values.sentryUrl,
      org,
      projects: sentryProjects,
      token: sentry.token,
      tokenVariable: sentry.tokenVariable,
    });
  }
  const profile = values.awsProfile.trim();
  const region = values.awsRegion.trim();
  if (AWS_PROFILE.test(profile) && AWS_REGION.test(region)) {
    readers.cloudwatch = createCloudWatchReader({
      profile,
      region,
      logGroups: parseKeys(values.awsLogGroups, AWS_LOG_GROUP),
      pattern: values.awsLogPattern.trim() || "ERROR",
    });
  }
  return readers;
}

/** When the trackers are checked: null while none is on. */
export function incidentsCadence(on: boolean): OfficeCadence | null {
  return on ? { type: "every", everyMs: EVERY_MS } : null;
}

export interface IncidentsSchedulePorts {
  schedules: OfficeSchedules;
  log(message: string): void;
}

export interface IncidentsSchedule {
  /**
   * Keeps the schedule while `on` and removes it otherwise. Never rejects: a failure is logged
   * and kept for `error`.
   */
  sync(on: boolean): Promise<void>;
  /** Why the schedule could not follow the settings; null once a later sync succeeds. */
  error(): string | null;
  /** Keeps a reason found outside a sync until a sync succeeds. */
  fail(message: string): void;
}

export function createIncidentsSchedule(ports: IncidentsSchedulePorts): IncidentsSchedule {
  const follower = createScheduleFollower({
    schedules: ports.schedules,
    schedule: INCIDENTS,
    log: ports.log,
  });
  return {
    sync: (on) => follower.sync(() => incidentsCadence(on)),
    error: follower.error,
    fail: follower.fail,
  };
}
