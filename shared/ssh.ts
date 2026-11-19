import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const host = z.object({
  name: z.string(),
  reachable: z.boolean(),
  memoryUsedBytes: z.number().nullable(),
  memoryTotalBytes: z.number().nullable(),
  load1: z.number().nullable(),
  load5: z.number().nullable(),
  load15: z.number().nullable(),
  cores: z.number().nullable(),
  diskMount: z.string().nullable(),
  diskUsedBytes: z.number().nullable(),
  diskTotalBytes: z.number().nullable(),
});
const reading = z.object({ status: z.enum(["ok", "unavailable"]), hosts: z.array(host) });
const servers = z.object({
  servers: z.array(z.object({ id: z.string(), name: z.string() })),
  discoveryIncomplete: z.boolean(),
});
export type SshHost = z.output<typeof host>;
export type SshReading = z.output<typeof reading>;
export type SshDiscovery = z.output<typeof servers>;
export const sshServersRpc = defineRpc({
  name: "office.ssh.servers",
  input: z.strictObject({}),
  output: servers,
});
export const sshReadingRpc = defineRpc({
  name: "office.ssh.reading",
  input: z.strictObject({ id: z.string().regex(/^[0-9a-f]{16}$/) }),
  output: reading,
});
