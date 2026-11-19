import { expect, test } from "vitest";
import {
  NEW_BUILD_MS,
  SERVICE_MS,
  createLiftService,
  planService,
  type LiftKept,
} from "./lift-service.js";

test("a restart on the same build is serviced for three minutes", () => {
  expect(planService({ build: "aaa", sticker: null }, "aaa", 1000)).toEqual({
    since: 1000,
    until: 1000 + SERVICE_MS,
    newBuild: false,
    sticker: null,
  });
});

test("the first start ever is not a new build", () => {
  expect(planService(null, "aaa", 0)).toMatchObject({ newBuild: false, until: SERVICE_MS });
});

test("a new build gets five minutes and a sticker put up at the end", () => {
  expect(planService({ build: "aaa", sticker: null }, "bbbbbbbbb", 0)).toMatchObject({
    newBuild: true,
    until: NEW_BUILD_MS,
    sticker: { build: "bbbbbbbbb", version: "bbbbbbb", at: NEW_BUILD_MS },
  });
});

test("a restart on a serviced build still shows its sticker, another build's is gone", () => {
  const sticker = { build: "bbb", version: "bbb", at: 5 };
  expect(planService({ build: "bbb", sticker }, "bbb", 100).sticker).toEqual(sticker);
  expect(planService({ build: "ccc", sticker }, "ccc", 100).sticker).toBeNull();
});

test("the build is kept, and a page is told how long is left, not a time", () => {
  const kept: LiftKept[] = [];
  const service = createLiftService({
    last: null,
    save: (data) => kept.push(data),
    build: "abcdefgh",
    now: 1000,
  });
  expect(kept).toEqual([{ build: "abcdefgh", sticker: null }]);
  expect(service.pub(1000 + 60_000)).toEqual({
    left: SERVICE_MS - 60_000,
    total: SERVICE_MS,
    newBuild: false,
    sticker: null,
  });
  expect(service.pub(1000 + SERVICE_MS + 5).left).toBe(0);
});
