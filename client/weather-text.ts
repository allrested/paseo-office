import type { WeatherState } from "../shared/contracts.js";
import { weatherWords, type WeatherMode } from "../shared/weather.js";
import type { StripCard } from "./attention-strip.js";
import { ageText } from "./incidents-text.js";

export function weatherEntry(
  state: WeatherState | undefined,
  onOpen: (() => void) | undefined,
): StripCard | null {
  if (!onOpen || state === undefined || state.problem === null) return null;
  return { title: "Weather", note: { text: state.problem, tone: "warning" }, onOpen };
}

export interface WeatherStatusInput {
  mode: WeatherMode;
  address: string;
  state: WeatherState | undefined;
  now: number;
}

export function weatherStatus({ mode, address, state, now }: WeatherStatusInput): string | null {
  if (mode !== "service") return null;
  if (address.trim() === "") return "No address: the season's weather shows until one is set.";
  if (state === undefined || state.problem !== null) {
    return state === undefined ? "Waiting for the first answer." : null;
  }
  const { scene, readAt } = state;
  if (scene.kind !== "reading" || readAt === null) return "Waiting for the first answer.";
  const temp = scene.temp === null ? "" : `, ${Math.round(scene.temp)}°`;
  return `Last answer ${ageText(Math.max(0, now - readAt))}: ${weatherWords(scene.code)}${temp}.`;
}
