import { expect, test } from "vitest";
import { type AwsRun, createCloudWatchReader, type RunAws } from "./incidents-cloudwatch.js";
import { TrackerProblem } from "./incidents-http.js";

const INPUT = {
  profile: "nprd",
  region: "ap-southeast-1",
  logGroups: ["/aws/lambda/pay"],
  pattern: "ERROR",
};
const T0 = Date.parse("2026-11-23T10:05:00Z");

function ok(body: unknown): AwsRun {
  return { code: 0, stdout: JSON.stringify(body), stderr: "" };
}

/** A stand-in for the CLI: it records each run and answers by the service asked. */
function fake(answers: { alarms?: AwsRun; logs?: AwsRun }) {
  const runs: string[][] = [];
  const run: RunAws = async (args) => {
    runs.push(args);
    const answer = args[0] === "cloudwatch" ? answers.alarms : answers.logs;
    return answer ?? ok({});
  };
  return { run, runs };
}

async function problem(reading: Promise<unknown>): Promise<string> {
  const error = await reading.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(TrackerProblem);
  return (error as TrackerProblem).message;
}

test("an alarm in ALARM is an incident keyed by when it went off, with a console link", async () => {
  const { run, runs } = fake({
    alarms: ok({
      MetricAlarms: [{ AlarmName: "pay 5xx", StateUpdatedTimestamp: "2026-11-23T10:05:30Z" }],
      CompositeAlarms: [{ AlarmName: "all-down", StateUpdatedTimestamp: "2026-11-23T09:00:00Z" }],
    }),
  });
  const found = await createCloudWatchReader({ ...INPUT, logGroups: [] }, run).read(T0);
  expect(found).toEqual([
    {
      key: "all-down 2026-11-23T09:00Z",
      title: "all-down is in alarm",
      url: "https://ap-southeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-southeast-1#alarmsV2:alarm/all-down",
      createdAt: Date.parse("2026-11-23T09:00:00Z"),
    },
    {
      key: "pay 5xx 2026-11-23T10:05Z",
      title: "pay 5xx is in alarm",
      url: "https://ap-southeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-southeast-1#alarmsV2:alarm/pay%205xx",
      createdAt: Date.parse("2026-11-23T10:05:30Z"),
    },
  ]);
  // Read only, always through the profile, and no log group means no logs run.
  expect(runs).toEqual([
    [
      "cloudwatch",
      "describe-alarms",
      "--state-value",
      "ALARM",
      "--profile",
      "nprd",
      "--region",
      "ap-southeast-1",
      "--output",
      "json",
    ],
  ]);
});

test("error lines are one incident an hour for a log group, and no line is quoted", async () => {
  const { run, runs } = fake({
    logs: ok({
      events: [
        { timestamp: T0 + 1000, message: "ERROR card 4111111111111111 declined" },
        { timestamp: T0, message: "ERROR timeout" },
        { timestamp: T0 + 3_600_000, message: "ERROR again" },
      ],
    }),
  });
  const found = await createCloudWatchReader(INPUT, run).read(T0 - 600_000);
  expect(found).toEqual([
    {
      key: "/aws/lambda/pay 2026-11-23T10Z",
      title: "2 error lines in /aws/lambda/pay",
      url: "https://ap-southeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-southeast-1#logsV2:log-groups/log-group/$252Faws$252Flambda$252Fpay",
      createdAt: T0,
    },
    {
      key: "/aws/lambda/pay 2026-11-23T11Z",
      title: "1 error line in /aws/lambda/pay",
      url: "https://ap-southeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-southeast-1#logsV2:log-groups/log-group/$252Faws$252Flambda$252Fpay",
      createdAt: T0 + 3_600_000,
    },
  ]);
  expect(runs[1].slice(0, 11)).toEqual([
    "logs",
    "filter-log-events",
    "--log-group-name",
    "/aws/lambda/pay",
    "--start-time",
    String(T0 - 600_000),
    "--filter-pattern",
    "ERROR",
    "--limit",
    "50",
    "--no-paginate",
  ]);
});

test("a full page of lines reads as more than were counted", async () => {
  const events = Array.from({ length: 50 }, (_, index) => ({ timestamp: T0 + index }));
  const { run } = fake({ logs: ok({ events }) });
  const found = await createCloudWatchReader(INPUT, run).read(T0);
  expect(found.map((issue) => issue.title)).toEqual(["50+ error lines in /aws/lambda/pay"]);
});

test.each([
  [{ code: "ENOENT", stderr: "" }, "The host has no aws CLI"],
  [{ code: null, stderr: "" }, "AWS did not answer in 30 s"],
  [
    { code: 253, stderr: "The config profile (nprd) could not be found" },
    'The host has no AWS profile "nprd"',
  ],
  [
    {
      code: 255,
      stderr: "Error when retrieving token from sso: Token has expired and refresh failed",
    },
    'The AWS sign-in ran out: run "aws sso login --profile nprd" on the host',
  ],
  [
    {
      code: 254,
      stderr: "An error occurred (AccessDeniedException) for arn:aws:iam::123456789012:role/x",
    },
    'The AWS profile "nprd" may not read the alarms',
  ],
  [{ code: 2, stderr: "something about 123456789012" }, "The aws CLI failed (exit 2)"],
])("a failed alarms run %j says %s and never the CLI's own words", async (failure, said) => {
  const { run } = fake({ alarms: { stdout: "", ...failure } });
  expect(await problem(createCloudWatchReader(INPUT, run).read(T0))).toBe(said);
});

test("a log group AWS does not know is named", async () => {
  const { run } = fake({
    logs: { code: 254, stdout: "", stderr: "An error occurred (ResourceNotFoundException)" },
  });
  expect(await problem(createCloudWatchReader(INPUT, run).read(T0))).toBe(
    'AWS has no log group "/aws/lambda/pay" in ap-southeast-1',
  );
});

test("an answer that is not the CLI's JSON is a problem, not a crash", async () => {
  const { run } = fake({ alarms: { code: 0, stdout: "<html>", stderr: "" } });
  expect(await problem(createCloudWatchReader(INPUT, run).read(T0))).toBe(
    "AWS answered in a shape the office does not read",
  );
});
