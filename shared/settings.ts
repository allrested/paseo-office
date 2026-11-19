import { LANGUAGE_CHOICES } from "./scene-language.js";
import { defineSettings } from "@getpaseo/plugin";
import { WEATHER_MODES, MANUAL_CHOICES } from "./weather.js";
import { z } from "zod";

/** A Jira project key and a Sentry slug: only these reach a JQL query or a Sentry address. */
export const JIRA_KEY = /^[A-Z][A-Z0-9_]+$/;
export const SENTRY_SLUG = /^[a-z0-9][a-z0-9_-]*$/;

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

const HostValuesSchema = z.object({
  agentTools: z.boolean().default(true),
  notesFolder: z.string().default(""),
  notesTimeZone: z.string().default(""),
  notesDays: z
    .array(z.number())
    .default([1, 2, 3, 4, 5])
    .transform((days) => [...days].sort((a, b) => a - b)),
  // A plan this build does not know (a later build's, or a hand edit) reads as the company floor.
  floorPlan: z.enum(FLOOR_PLANS).default("pro").catch("pro"),
  jiraProjects: z.string().default(""),
  sentryOrg: z.string().default(""),
  sentryProjects: z.string().default(""),
  weatherMode: z.enum(WEATHER_MODES).default("off"),
  weatherManual: z.enum(MANUAL_CHOICES).default("season"),
  weatherUrl: z.string().default(""),
  sentryUrl: z.string().default("https://sentry.io"),
});
type HostValues = z.output<typeof HostValuesSchema>;

const LISTS = [
  { field: "jiraProjects", pattern: JIRA_KEY, what: "a Jira project key" },
  { field: "sentryProjects", pattern: SENTRY_SLUG, what: "a Sentry project slug" },
] as const;

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
 * `notesTimeZone` the IANA zone of their 8:00 run, empty for the host's. `notesDays` are the
 * weekdays of that run, 0 for Sunday to 6 for Saturday, in order; none is no run. `floorPlan` is
 * the 3D floor's plan: `pro` the company floor, `cozy` one open room, or `hq` headquarters. `jiraProjects`
 * and `sentryProjects` are the comma separated projects checked for incidents, `sentryOrg` their
 * Sentry organisation and `sentryUrl` the Sentry the token is sent to.
 */
export const officeHostSettings = defineSettings({
  id: "office",
  scope: "host",
  version: 5,
  schema: HostValuesSchema.superRefine(refuseBadTrackerValues)
    .superRefine(refuseBadDays)
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
  // Version 5 offers Headquarters. Existing plans keep their values.
  migrate: (values, fromVersion) =>
    fromVersion < 4 && typeof values === "object" && values !== null
      ? { notesDays: SUNDAY_TO_THURSDAY, ...values }
      : values,
});

/** The office's views: the 3D floor, the 2D pixel floor and the list. */
export const OFFICE_VIEWS = ["3d", "2d", "list"] as const;
export type OfficeViewChoice = (typeof OFFICE_VIEWS)[number];

/**
 * Per device. `view` is the view somebody chose. A device that never chose has only `threeD`,
 * from when the office had a 3D switch: off is the list, on leaves the choice to the device. A
 * save writes both. A client from before version 2 reads neither: it refuses the newer version.
 * `street` controls the 3D street. When absent, wide web layouts show it.
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
