// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
// @ts-expect-error vendored JavaScript has no declarations
import { signImage, SIGNS } from "../../vendor/my-office/src/office/world/backdrops/paseo-signs.js";

test("every shop and vehicle sign is drawn on a reusable canvas", () => {
  const drawn: string[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillRect() {},
    measureText: (name: string) => ({ width: name.length * 14 }),
    fillText: (name: string) => drawn.push(name),
  } as unknown as CanvasRenderingContext2D);
  const dir = "../../vendor/my-office/src/office/world/backdrops/";
  const shops = readFileSync(new URL(dir + "shops.js", import.meta.url), "utf8");
  const vehicles = readFileSync(new URL(dir + "street-life.js", import.meta.url), "utf8");
  const files = [
    ...shops.matchAll(/logo: '([^']+)'/g),
    ...vehicles.matchAll(/brandImage\('([^']+)'/g),
  ].map((match) => match[1]);
  expect(new Set(files)).toEqual(new Set(Object.keys(SIGNS)));
  for (const file of files) {
    const sign = signImage(file);
    expect(sign.naturalWidth).toBe(sign.width);
    expect(sign.complete).toBe(true);
    expect(signImage(file)).toBe(sign);
    expect(drawn).toContain(SIGNS[file].text);
  }
  expect(signImage("unknown.svg").naturalWidth).toBeGreaterThan(0);
});
