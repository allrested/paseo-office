import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const size = z.object({ used: z.number(), total: z.number() });
const processGroup = z.object({ name: z.string(), bytes: z.number(), count: z.number() });
const sample = z.object({ at: z.number(), ram: z.number().nullable(), cpu: z.number().nullable() });
const details = z.object({
  readAt: z.number(),
  hostname: z.string(),
  cores: z.number(),
  load: z.array(z.number()),
  swap: size.nullable(),
  disk: z.object({ available: z.number(), total: z.number() }).nullable(),
  apps: z.array(processGroup),
  caches: z.array(z.object({ name: z.string(), bytes: z.number() })),
  history: z.array(sample),
});

export type HostDetails = z.output<typeof details>;
export type HostSample = z.output<typeof sample>;
export const hostDetailsRpc = defineRpc({
  name: "office.machine.details",
  input: z.strictObject({}),
  output: details,
});
