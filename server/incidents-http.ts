import { z } from "zod";

/** An issue a tracker made since the time asked; `createdAt` is the tracker's time, epoch ms. */
export interface FoundIssue {
  key: string;
  title: string;
  url: string;
  createdAt: number;
}

export interface TrackerReader {
  /** The issues made since `since` (epoch ms), oldest first. Rejects with a `TrackerProblem`. */
  read(since: number): Promise<FoundIssue[]>;
  /**
   * Which of these open incidents the tracker now holds as resolved, by key. A tracker without
   * it closes nothing: its incidents stay until dismissed or a day old.
   */
  resolved?(open: readonly { key: string; url: string }[]): Promise<string[]>;
}

/** The most open incidents one check asks a tracker about. */
export const RESOLVED_MAX = 20;

/**
 * Why a tracker could not be read. The message is shown on the Incidents card and logged, so it
 * holds a status and the tracker's own words only: never a header, a token or an address.
 */
export class TrackerProblem extends Error {
  /** The message without the tracker's own words: what a log line may say. */
  readonly withoutWords: string;
  /** The tracker did not answer in time: a request that changes something may have been done. */
  readonly timedOut: boolean;

  /** `words` are the tracker's own, put after the message; they can quote what was asked. */
  constructor(message: string, options: { words?: string; timedOut?: boolean } = {}) {
    super(options.words ? `${message}: ${options.words}` : message);
    this.name = "TrackerProblem";
    this.withoutWords = message;
    this.timedOut = options.timedOut ?? false;
  }
}

const TIMEOUT_MS = 30_000;
/** The most of an answer read: a larger one is refused, not held in memory. */
const BODY_MAX = 5_000_000;
/** How much of the tracker's own words a problem keeps. */
const WORDS_MAX = 200;

export interface Tracker {
  /** The tracker's name, for messages. */
  name: "Jira" | "Sentry";
  /** The variable that holds the token, named when the tracker refuses it. */
  tokenVariable: string;
  /** The sign-in header, sent with every request. */
  headers: Record<string, string>;
  fetchFn: typeof fetch;
}

export interface GetJsonInput<Schema extends z.ZodType> {
  tracker: Tracker;
  url: string;
  schema: Schema;
}

// Jira says why in `errorMessages`, Sentry in `detail`. Either may be missing or of another shape.
const RefusalSchema = z.object({
  errorMessages: z.array(z.string()).optional().catch(undefined),
  detail: z.string().optional().catch(undefined),
});

/** A failed request's error says nothing safe but its code: its text can hold the address. */
function unreachable(name: string, error: unknown): TrackerProblem {
  if (error instanceof Error && error.name === "TimeoutError") {
    return new TrackerProblem(`${name} did not answer in ${TIMEOUT_MS / 1000} s`, {
      timedOut: true,
    });
  }
  const cause = error instanceof Error ? error.cause : undefined;
  const hasCode = cause instanceof Error && "code" in cause && typeof cause.code === "string";
  if (!hasCode) return new TrackerProblem(`${name} could not be reached`);
  return new TrackerProblem(`${name} could not be reached: ${cause.code}`);
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    // An error page from a proxy, say: the status is then all there is to tell.
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function refusal(name: string, status: number, body: unknown): TrackerProblem {
  const parsed = RefusalSchema.safeParse(body);
  const said = parsed.success ? (parsed.data.errorMessages?.[0] ?? parsed.data.detail ?? "") : "";
  const words = said.replace(/\s+/g, " ").trim().slice(0, WORDS_MAX);
  return new TrackerProblem(`${name} answered HTTP ${status}`, { words });
}

/**
 * One request to a tracker; resolves its parsed body once it answered 2xx. Rejects with a
 * `TrackerProblem`.
 */
function tooMuch(name: string): TrackerProblem {
  return new TrackerProblem(`${name} answered with too much data`);
}

/** The answer's text, read until `BODY_MAX` bytes and refused past it. */
async function cappedText(name: string, response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (declared > BODY_MAX) {
    await response.body?.cancel().catch(() => undefined);
    throw tooMuch(name);
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BODY_MAX) {
      await reader.cancel().catch(() => undefined);
      throw tooMuch(name);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

interface SendInit {
  method?: "POST";
  headers?: Record<string, string>;
  body?: string;
}

async function send(tracker: Tracker, url: string, init: SendInit): Promise<unknown> {
  const { name } = tracker;
  let response: Response;
  let text: string;
  try {
    response = await tracker.fetchFn(url, {
      ...init,
      headers: { ...tracker.headers, Accept: "application/json", ...init.headers },
      // A redirect would carry the token to wherever it points.
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    text = await cappedText(name, response);
  } catch (error) {
    if (error instanceof TrackerProblem) throw error;
    throw unreachable(name, error);
  }
  const { status } = response;
  if (status >= 300 && status < 400) {
    throw new TrackerProblem(`${name} answered with a redirect (HTTP ${status})`);
  }
  if (status === 401 || status === 403) {
    throw new TrackerProblem(`${name} refused the token: check ${tracker.tokenVariable}`);
  }
  const body = parseBody(text);
  if (!response.ok) throw refusal(name, status, body);
  return body;
}

/** One GET to a tracker, read through `schema`. Rejects with a `TrackerProblem`. */
export async function getJson<Schema extends z.ZodType>(
  input: GetJsonInput<Schema>,
): Promise<z.output<Schema>> {
  const { tracker, url, schema } = input;
  const body = await send(tracker, url, {});
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new TrackerProblem(`${tracker.name} answered in a shape the office does not read`);
  }
  return parsed.data;
}

/**
 * One POST of `body` as JSON to a tracker, with the GET's safety: its answer is not read. Rejects
 * with a `TrackerProblem`.
 */
export async function postJson(input: { tracker: Tracker; url: string; body: unknown }) {
  await send(input.tracker, input.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.body),
  });
}
