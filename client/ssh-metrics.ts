import type { SshHost } from "../shared/ssh.js";
import { formatBytes } from "../shared/machine-text.js";

export type MetricTone = "ok" | "warning" | "critical";

function percent(used: number | null, total: number | null): number | null {
  return used !== null && total !== null && total > 0 ? (used / total) * 100 : null;
}

function metric(
  label: string,
  value: number | null,
  note: string | null,
  warning: number,
  critical: number,
) {
  let tone: MetricTone = "ok";
  if (value !== null && value >= critical) tone = "critical";
  else if (value !== null && value >= warning) tone = "warning";
  const amount = value === null ? null : `${Math.round(value)}%`;
  return {
    label,
    value,
    tone,
    text: amount === null ? "Unavailable" : [amount, note].filter(Boolean).join(" · "),
  };
}

export function summarizeHost(host: SshHost) {
  const {
    cores,
    load1,
    memoryUsedBytes,
    memoryTotalBytes,
    diskMount,
    diskUsedBytes,
    diskTotalBytes,
  } = host;
  const memory = metric(
    "Memory",
    percent(memoryUsedBytes, memoryTotalBytes),
    memoryUsedBytes === null ? null : formatBytes(memoryUsedBytes),
    80,
    90,
  );
  const load = metric(
    "Load",
    percent(load1, cores),
    cores === null ? null : `${cores} ${cores === 1 ? "core" : "cores"}`,
    100,
    200,
  );
  const disk = metric("Disk", percent(diskUsedBytes, diskTotalBytes), diskMount, 85, 95);
  const meters = [memory, load, disk];
  let status: "Unreachable" | "Critical" | "Warning" | "Partial" | "OK" = "OK";
  if (!host.reachable) status = "Unreachable";
  else if (meters.some((each) => each.tone === "critical")) status = "Critical";
  else if (meters.some((each) => each.tone === "warning")) status = "Warning";
  else if (meters.some((each) => each.value === null)) status = "Partial";
  return { host, meters, status };
}

export type HostSummary = ReturnType<typeof summarizeHost>;
export type RemoteMeter = HostSummary["meters"][number];
export const STATUS_ORDER: Record<HostSummary["status"], number> = {
  Unreachable: 0,
  Critical: 1,
  Warning: 2,
  Partial: 3,
  OK: 4,
};

export function usedOf(used: number | null, total: number | null): string {
  if (used === null || total === null) return "Unavailable";
  return `${formatBytes(used)} of ${formatBytes(total)}`;
}
