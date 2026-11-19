import { expect, test, vi } from "vitest";
import { createFakeClock, settle } from "./fake-clock.js";
import {
  createWeatherService,
  WEATHER_EVERY_MS,
  WEATHER_STALE_MS,
  type WeatherSettings,
} from "./weather-service.js";
import { WeatherProblem } from "./weather-read.js";
const settings: WeatherSettings = {
  weatherMode: "service",
  weatherManual: "season",
  weatherUrl: "https://w.test/data?key=SECRET",
};
const rain = { code: 63, temp: 14.2, cloud: 0.9 };
function harness() {
  const clock = createFakeClock();
  const read = vi.fn(async (_address: string) => rain);
  const changed = vi.fn(),
    log = vi.fn();
  return {
    clock,
    read,
    changed,
    log,
    service: createWeatherService({ clock, read, changed, log }),
  };
}
test("manual, off, empty and unsafe addresses never make a request", () => {
  const { service, changed, read, clock } = harness();
  service.officeOpen(true);
  for (const [patch, scene] of [
    [{ weatherMode: "off" }, { kind: "none" }],
    [
      { weatherMode: "manual", weatherManual: "rain" },
      { kind: "reading", ...rain, temp: null },
    ],
    [{ weatherMode: "manual" }, { kind: "season" }],
    [{ weatherUrl: " " }, { kind: "season" }],
    [{ weatherUrl: "http://nonlocal.test/?key=SECRET" }, { kind: "season" }],
  ] as const) {
    service.settingsChanged({ ...settings, ...patch });
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ scene }));
  }
  expect(changed.mock.lastCall?.[0].problem).not.toContain("SECRET");
  expect(read).not.toHaveBeenCalled();
  expect(clock.pending()).toBe(0);
});
test("reading and retrying are limited to open offices and a failure clears the old sky", async () => {
  const { service, changed, read, clock, log } = harness();
  service.settingsChanged(settings);
  expect(read).not.toHaveBeenCalled();
  service.officeOpen(true);
  await settle();
  expect(changed).toHaveBeenLastCalledWith({
    scene: { kind: "reading", ...rain },
    readAt: 0,
    problem: null,
  });
  service.officeOpen(false);
  clock.advance(1000);
  service.officeOpen(true);
  service.officeOpen(true);
  clock.advance(WEATHER_EVERY_MS - 1001);
  expect(read).toHaveBeenCalledTimes(1);
  read.mockRejectedValue(new WeatherProblem("Weather service is down"));
  clock.advance(1);
  await settle();
  expect(changed).toHaveBeenLastCalledWith({
    scene: { kind: "season" },
    problem: "Weather service is down",
    readAt: null,
  });
  clock.advance(WEATHER_EVERY_MS);
  await settle();
  expect(log).toHaveBeenCalledTimes(1);
  read.mockResolvedValue(rain);
  clock.advance(WEATHER_EVERY_MS);
  await settle();
  expect(changed.mock.lastCall?.[0].problem).toBeNull();
  service.officeOpen(false);
  clock.advance(WEATHER_STALE_MS);
  service.officeOpen(true);
  expect(changed.mock.lastCall?.[0].scene).toEqual({ kind: "season" });
  await settle();
  service.stop();
  expect(clock.pending()).toBe(0);
});
test("replacing an in-flight address drops its answer and reads the new one", async () => {
  const { service, read, changed } = harness();
  let finish: (value: typeof rain) => void = () => {};
  read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  service.settingsChanged(settings);
  service.officeOpen(true);
  service.settingsChanged({ ...settings, weatherUrl: "https://other.test" });
  finish({ ...rain, temp: 99 });
  await settle();
  expect(read).toHaveBeenLastCalledWith("https://other.test");
  expect(changed.mock.calls.flat().some((s) => s.scene.temp === 99)).toBe(false);
  expect(changed.mock.lastCall?.[0].scene).toEqual({ kind: "reading", ...rain });
  service.stop();
});
