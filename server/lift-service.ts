// The lift's servicing after the office's server starts (the scene's life/lift-service.js draws it): three
// minutes, five when the server starts on a build of the scene it has not run before, with an inspection
// sticker kept with that build. A port of upstream's server/lift-service.mjs (my-office); the build is the
// scene's script's, and the last one is kept in office/lift.json.

import { z } from "zod";

export const SERVICE_MS = 180_000;
export const NEW_BUILD_MS = 300_000;

const LiftStickerSchema = z.object({ build: z.string(), version: z.string(), at: z.number() });
export type LiftSticker = z.output<typeof LiftStickerSchema>;
/** office/lift.json: the build last serviced, and its sticker. */
export const LiftKeptSchema = z.object({
  build: z.string(),
  sticker: LiftStickerSchema.nullable(),
});
export type LiftKept = z.output<typeof LiftKeptSchema>;
export interface LiftPlan {
  since: number;
  until: number;
  newBuild: boolean;
  sticker: LiftSticker | null;
}

/** What this start means, from what was kept last time. The first start ever is not a new build. */
export function planService(last: LiftKept | null, build: string, now: number): LiftPlan {
  const newBuild = build !== "" && last !== null && last.build !== "" && last.build !== build;
  const until = now + (newBuild ? NEW_BUILD_MS : SERVICE_MS);
  let sticker: LiftSticker | null = null;
  if (newBuild) sticker = { build, version: build.slice(0, 7), at: until };
  else if (build !== "" && last?.sticker?.build === build) sticker = last.sticker;
  return { since: now, until, newBuild, sticker };
}

/** What a page is told of the servicing (the scene's setLiftService). */
export interface LiftInfo {
  /** Milliseconds still to go; 0 when done. */
  left: number;
  total: number;
  newBuild: boolean;
  sticker: { version: string; at: number; build: string } | null;
}

export interface LiftService {
  plan: LiftPlan;
  /** What a page is told: how long is left, not a time, so a phone's clock need not agree. */
  pub(at: number): LiftInfo;
}

export function createLiftService(deps: {
  last: LiftKept | null;
  save(kept: LiftKept): void;
  build: string;
  now: number;
}): LiftService {
  const plan = planService(deps.last, deps.build, deps.now);
  deps.save({ build: deps.build || deps.last?.build || "", sticker: plan.sticker });
  return {
    plan,
    pub: (at) => ({
      left: Math.max(0, plan.until - at),
      total: plan.until - plan.since,
      newBuild: plan.newBuild,
      sticker:
        plan.sticker === null
          ? null
          : {
              version: plan.sticker.version,
              at: plan.sticker.at,
              build: plan.sticker.build.slice(0, 7),
            },
    }),
  };
}
