import type { WeatherScene, WeatherState } from "../shared/contracts.js";
import { isTokenSafe } from "../shared/settings.js";
import {
  presetReading,
  type ManualChoice,
  type WeatherMode,
  type WeatherReading,
} from "../shared/weather.js";
import type { Clock } from "./timers.js";
import { WeatherProblem } from "./weather-read.js";

export const WEATHER_EVERY_MS = 900_000;
export const WEATHER_STALE_MS = 1_800_000;
const UNSAFE = "The weather address is not an https address (plain http only on this machine)";
const SEASON: WeatherScene = { kind: "season" };

export interface WeatherSettings {
  weatherMode: WeatherMode;
  weatherManual: ManualChoice;
  weatherUrl: string;
}

export interface WeatherPorts {
  clock: Clock;
  read(address: string): Promise<WeatherReading>;
  changed(state: WeatherState): void;
  log(message: string): void;
}

export interface WeatherService {
  settingsChanged(settings: WeatherSettings): void;
  officeOpen(open: boolean): void;
  stop(): void;
}

/** The last attempt at an address: its answer or its problem. */
interface Attempt {
  address: string;
  at: number;
  reading: WeatherReading | null;
  problem: string | null;
}

/**
 * Holds what the 3D scene is told of the weather. A service is read while an office is open: at
 * once when one opens, when the address changes, and 15 minutes after each attempt, a failed one
 * too. Nothing is read while no office is open, and nothing is kept across a restart.
 */
export function createWeatherService(ports: WeatherPorts): WeatherService {
  let settings: WeatherSettings | null = null;
  let open = false;
  let last: Attempt | null = null;
  let cancel: (() => void) | null = null;
  let busy = false;
  let stopped = false;

  /** The address to read: null unless the mode is the service and one is typed. */
  function address(): string | null {
    if (settings === null || settings.weatherMode !== "service") return null;
    const text = settings.weatherUrl.trim();
    return text === "" ? null : text;
  }

  function stateNow(): WeatherState {
    const none = { problem: null, readAt: null };
    if (settings === null || settings.weatherMode === "off")
      return { scene: { kind: "none" }, ...none };
    if (settings.weatherMode === "manual") {
      const choice = settings.weatherManual;
      const scene: WeatherScene =
        choice === "season" ? SEASON : { kind: "reading", ...presetReading(choice) };
      return { scene, ...none };
    }
    const where = address();
    if (where === null) return { scene: SEASON, ...none };
    if (!isTokenSafe(where)) return { scene: SEASON, problem: UNSAFE, readAt: null };
    const kept = last !== null && last.address === where ? last : null;
    const shown =
      kept !== null && kept.reading !== null && ports.clock.now() - kept.at < WEATHER_STALE_MS
        ? { reading: kept.reading, at: kept.at }
        : null;
    return {
      scene: shown === null ? SEASON : { kind: "reading", ...shown.reading },
      problem: kept?.problem ?? null,
      readAt: shown?.at ?? null,
    };
  }

  function publish(): void {
    if (settings !== null) ports.changed(stateNow());
  }

  function disarm(): void {
    cancel?.();
    cancel = null;
  }

  function arm(delay: number): void {
    disarm();
    cancel = ports.clock.setTimeout(() => {
      cancel = null;
      consider();
    }, delay);
  }

  /** Pushes the state, then reads now, waits for the 15 minutes, or does neither. */
  function consider(): void {
    if (stopped) return;
    disarm();
    publish();
    const where = address();
    if (where === null || !isTokenSafe(where) || !open) return;
    const kept = last !== null && last.address === where ? last : null;
    const wait = kept === null ? 0 : kept.at + WEATHER_EVERY_MS - ports.clock.now();
    if (wait > 0) arm(wait);
    else void readNow(where);
  }

  async function readNow(where: string): Promise<void> {
    if (busy) return;
    busy = true;
    let reading: WeatherReading | null = null;
    let problem: string | null = null;
    try {
      reading = await ports.read(where);
    } catch (error) {
      problem = error instanceof WeatherProblem ? error.message : "The weather check failed";
    }
    busy = false;
    if (stopped) return;
    // Changed while it was out: this answer is for an address nobody asked about now.
    if (address() !== where) {
      consider();
      return;
    }
    const before = last !== null && last.address === where ? last.problem : null;
    // Logged when it changes, so a service down all night logs once.
    if (problem !== null && problem !== before) ports.log(`[office] weather: ${problem}`);
    last = { address: where, at: ports.clock.now(), reading, problem };
    consider();
  }

  return {
    settingsChanged(next) {
      settings = next;
      consider();
    },
    officeOpen(next) {
      if (open === next) return;
      open = next;
      consider();
    },
    stop() {
      stopped = true;
      disarm();
    },
  };
}
