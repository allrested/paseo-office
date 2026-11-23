import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { TrackersChange } from "../shared/contracts.js";
import { isTokenSafe } from "../shared/settings.js";
import { jiraEnv, type JiraEnv } from "./incidents-jira.js";
import { sentryToken } from "./incidents-sentry.js";

const SavedTrackersSchema = z.object({
  version: z.literal(1),
  jira: z.object({ baseUrl: z.string(), email: z.string(), token: z.string() }).optional(),
  sentry: z.object({ token: z.string() }).optional(),
});
/** The connections saved from the settings. They hold tokens: never sent to a client or logged. */
export type SavedTrackers = z.output<typeof SavedTrackersSchema>;

export const NO_SAVED_TRACKERS: SavedTrackers = { version: 1 };

export interface TrackerCredentialsStore {
  /** A missing or unreadable file is no saved connection; any other read error rejects. */
  load(): Promise<SavedTrackers>;
  /** Rejects when the write fails. */
  save(saved: SavedTrackers): Promise<void>;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** The file is written for its owner only, and replaced whole so its mode is always that. */
export function createTrackerCredentialsStore(options: {
  file: string;
  log(message: string): void;
}): TrackerCredentialsStore {
  const { file, log } = options;
  let temp = 0;

  async function load(): Promise<SavedTrackers> {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (isMissing(error)) return NO_SAVED_TRACKERS;
      throw error;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      json = null;
    }
    const parsed = SavedTrackersSchema.safeParse(json);
    if (parsed.success) return parsed.data;
    // Only that it is unreadable: a parse error's message quotes the file, which holds tokens.
    log(`[office] ${file} is unreadable; no tracker connection is saved until the next save`);
    return NO_SAVED_TRACKERS;
  }

  async function save(saved: SavedTrackers): Promise<void> {
    temp += 1;
    const tempFile = `${file}.tmp-${temp}`;
    await mkdir(dirname(file), { recursive: true });
    try {
      await writeFile(tempFile, `${JSON.stringify(saved)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(tempFile, file);
    } catch (error) {
      await rm(tempFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  return { load, save };
}

/** Where a tracker's sign-in comes from: the settings' saved connection, or the daemon's environment. */
export type CredentialSource = "saved" | "env";

interface Sourced {
  source: CredentialSource;
  /** What a refused token's message tells the owner to check. */
  tokenVariable: string;
}

export interface TrackerCredentials {
  jira: (JiraEnv & Sourced) | null;
  sentry: ({ token: string } & Sourced) | null;
}

/** Each tracker's sign-in: the saved connection, else the daemon's environment, else none. */
export function trackerCredentials(
  saved: SavedTrackers,
  env: NodeJS.ProcessEnv,
): TrackerCredentials {
  const fromEnv = jiraEnv(env);
  const envToken = sentryToken(env);
  let jira: TrackerCredentials["jira"] = null;
  if (saved.jira !== undefined) {
    jira = { ...saved.jira, source: "saved", tokenVariable: "the saved Jira token" };
  } else if (fromEnv !== null) {
    jira = { ...fromEnv, source: "env", tokenVariable: "ATLASSIAN_API_TOKEN" };
  }
  let sentry: TrackerCredentials["sentry"] = null;
  if (saved.sentry !== undefined) {
    sentry = { ...saved.sentry, source: "saved", tokenVariable: "the saved Sentry token" };
  } else if (envToken !== null) {
    sentry = { token: envToken, source: "env", tokenVariable: "SENTRY_AUTH_TOKEN" };
  }
  return { jira, sentry };
}

export type SavedChange = { saved: SavedTrackers } | { problem: string };

function without(saved: SavedTrackers, tracker: "jira" | "sentry"): SavedTrackers {
  const { [tracker]: _removed, ...kept } = saved;
  return kept;
}

/**
 * `saved` after a change from the settings, or why the change is refused. A Jira save with no
 * token keeps the saved one, so the address or email can change without typing it again.
 */
export function changeSavedTrackers(saved: SavedTrackers, change: TrackersChange): SavedChange {
  if (change.action === "clear") return { saved: without(saved, change.tracker) };
  const token = change.token.trim();
  if (change.action === "save-sentry") {
    if (token === "") return { problem: "Enter the Sentry auth token" };
    return { saved: { ...saved, sentry: { token } } };
  }
  const baseUrl = change.baseUrl.trim().replace(/\/+$/, "");
  const email = change.email.trim();
  const kept = token === "" ? (saved.jira?.token ?? "") : token;
  if (!isTokenSafe(baseUrl)) {
    return {
      problem: "The Jira address must be an https address (plain http only on this machine)",
    };
  }
  if (email === "") return { problem: "Enter the Jira account's email" };
  if (kept === "") return { problem: "Enter the Jira API token" };
  return { saved: { ...saved, jira: { baseUrl, email, token: kept } } };
}
