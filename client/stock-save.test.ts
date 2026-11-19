import { z, type ZodType } from "zod";
import { describe, expect, it } from "vitest";
import { officeDeviceSettings } from "../shared/settings.js";

/**
 * A `save` that does what stock Paseo 0.16 does with the values it is given: the definition's
 * schema, then `z.json()`, and a refusal (false, nothing thrown) when either throws. A key whose
 * value is `undefined` is not JSON, so it is refused here as it is on a device.
 */
export function stockSave(definition: { schema: ZodType }): (values: unknown) => Promise<boolean> {
  return async (values) => {
    try {
      z.json().parse(await definition.schema.parseAsync(values));
      return true;
    } catch {
      return false;
    }
  };
}

describe("stockSave", () => {
  const save = stockSave(officeDeviceSettings);

  it("stores a document whose every key has a value", async () => {
    expect(await save({ threeD: false, view: "list", rungIncidents: {} })).toBe(true);
  });

  it("refuses a key whose value is undefined", async () => {
    expect(
      await save({
        threeD: false,
        view: "list",
        rungIncidents: {},
        lastAgent: undefined,
      }),
    ).toBe(false);
  });

  it("refuses a document the schema refuses", async () => {
    expect(await save({ threeD: "yes" })).toBe(false);
  });
});
