import { z } from "zod";
import { cloudFromCode, type WeatherReading } from "../shared/weather.js";

export class WeatherProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeatherProblem";
  }
}

export const WEATHER_TIMEOUT_MS = 10_000;
export const WEATHER_MAX_BYTES = 65_536;

/**
 * open-meteo's `current` block, as upstream's weather read it: the code and the temperature are
 * required, the cloud cover is used when it is a number. `is_day` and every other key are left
 * out on purpose: the scene's night follows the app's theme.
 */
const AnswerSchema = z.object({
  current: z.object({
    weather_code: z.number().int().min(0).max(99),
    temperature_2m: z.number(),
    cloud_cover: z.number().optional().catch(undefined),
  }),
});

const SHAPE =
  "The weather service answered in a shape the office does not read: it needs current.weather_code and current.temperature_2m";

export interface WeatherReaderOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

// Node and undici attach transport codes to the cause. Only these fixed labels can enter
// the shared snapshot or plugin log, even if a fetch implementation supplies other text.
const NETWORK_ERRORS = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** A failed request's message may contain the service address. */
function unreachable(error: unknown, timeoutMs: number): WeatherProblem {
  if (error instanceof Error && error.name === "TimeoutError") {
    return new WeatherProblem(`The weather service did not answer in ${timeoutMs / 1000} s`);
  }
  const cause = error instanceof Error ? error.cause : undefined;
  const code =
    cause instanceof Error && "code" in cause && typeof cause.code === "string" ? cause.code : null;
  return new WeatherProblem(
    code === null || !NETWORK_ERRORS.has(code)
      ? "The weather service could not be reached"
      : `The weather service could not be reached: ${code}`,
  );
}

/** The body as text, or null once it passes `max` bytes (the rest is not read). */
async function boundedText(response: Response, max: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export function createWeatherReader(
  options: WeatherReaderOptions = {},
): (address: string) => Promise<WeatherReading> {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? WEATHER_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? WEATHER_MAX_BYTES;
  return async (address) => {
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    let text: string | null;
    try {
      response = await fetchFn(address, {
        headers: { Accept: "application/json" },
        // Only the address that was checked is read: a redirect could lead anywhere.
        redirect: "manual",
        signal,
      });
      if (response.ok) text = await boundedText(response, maxBytes);
      else {
        await response.body?.cancel();
        text = "";
      }
    } catch (error) {
      throw unreachable(signal.aborted ? signal.reason : error, timeoutMs);
    }
    const { status } = response;
    if (status >= 300 && status < 400) {
      throw new WeatherProblem(`The weather service answered with a redirect (HTTP ${status})`);
    }
    if (!response.ok) throw new WeatherProblem(`The weather service answered HTTP ${status}`);
    if (text === null) {
      throw new WeatherProblem(`The weather service's answer is larger than ${maxBytes / 1024} KB`);
    }
    const parsed = AnswerSchema.safeParse(parseBody(text));
    if (!parsed.success) throw new WeatherProblem(SHAPE);
    const { weather_code: code, temperature_2m: temp, cloud_cover: cover } = parsed.data.current;
    const cloud = cover === undefined ? cloudFromCode(code) : Math.min(1, Math.max(0, cover / 100));
    return { code, temp, cloud };
  };
}
