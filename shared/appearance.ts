import { z } from "zod";

export const APPEARANCE_KEY = "office.appearance";
export const COLORS = ["Red", "Orange", "Green", "Teal", "Blue", "Violet", "Pink", "Gold"] as const;
export const GENDERS = ["Male", "Female"] as const;
export const AVATARS = { glasses: "👓", headphones: "🎧", cap: "🧢", beanie: "🧶" } as const;
export const AppearanceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[^\r\n]+$/)
    .optional(),
  gender: z.enum(GENDERS).optional(),
  avatar: z.enum(["glasses", "headphones", "cap", "beanie"]).optional(),
  color: z.enum(COLORS).optional(),
});
export type Appearance = z.output<typeof AppearanceSchema>;
/** Omit automatic choices from the persisted Office profile. */
export function savedAppearance(draft?: Appearance): Appearance | null {
  const profile: Appearance = {};
  const name = draft?.name?.trim();
  if (name) profile.name = name;
  if (draft?.gender) profile.gender = draft.gender;
  if (draft?.avatar) profile.avatar = draft.avatar;
  if (draft?.color) profile.color = draft.color;
  return Object.keys(profile).length ? profile : null;
}
/** Floor colors with a day and night contrast of at least 3.2:1. */
export const SHIRTS = [
  { shirt: "#DA494E", shade: "#B63D41" },
  { shirt: "#B76724", shade: "#98561E" },
  { shirt: "#2A8D58", shade: "#237549" },
  { shirt: "#208892", shade: "#1B7179" },
  { shirt: "#3D7AD8", shade: "#3366B4" },
  { shirt: "#8265E8", shade: "#6C55C1" },
  { shirt: "#C15499", shade: "#A1467F" },
  { shirt: "#8C7C2D", shade: "#746625" },
] as const;
export function shirtColor(appearance?: Appearance) {
  return appearance?.color ? SHIRTS[COLORS.indexOf(appearance.color)].shirt : undefined;
}
