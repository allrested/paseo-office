import { z } from "zod";
import type { LifeEvent } from "../shared/contracts.js";
export const SERVICE_MS = 180_000;
export const NEW_BUILD_MS = 300_000;
const saved = z.object({
  build: z.string(),
  sticker: z.object({ build: z.string(), version: z.string(), at: z.number() }).nullable(),
});
export function planService(last: z.infer<typeof saved> | null, build: string, now: number) {
  const newBuild = Boolean(build && last?.build && last.build !== build);
  const until = now + (newBuild ? NEW_BUILD_MS : SERVICE_MS);
  let sticker = last?.sticker?.build === build ? last.sticker : null;
  if (newBuild) sticker = { build, version: build.slice(0, 7), at: until };
  return { since: now, until, newBuild, sticker };
}
export function createLiftService(deps: {
  load(): unknown;
  save(data: unknown): void;
  build: string;
  now: number;
}) {
  const last = saved.safeParse(deps.load()).data ?? null;
  const plan = planService(last, deps.build, deps.now);
  deps.save({ build: deps.build || last?.build || "", sticker: plan.sticker });
  return {
    plan,
    pub(now: number): LifeEvent["lift"] {
      return {
        left: Math.max(0, plan.until - now),
        total: plan.until - plan.since,
        newBuild: plan.newBuild,
        sticker: plan.sticker && { ...plan.sticker, build: plan.sticker.build.slice(0, 7) },
      };
    },
  };
}
