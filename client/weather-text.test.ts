import { expect, test, vi } from "vitest";
import { weatherEntry, weatherStatus } from "./weather-text.js";
test("weather failures open settings, successful readings describe the sky", () => {
  const onOpen = vi.fn();
  weatherEntry({ scene: { kind: "season" }, problem: "Failed", readAt: null }, onOpen)?.onOpen();
  expect(onOpen).toHaveBeenCalledOnce();
  expect(
    weatherStatus({
      mode: "service",
      address: "https://weather.test",
      now: 100,
      state: {
        scene: { kind: "reading", code: 63, temp: 14.2, cloud: 1 },
        readAt: 100,
        problem: null,
      },
    }),
  ).toBe("Last answer just now: rain, 14°.");
});
