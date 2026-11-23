import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { z } from "zod";
import { type FoundIssue, TrackerProblem, type TrackerReader } from "./incidents-http.js";

const TIMEOUT_MS = 30_000;
const HOUR_MS = 3_600_000;
/** The most error lines read from one log group in a check; more reads as "50+". */
const LINES_MAX = 50;

export interface CloudWatchReaderInput {
  /** A profile of the host's own AWS CLI. The office never sees its keys. */
  profile: string;
  region: string;
  /** Log group names, already checked against the settings' pattern. */
  logGroups: string[];
  /** A CloudWatch Logs filter pattern; a line that matches is an error line. */
  pattern: string;
}

/** What one run of the AWS CLI gave back. `code` is null when it never ran or was stopped. */
export interface AwsRun {
  code: number | string | null;
  stdout: string;
  stderr: string;
}

/** Runs the host's `aws` with these arguments. Never rejects. */
export type RunAws = (args: string[]) => Promise<AwsRun>;

/**
 * The host's AWS CLI, found on the daemon's PATH or in `~/.local/bin`. No shell: the arguments
 * go to the CLI as they are.
 */
export const runAws: RunAws = (args) =>
  new Promise((resolve) => {
    const path = [process.env.PATH ?? "", join(homedir(), ".local", "bin")].join(delimiter);
    execFile(
      "aws",
      args,
      { env: { ...process.env, PATH: path }, timeout: TIMEOUT_MS, maxBuffer: 8_000_000 },
      (error, stdout, stderr) => {
        if (error === null) return resolve({ code: 0, stdout, stderr });
        const code = error.killed ? null : (error.code ?? null);
        return resolve({ code, stdout, stderr });
      },
    );
  });

const Timestamp = z.string().transform(Date.parse).pipe(z.number());
const AlarmSchema = z.object({ AlarmName: z.string(), StateUpdatedTimestamp: Timestamp });
const AlarmsSchema = z.object({
  MetricAlarms: z.array(AlarmSchema).default([]),
  CompositeAlarms: z.array(AlarmSchema).default([]),
});
const EventsSchema = z.object({
  events: z.array(z.object({ timestamp: z.number() })).default([]),
});

/**
 * Why the CLI failed, from its exit and its own words. The words are matched and never shown:
 * they can hold an account number or an address.
 */
function problemOf(run: AwsRun, input: CloudWatchReaderInput, group?: string): TrackerProblem {
  const { profile } = input;
  const said = run.stderr;
  if (run.code === "ENOENT") return new TrackerProblem("The host has no aws CLI");
  if (run.code === null) {
    return new TrackerProblem(`AWS did not answer in ${TIMEOUT_MS / 1000} s`);
  }
  if (/could not be found/i.test(said) && /profile/i.test(said)) {
    return new TrackerProblem(`The host has no AWS profile "${profile}"`);
  }
  if (/sso|expired|ExpiredToken|Unable to locate credentials/i.test(said)) {
    return new TrackerProblem(
      `The AWS sign-in ran out: run "aws sso login --profile ${profile}" on the host`,
    );
  }
  if (/AccessDenied|not authorized|UnauthorizedOperation/i.test(said)) {
    const what = group === undefined ? "the alarms" : `the log group ${group}`;
    return new TrackerProblem(`The AWS profile "${profile}" may not read ${what}`);
  }
  if (group !== undefined && /ResourceNotFoundException/i.test(said)) {
    return new TrackerProblem(`AWS has no log group "${group}" in ${input.region}`);
  }
  if (/InvalidParameterException/i.test(said)) {
    return new TrackerProblem("AWS refused the error pattern");
  }
  if (/Could not connect|EndpointConnectionError|Connect timeout/i.test(said)) {
    return new TrackerProblem("AWS could not be reached");
  }
  return new TrackerProblem(`The aws CLI failed (exit ${String(run.code)})`);
}

function parse<Schema extends z.ZodType>(run: AwsRun, schema: Schema): z.output<Schema> {
  let body: unknown = null;
  try {
    body = JSON.parse(run.stdout);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new TrackerProblem("AWS answered in a shape the office does not read");
  }
  return parsed.data;
}

function consoleUrl(region: string, fragment: string): string {
  return `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}#${fragment}`;
}

/** The console writes a name in a fragment encoded twice, with `$` for the second `%`. */
function fragmentName(name: string): string {
  return encodeURIComponent(encodeURIComponent(name)).replace(/%/g, "$");
}

/**
 * Alarms in the ALARM state, and error lines in the listed log groups. An alarm is one incident
 * each time it goes into ALARM. A log group is one incident an hour however many lines match,
 * and the lines themselves never leave AWS: a log line can hold a customer's data.
 */
export function createCloudWatchReader(
  input: CloudWatchReaderInput,
  run: RunAws = runAws,
): TrackerReader {
  const { region, logGroups, pattern } = input;
  const common = ["--profile", input.profile, "--region", region, "--output", "json"];

  async function alarms(): Promise<FoundIssue[]> {
    const ran = await run(["cloudwatch", "describe-alarms", "--state-value", "ALARM", ...common]);
    if (ran.code !== 0) throw problemOf(ran, input);
    const { MetricAlarms, CompositeAlarms } = parse(ran, AlarmsSchema);
    return [...MetricAlarms, ...CompositeAlarms].map((alarm) => {
      const since = new Date(alarm.StateUpdatedTimestamp).toISOString().slice(0, 16);
      return {
        key: `${alarm.AlarmName} ${since}Z`,
        title: `${alarm.AlarmName} is in alarm`,
        url: consoleUrl(region, `alarmsV2:alarm/${encodeURIComponent(alarm.AlarmName)}`),
        createdAt: alarm.StateUpdatedTimestamp,
      };
    });
  }

  async function errorLines(group: string, since: number): Promise<FoundIssue[]> {
    const ran = await run([
      "logs",
      "filter-log-events",
      "--log-group-name",
      group,
      "--start-time",
      String(since),
      "--filter-pattern",
      pattern,
      "--limit",
      String(LINES_MAX),
      "--no-paginate",
      ...common,
    ]);
    if (ran.code !== 0) throw problemOf(ran, input, group);
    const { events } = parse(ran, EventsSchema);
    const hours = new Map<number, { first: number; lines: number }>();
    for (const event of events) {
      const hour = Math.floor(event.timestamp / HOUR_MS) * HOUR_MS;
      const known = hours.get(hour);
      if (known === undefined) hours.set(hour, { first: event.timestamp, lines: 1 });
      else
        hours.set(hour, { first: Math.min(known.first, event.timestamp), lines: known.lines + 1 });
    }
    const full = events.length >= LINES_MAX;
    return [...hours].map(([hour, { first, lines }]) => {
      const count = full ? `${lines}+` : String(lines);
      return {
        key: `${group} ${new Date(hour).toISOString().slice(0, 13)}Z`,
        title: `${count} error ${lines === 1 && !full ? "line" : "lines"} in ${group}`,
        url: consoleUrl(region, `logsV2:log-groups/log-group/${fragmentName(group)}`),
        createdAt: first,
      };
    });
  }

  async function read(since: number): Promise<FoundIssue[]> {
    const found = await alarms();
    for (const group of logGroups) found.push(...(await errorLines(group, since)));
    return found.sort((a, b) => a.createdAt - b.createdAt);
  }

  return { read };
}
