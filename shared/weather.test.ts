// shared/weather.test.ts
import { expect, test } from "vitest";
import {
  MANUAL_CHOICES,
  WEATHER_ADDRESS_EXAMPLE,
  cloudFromCode,
  presetReading,
  weatherWords,
} from "./weather.js";

test("the hand-picked choices are the codes upstream's rain and light read", () => {
  expect(presetReading("clear")).toEqual({ code: 0, temp: null, cloud: 0 });
  expect(presetReading("cloudy")).toEqual({ code: 3, temp: null, cloud: 0.9 });
  expect(presetReading("rain")).toEqual({ code: 63, temp: null, cloud: 0.9 });
  expect(presetReading("storm")).toEqual({ code: 95, temp: null, cloud: 1 });
});

test("the choices are the five the settings page offers, the season last", () => {
  expect(MANUAL_CHOICES).toEqual(["clear", "cloudy", "rain", "storm", "season"]);
});

test("a code with no cloud share gets the share its words imply", () => {
  expect(cloudFromCode(0)).toBe(0);
  expect(cloudFromCode(1)).toBe(0.3);
  expect(cloudFromCode(2)).toBe(0.3);
  expect(cloudFromCode(3)).toBe(0.9);
  expect(cloudFromCode(45)).toBe(0.9);
  expect(cloudFromCode(61)).toBe(1);
  expect(cloudFromCode(95)).toBe(1);
});

test("a code in words, with upstream's thresholds", () => {
  const words = (codes: number[]) => codes.map(weatherWords);
  expect(words([0, 1, 2, 3, 45, 48])).toEqual([
    "clear sky",
    "partly cloudy",
    "partly cloudy",
    "overcast",
    "fog",
    "fog",
  ]);
  expect(words([51, 57, 61, 67, 71, 77, 80, 82, 95, 99])).toEqual([
    "drizzle",
    "drizzle",
    "rain",
    "rain",
    "snow",
    "snow",
    "rain showers",
    "rain showers",
    "thunderstorm",
    "thunderstorm",
  ]);
});

test("the example address has a latitude and a longitude and asks for the three fields read", () => {
  const url = new URL(WEATHER_ADDRESS_EXAMPLE);
  expect(url.protocol).toBe("https:");
  expect(url.searchParams.get("latitude")).toBe("52.52");
  expect(url.searchParams.get("longitude")).toBe("13.41");
  expect(url.searchParams.get("current")).toBe("temperature_2m,weather_code,cloud_cover");
});
