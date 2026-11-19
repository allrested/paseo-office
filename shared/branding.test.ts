import { expect, test } from "vitest";
import { hostBrand } from "./branding.js";
import { officeHostSettings } from "./settings.js";

test("saved values and host defaults resolve independently", () => {
  const env = {
    PASEO_BRAND_NAME: " Example Studio ",
    PASEO_BRAND_COLOR: "#aabbcc",
    PASEO_BRAND_LOGO_URL: "https://assets.example.org/mark.png",
    UNRELATED_VALUE: "private",
  };
  expect(hostBrand({ brandName: "", brandColor: "#123456" }, env)).toEqual({
    name: "Example Studio",
    color: "#123456",
    logoUrl: env.PASEO_BRAND_LOGO_URL,
  });
  expect(hostBrand({}, { PASEO_BRAND_COLOR: "invalid" })).toBeUndefined();
});

test("invalid saved fields are refused and empty values can restore host defaults", () => {
  for (const values of [
    { brandName: "one\ntwo" },
    { brandName: "a".repeat(65) },
    { brandColor: "red" },
    { brandLogoUrl: "javascript:void(0)" },
    { brandLogoUrl: "https://reader:password@example.org/logo" },
  ])
    expect(officeHostSettings.schema.safeParse(values).success).toBe(false);
  expect(
    officeHostSettings.schema.safeParse({ brandName: "", brandLogoUrl: "", brandColor: "" })
      .success,
  ).toBe(true);
});
