import { expect, test } from "vitest";
import { NEW_BUILD_MS, SERVICE_MS, createLiftService, planService } from "./lift-service.js";

test("a restart on the same build is serviced for three minutes", () => {
  expect(planService({ build: "aaa", sticker: null }, "aaa", 1000)).toMatchObject({
    until: 1000 + SERVICE_MS,
    newBuild: false,
    sticker: null,
  });
});
test("the first start ever is not a new build", () => {
  expect(planService(null, "aaa", 0)).toMatchObject({ newBuild: false, until: SERVICE_MS });
});
test("a new build gets five minutes and a sticker put up at the end", () => {
  const plan = planService({ build: "aaa", sticker: null }, "bbb", 0);
  expect(plan).toMatchObject({
    newBuild: true,
    until: NEW_BUILD_MS,
    sticker: { build: "bbb", at: NEW_BUILD_MS },
  });
});
test("a restart on a serviced build still shows its sticker", () => {
  const sticker = { build: "bbb", version: "bbb", at: 5 };
  expect(planService({ build: "bbb", sticker }, "bbb", 100).sticker).toEqual(sticker);
});
test("the page is told how long is left, not a time", () => {
  const kept: unknown[] = [];
  const service = createLiftService({
    load: () => null,
    save: (d) => kept.push(d),
    build: "abcdefgh",
    now: 1000,
  });
  expect(service.pub(1000 + 60_000)).toMatchObject({
    left: SERVICE_MS - 60_000,
    total: SERVICE_MS,
    newBuild: false,
  });
  expect(service.pub(1000 + SERVICE_MS + 5).left).toBe(0);
  expect(kept).toHaveLength(1);
});
