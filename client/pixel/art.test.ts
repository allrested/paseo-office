import { expect, test } from "vitest";
import { artFor, lookOf, type Pose } from "./art.js";

test("changing character gender redraws the same agent while keeping its colors", () => {
  const art = artFor(false);
  const original = lookOf("agent");
  const male = lookOf("agent", { gender: "Male" });
  const female = lookOf("agent", { gender: "Female" });
  expect(male).toEqual({ ...original, gender: "Male" });
  expect(female).toEqual({ ...original, gender: "Female" });
  for (const pose of ["front", "back", "seated"] satisfies Pose[]) {
    expect(art.person(male, pose)).not.toEqual(art.person(female, pose));
    expect(art.person(lookOf("agent", {}), pose)).toBe(art.person(original, pose));
  }
});
