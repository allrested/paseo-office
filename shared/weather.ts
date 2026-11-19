export interface WeatherReading {
  code: number;
  temp: number | null;
  cloud: number;
}

export const WEATHER_MODES = ["off", "manual", "service"] as const;
export type WeatherMode = (typeof WEATHER_MODES)[number];

export const MANUAL_CHOICES = ["clear", "cloudy", "rain", "storm", "season"] as const;
export type ManualChoice = (typeof MANUAL_CHOICES)[number];

export const MANUAL_LABELS: Readonly<Record<ManualChoice, string>> = {
  clear: "Clear",
  cloudy: "Cloudy",
  rain: "Rain",
  storm: "Storm",
  season: "Follow the season",
};

const PRESETS: Readonly<Record<Exclude<ManualChoice, "season">, WeatherReading>> = {
  clear: { code: 0, temp: null, cloud: 0 },
  cloudy: { code: 3, temp: null, cloud: 0.9 },
  rain: { code: 63, temp: null, cloud: 0.9 },
  storm: { code: 95, temp: null, cloud: 1 },
};

export function presetReading(choice: Exclude<ManualChoice, "season">): WeatherReading {
  return { ...PRESETS[choice] };
}

export function cloudFromCode(code: number): number {
  if (code === 0) return 0;
  if (code <= 2) return 0.3;
  return code <= 48 ? 0.9 : 1;
}

export function weatherWords(code: number): string {
  if (code === 0) return "clear sky";
  if (code <= 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code <= 48) return "fog";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain showers";
  return "thunderstorm";
}

/** The settings page's example: open-meteo's forecast with the three fields the office reads. Not a default. */
export const WEATHER_ADDRESS_EXAMPLE =
  "https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m,weather_code,cloud_cover";
