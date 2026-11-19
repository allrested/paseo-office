import { z } from "zod";

const name = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[^\r\n]+$/, "Use a single-line name");
const color = z
  .string()
  .trim()
  .regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex color, such as #e8865f");
const logoUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "Enter an HTTPS image URL without credentials");

export const BrandingSchema = z.object({
  name: name.optional(),
  color: color.optional(),
  logoUrl: logoUrl.optional(),
});
export type Branding = z.output<typeof BrandingSchema>;
export const brandFields = {
  brandName: name.or(z.literal("")).optional(),
  brandColor: color.or(z.literal("")).optional(),
  brandLogoUrl: logoUrl.or(z.literal("")).optional(),
};

/** Resolve each field independently; publish only the three validated display values. */
export function hostBrand(
  values: { brandName?: string; brandColor?: string; brandLogoUrl?: string },
  env: Record<string, string | undefined>,
): Branding | undefined {
  const result: Branding = {};
  for (const [field, override, fallback] of [
    ["name", values.brandName, env.PASEO_BRAND_NAME],
    ["color", values.brandColor, env.PASEO_BRAND_COLOR],
    ["logoUrl", values.brandLogoUrl, env.PASEO_BRAND_LOGO_URL],
  ] as const) {
    const value = BrandingSchema.shape[field].safeParse(override || fallback);
    if (value.success && value.data) result[field] = value.data;
  }
  return Object.keys(result).length ? result : undefined;
}
