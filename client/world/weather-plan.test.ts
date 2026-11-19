// client/world/weather-plan.test.ts
import { expect, test } from "vitest";
// @ts-expect-error vendored JavaScript has no declarations
import * as weatherPlan from "../../vendor/my-office/src/office/paseo-weather-plan.js";

const { SEASON_WEATHER, weatherToDraw } = weatherPlan;
const RAIN = { kind: "reading", code: 63, temp: 14.2, cloud: 0.9 };

test("no weather, or anything unreadable, draws none", () => {
  expect(weatherToDraw({ kind: "none" }, "halloween")).toBeNull();
  expect(weatherToDraw(undefined, null)).toBeNull();
  expect(weatherToDraw(null, null)).toBeNull();
  expect(weatherToDraw({ kind: "snow" }, null)).toBeNull();
  expect(weatherToDraw("rain", null)).toBeNull();
});

test("following the season, Halloween is cloudy and every other season, or none, is clear", () => {
  expect(SEASON_WEATHER).toEqual({ halloween: { code: 3, temp: null, cloud: 0.9 } });
  expect(weatherToDraw({ kind: "season" }, "halloween")).toEqual({
    code: 3,
    temp: null,
    cloud: 0.9,
  });
  expect(weatherToDraw({ kind: "season" }, "noel")).toBeNull();
  expect(weatherToDraw({ kind: "season" }, "tet")).toBeNull();
  expect(weatherToDraw({ kind: "season" }, null)).toBeNull();
  expect(weatherToDraw({ kind: "season" }, undefined)).toBeNull();
});

test("a reading is drawn as it is, whatever the season", () => {
  expect(weatherToDraw(RAIN, "halloween")).toEqual({ code: 63, temp: 14.2, cloud: 0.9 });
  expect(weatherToDraw(RAIN, null)).toEqual({ code: 63, temp: 14.2, cloud: 0.9 });
});

test("the scene checks a reading again: a code outside 0 to 99 or not whole draws none", () => {
  for (const code of [-1, 100, 3.5, "3", null, NaN]) {
    expect(weatherToDraw({ ...RAIN, code }, null)).toBeNull();
  }
});

test("a temperature that is not a number is unknown; a cloud share is held to 0 to 1", () => {
  expect(weatherToDraw({ ...RAIN, temp: "warm" }, null)).toEqual({
    code: 63,
    temp: null,
    cloud: 0.9,
  });
  expect(weatherToDraw({ ...RAIN, temp: NaN }, null)?.temp).toBeNull();
  expect(weatherToDraw({ ...RAIN, cloud: 2 }, null)?.cloud).toBe(1);
  expect(weatherToDraw({ ...RAIN, cloud: -1 }, null)?.cloud).toBe(0);
  expect(weatherToDraw({ ...RAIN, cloud: "x" }, null)?.cloud).toBe(0);
});

test("the scene is never handed an address or text: only the three numbers come out", () => {
  const drawn = weatherToDraw({ ...RAIN, address: "https://x.test/?k=SECRET", problem: "x" }, null);
  expect(Object.keys(drawn).sort()).toEqual(["cloud", "code", "temp"]);
});
