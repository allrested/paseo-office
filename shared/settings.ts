import { brandFields } from "./branding.js";
import { LANGUAGE_CHOICES } from "./scene-language.js";
import { defineSettings } from "@getpaseo/plugin";
import { WEATHER_MODES, MANUAL_CHOICES } from "./weather.js";
import { z } from "zod";
import { PINNED_NOTES_MAX } from "./alerts.js";
import { RosterTeamsSchema, refuseBadTeams } from "./roster.js";

/** A Jira project key and a Sentry slug: only these reach a JQL query or a Sentry address. */
export const JIRA_KEY = /^[A-Z][A-Z0-9_]+$/;
export const SENTRY_SLUG = /^[a-z0-9][a-z0-9_-]*$/;
/** What reaches the host's AWS CLI as an argument: none can start with a dash. */
export const AWS_PROFILE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
export const AWS_REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;
export const AWS_LOG_GROUP = /^[A-Za-z0-9_/#.][A-Za-z0-9_/#.-]*$/;
/** The most log groups one check reads: each is a run of the CLI. */
export const AWS_LOG_GROUPS_MAX = 10;
const AWS_PATTERN_MAX = 200;

/** The hosts plain http is accepted on, as the URL parser writes them. */
const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/;

function listEntries(text: string): string[] {
  return text
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * The entries of a comma separated list that match `pattern`, trimmed. A saved list has no
 * others: the settings refuse them.
 */
export function parseKeys(text: string, pattern: RegExp): string[] {
  return listEntries(text).filter((entry) => pattern.test(entry));
}

/** What the webhook is sent: `danger` only, or `warning` and `danger`. */
export const NOTIFY_LEVELS = ["danger", "warning"] as const;
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number];

/** A token goes to this address, so it is https; plain http is accepted on this machine only. */
export function isTokenSafe(address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
  const local = url.protocol === "http:" && LOOPBACK.test(url.hostname);
  return url.protocol === "https:" || local;
}

/**
 * The floor plans the 3D scene is offered, by the scene's own names. Headquarters ("hq") is not
 * among them yet.
 */
export const FLOOR_PLANS = ["pro", "cozy", "hq"] as const;
export type FloorPlanChoice = (typeof FLOOR_PLANS)[number];

/** The owner's notes on the 3D floor's whiteboard: this many, each this long, typed with `;` between. */
export const STICKY_NOTES_MAX = 4;
export const STICKY_NOTE_MAX = 60;
const STICKY_NOTES_TEXT_MAX = 400;

/** The notes of the setting's text: trimmed, none empty, cut to what the board has room for. */
export function stickyNotesOf(text: string): string[] {
  return text
    .split(/[;\n]/)
    .map((note) => note.trim())
    .filter((note) => note !== "")
    .slice(0, STICKY_NOTES_MAX)
    .map((note) =>
      note.length > STICKY_NOTE_MAX ? `${note.slice(0, STICKY_NOTE_MAX - 1)}…` : note,
    );
}

/** How long a prompt cache is taken to stay warm after a turn, for the cup on a resting desk. */
/**
 * Whose food, prices and places the team chat's people write about, and in which language:
 * `international` English with nothing local, `indonesian` Indonesian, `vietnamese` English with
 * the Vietnamese lunch of the project the chat comes from.
 */
export const CHAT_CULTURES = ["international", "indonesian", "vietnamese"] as const;
export type ChatCulture = (typeof CHAT_CULTURES)[number];
export const CACHE_CLOCKS = ["off", "5m", "1h"] as const;
export type CacheClock = (typeof CACHE_CLOCKS)[number];

const HostValuesSchema = z.object({
  ...brandFields,
  archiveOnDeparture: z.boolean().default(false),
  agentTools: z.boolean().default(true),
  notesFolder: z.string().default(""),
  notesTimeZone: z.string().default(""),
  notesMode: z.string().max(100).default(""),
  notesDays: z
    .array(z.number())
    .default([1, 2, 3, 4, 5])
    .transform((days) => [...days].sort((a, b) => a - b)),
  // A plan this build does not know (a later build's, or a hand edit) reads as the company floor.
  floorPlan: z.enum(FLOOR_PLANS).default("pro").catch("pro"),
  streamerMode: z.boolean().default(true),
  historyVault: z.boolean().default(false),
  pinnedNotes: z.string().max(PINNED_NOTES_MAX).default(""),
  cacheClock: z.enum(CACHE_CLOCKS).default("1h").catch("1h"),
  chatCulture: z.enum(CHAT_CULTURES).default("international").catch("international"),
  planHidden: z.array(z.string().max(200)).max(50).default([]),
  stickyNotes: z.string().max(STICKY_NOTES_TEXT_MAX).default(""),
  rosterOn: z.boolean().default(false),
  rosterEdition: z.number().int().nonnegative().default(0),
  teams: RosterTeamsSchema,
  uiCards: z.boolean().default(false),
  keepWatching: z.boolean().default(false),
  notifyUrl: z.string().default(""),
  notifyLevel: z.enum(NOTIFY_LEVELS).default("danger"),
  jiraProjects: z.string().default(""),
  sentryOrg: z.string().default(""),
  sentryProjects: z.string().default(""),
  weatherMode: z.enum(WEATHER_MODES).default("off"),
  weatherManual: z.enum(MANUAL_CHOICES).default("season"),
  weatherUrl: z.string().default(""),
  sentryUrl: z.string().default("https://sentry.io"),
  awsProfile: z.string().default(""),
  awsRegion: z.string().default(""),
  awsLogGroups: z.string().default(""),
  awsLogPattern: z.string().max(AWS_PATTERN_MAX).default("ERROR"),
});
type HostValues = z.output<typeof HostValuesSchema>;

const LISTS = [
  { field: "jiraProjects", pattern: JIRA_KEY, what: "a Jira project key" },
  { field: "sentryProjects", pattern: SENTRY_SLUG, what: "a Sentry project slug" },
  { field: "awsLogGroups", pattern: AWS_LOG_GROUP, what: "a CloudWatch log group name" },
] as const;

const AWS_WORDS = [
  { field: "awsProfile", pattern: AWS_PROFILE, what: "an AWS profile name" },
  { field: "awsRegion", pattern: AWS_REGION, what: "an AWS region" },
] as const;

function refuseBadAwsValues(values: HostValues, context: z.RefinementCtx): void {
  for (const { field, pattern, what } of AWS_WORDS) {
    const word = values[field].trim();
    if (word !== "" && !pattern.test(word)) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `${field}: "${word}" is not ${what}`,
      });
    }
  }
  if (listEntries(values.awsLogGroups).length > AWS_LOG_GROUPS_MAX) {
    context.addIssue({
      code: "custom",
      path: ["awsLogGroups"],
      message: `awsLogGroups: at most ${AWS_LOG_GROUPS_MAX} log groups`,
    });
  }
}

function refuseBadTrackerValues(values: HostValues, context: z.RefinementCtx): void {
  for (const { field, pattern, what } of LISTS) {
    const bad = listEntries(values[field]).find((entry) => !pattern.test(entry));
    if (bad !== undefined) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `${field}: "${bad}" is not ${what}`,
      });
    }
  }
  const org = values.sentryOrg.trim();
  if (org !== "" && !SENTRY_SLUG.test(org)) {
    context.addIssue({
      code: "custom",
      path: ["sentryOrg"],
      message: `sentryOrg: "${org}" is not a Sentry organisation slug`,
    });
  }
  if (!isTokenSafe(values.sentryUrl)) {
    context.addIssue({
      code: "custom",
      path: ["sentryUrl"],
      message: `sentryUrl: "${values.sentryUrl}" is not an https address (plain http only on this machine)`,
    });
  }
}

function refuseBadDays(values: HostValues, context: z.RefinementCtx): void {
  const days = values.notesDays;
  const bad = days.find((day) => !Number.isInteger(day) || day < 0 || day > 6);
  const twice = days.find((day, index) => days.indexOf(day) !== index);
  let message: string | null = null;
  if (bad !== undefined) message = `notesDays: ${bad} is not a day from 0 (Sunday) to 6 (Saturday)`;
  else if (twice !== undefined) message = `notesDays: ${twice} is there twice`;
  if (message !== null) context.addIssue({ code: "custom", path: ["notesDays"], message });
}

/** The days the notes were written on before they were a setting. */
const SUNDAY_TO_THURSDAY = [0, 1, 2, 3, 4];

/**
 * Host-wide. `agentTools` off removes the office tools from agent sessions opened afterwards.
 * `notesFolder` is the absolute path the stand-up notes are written in, empty for none, and
 * `notesTimeZone` the IANA zone of their 8:00 run, empty for the host's. `notesMode` is the
 * mode the notes writer starts in, by its provider's id, empty for the office's own choice. `notesDays` are the
 * weekdays of that run, 0 for Sunday to 6 for Saturday, in order; none is no run. `floorPlan` is
 * the 3D floor's plan: `pro` the company floor, `cozy` one open room, or `hq` headquarters.
 * `streamerMode` on (the default) keeps file names, commands and sites out of what the office
 * sends to the floor; off, a person's bubble names what they are at. `stickyNotes` are the
 * owner's notes on the 3D whiteboard, with `;` between them. `historyVault` on has the office
 * keep what is said in each conversation in a file on the host; it is off until the owner turns
 * it on. `pinnedNotes` is said again to an agent whose conversation is compacted during a turn;
 * empty says nothing. `cacheClock` is how long a prompt cache is taken to last after a turn, for
 * the steaming cup on a resting desk of the 3D floor; `off` draws none. `planHidden` are the
 * providers whose plan limits the office leaves out: a plan nobody pays for reads as used up.
 * `rosterOn` has the office name teams and agents from `teams`, teams in the order
 * they are handed out, each with its teammates; `rosterEdition` goes up when that list grows or is switched
 * on, so what was passed over is looked at again. `uiCards` on has a session's chat show a card
 * where a reply holds a `ui` or `app` block of the Generative UI plugin, not the block's source.
 * `keepWatching` on has the office go on reading the agents while no office is open, so the
 * timeline, the vault and what the office notices have no gaps. `notifyUrl` is the webhook the
 * office posts to when it raises an alert or opens an incident; empty posts nothing.
 * `notifyLevel` is what is posted: `danger` a loop and an incident only, `warning` the rest too.
 * `jiraProjects`
 * and `sentryProjects` are the comma separated projects checked for incidents, `sentryOrg` their
 * Sentry organisation and `sentryUrl` the Sentry the token is sent to. `awsProfile` and `awsRegion`
 * name a profile of the host's AWS CLI whose CloudWatch alarms are checked too, `awsLogGroups` the
 * comma separated log groups read for lines that match `awsLogPattern`.
 */
export const officeHostSettings = defineSettings({
  id: "office",
  scope: "host",
  version: 10,
  schema: HostValuesSchema.superRefine(refuseBadTrackerValues)
    .superRefine(refuseBadAwsValues)
    .superRefine(refuseBadDays)
    .superRefine(({ teams }, context) => refuseBadTeams(teams, context))
    .superRefine(({ notifyUrl }, ctx) => {
      if (notifyUrl.trim() && !isTokenSafe(notifyUrl.trim()))
        ctx.addIssue({
          code: "custom",
          path: ["notifyUrl"],
          message: "notifyUrl: not an https address (plain http only on this machine)",
        });
    })
    .superRefine(({ weatherUrl }, ctx) => {
      if (weatherUrl.trim() && !isTokenSafe(weatherUrl.trim()))
        ctx.addIssue({
          code: "custom",
          path: ["weatherUrl"],
          message: "weatherUrl: not an https address (plain http only on this machine)",
        });
    }),
  // Version 1 had only `agentTools`, version 2 no incident fields and version 3 no `notesDays`:
  // what a document has stays, and the rest take their defaults, but for the days. Before
  // version 4 the notes ran Sunday to Thursday, so a host that had settings keeps those days.
  // Version 5 adds Headquarters and weather. Older documents keep their floor plan and start with weather off.
  // Version 7 adds the roster, off and empty. Version 8 adds `uiCards`, off.
  // Version 9 adds `keepWatching`, off. Version 10 adds `notifyUrl`, empty, and `notifyLevel`, danger.
  migrate: (values, fromVersion) =>
    fromVersion < 4 && typeof values === "object" && values !== null
      ? { notesDays: SUNDAY_TO_THURSDAY, ...values }
      : values,
});

/** Outdoor environments for the 3D floor. */
export const OFFICE_SCENES = ["plain", "city", "countryside", "beach"] as const;
export type OfficeScene = (typeof OFFICE_SCENES)[number];
export const OFFICE_GRAPHICS = ["auto", "low", "medium", "high"] as const;
export type OfficeGraphics = (typeof OFFICE_GRAPHICS)[number];
export const OFFICE_LIGHTING = ["auto", "day", "night"] as const;
export type OfficeLighting = (typeof OFFICE_LIGHTING)[number];

/** The 3D floor, the 2D pixel floor and the list. */
export const OFFICE_VIEWS = ["3d", "2d", "list"] as const;
export type OfficeViewChoice = (typeof OFFICE_VIEWS)[number];

/**
 * Per device. `view` is the view somebody chose. A device that never chose has only `threeD`,
 * from when the office had a 3D switch: off is the list, on leaves the choice to the device. A
 * save writes both. A client from before version 2 reads neither: it refuses the newer version.
 * Earlier devices chose City or Plain with `street`. An explicit `scene` takes precedence.
 * `rungIncidents` is when this device rang its alarm for each incident, epoch ms by incident id.
 * `lastAgent` is the provider and model of the last agent started from the office, the next
 * form's start. Every save of this setting writes the document whole and carries it through.
 */
export const officeDeviceSettings = defineSettings({
  id: "office-device",
  scope: "device",
  version: 2,
  schema: z.object({
    threeD: z.boolean().default(true),
    street: z.boolean().optional(),
    scene: z.enum(OFFICE_SCENES).optional(),
    lighting: z.enum(OFFICE_LIGHTING).optional(),
    graphics: z.enum(OFFICE_GRAPHICS).optional(),
    sessionsHidden: z.boolean().optional(),
    view: z.enum(OFFICE_VIEWS).optional(),
    rungIncidents: z.record(z.string(), z.number()).default({}),
    lastAgent: z.object({ provider: z.string(), model: z.string() }).optional(),
    sound: z.boolean().default(false),
  }),
  // Version 1 had no `rungIncidents`: its values stay, and the device has rung for none. An
  // additive optional field such as `lastAgent` takes no version bump: a client from before it
  // still reads the document. `sound` is the 3D floor's Sound switch, off until someone turns it
  // on; the scene's button and the settings page change it. Every save of this document writes it
  // whole.
  migrate: (values) => values,
});

/**
 * The office's column on this device: its width beside the floor and whether it is collapsed to
 * its rail. A setting of its own: the view's and the incidents' saves write `office-device` whole,
 * and would drop a field of the column's.
 */
export const officeColumnSettings = defineSettings({
  id: "office-column",
  scope: "device",
  version: 1,
  schema: z.object({
    width: z.number().default(360),
    collapsed: z.boolean().default(false),
  }),
});

/**
 * The 3D office's language on this device. "auto" follows the app's language where the office has words for
 * it, else English. A setting of its own, as the column's is: the view's and the incidents' saves write
 * `office-device` whole, and would drop a field of this one.
 */
export const officeLanguageSettings = defineSettings({
  id: "office-language",
  scope: "device",
  version: 1,
  schema: z.object({ choice: z.enum(LANGUAGE_CHOICES).default("auto") }),
});
