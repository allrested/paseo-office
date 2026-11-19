// Adapted from Paseo Resource Manager. See LICENSE.paseo.
import type { SshHost, SshReading } from "../../shared/ssh.js";
import { parseMeminfo } from "../machine/proc.js";
import type { McpStdioClient } from "./client.js";

type Reader = Pick<McpStdioClient, "listTools" | "callTool">;

// Only aggregate metrics. No client input, process lists, file contents, or config values enter
// this command. Markers delimit the Linux proc and POSIX df output exactly as in Resources.
export const METRICS =
  "echo @@mem; cat /proc/meminfo; echo @@load; cat /proc/loadavg; echo @@cores; nproc; echo @@disk; LC_ALL=C df -Pk";
export const UNAVAILABLE: SshReading = { status: "unavailable", hosts: [] };

function empty(name: string): SshHost {
  return {
    name,
    reachable: false,
    memoryUsedBytes: null,
    memoryTotalBytes: null,
    load1: null,
    load5: null,
    load15: null,
    cores: null,
    diskMount: null,
    diskUsedBytes: null,
    diskTotalBytes: null,
  };
}

function parse(name: string, text: string): SshHost {
  const host = empty(name);
  const sections = new Map<string, string[]>();
  let section: string[] | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (line === "[stderr]" || /^\[(exit |killed by SIG)/.test(line)) break;
    if (/^@@(mem|load|cores|disk)$/.test(line)) {
      section = [];
      sections.set(line, section);
    } else {
      section?.push(line);
    }
  }
  const memory = parseMeminfo((sections.get("@@mem") ?? []).join("\n"));
  if (memory && Number.isSafeInteger(memory.totalBytes) && Number.isSafeInteger(memory.usedBytes)) {
    host.memoryUsedBytes = memory.usedBytes;
    host.memoryTotalBytes = memory.totalBytes;
  }
  const loads = sections.get("@@load")?.[0]?.trim().split(/\s+/).slice(0, 3).map(Number);
  if (loads?.length === 3 && loads.every((value) => Number.isFinite(value) && value >= 0)) {
    [host.load1, host.load5, host.load15] = loads;
  }
  const cores = Number(sections.get("@@cores")?.[0]);
  if (Number.isSafeInteger(cores) && cores > 0) host.cores = cores;
  fullestDisk(host, sections.get("@@disk") ?? []);
  host.reachable = [host.memoryTotalBytes, host.load1, host.cores, host.diskTotalBytes].some(
    (metric) => metric !== null,
  );
  return host;
}

function fullestDisk(host: SshHost, lines: string[]): void {
  let highest = -1;
  for (const row of lines) {
    const [device, total, used, , percent, ...mount] = row.trim().split(/\s+/);
    if (
      !mount.length ||
      !/^\d+%$/.test(percent) ||
      /^(tmpfs|devtmpfs|shm|udev|none|efivarfs)$/.test(device)
    )
      continue;
    const totalBytes = Number(total) * 1024;
    const usedBytes = Number(used) * 1024;
    if (
      !Number.isSafeInteger(totalBytes) ||
      totalBytes <= 0 ||
      !Number.isSafeInteger(usedBytes) ||
      usedBytes < 0
    )
      continue;
    const fraction = usedBytes / totalBytes;
    if (fraction <= highest) continue;
    highest = fraction;
    host.diskMount = mount.join(" ");
    host.diskUsedBytes = usedBytes;
    host.diskTotalBytes = totalBytes;
  }
}

async function readHost(
  client: Reader,
  run: string,
  name: string,
  profile?: string,
): Promise<SshHost> {
  try {
    const result = await client.callTool(
      run,
      profile ? { command: METRICS, profile } : { command: METRICS },
    );
    return parse(name, result.text);
  } catch {
    return empty(name);
  }
}

export async function readSshHosts(client: Reader, name: string): Promise<SshReading> {
  const tools = await client.listTools();
  const run = ["run-command", "exec"].find((tool) => tools.includes(tool));
  if (!run) return UNAVAILABLE;
  if (!tools.includes("list-connections"))
    return { status: "ok", hosts: [await readHost(client, run, name)] };
  const result = await client.callTool("list-connections", {});
  if (result.isError) {
    if (result.text.includes("No config file found and missing required --host/--user."))
      return { status: "ok", hosts: [] };
    return UNAVAILABLE;
  }
  const profiles = new Set<string>();
  for (const line of result.text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const profile = /^(.+?): \S+@\S+:\d+ \[[^\]]*\] sessions=\d+ role=.*$/.exec(line)?.[1];
    if (!profile) return UNAVAILABLE;
    profiles.add(profile);
  }
  // Bound simultaneous SSH connections while retaining the MCP profile order in the card.
  const names = [...profiles];
  const hosts: SshHost[] = [];
  const concurrency = 4;
  for (let start = 0; start < names.length; start += concurrency) {
    const batch = names.slice(start, start + concurrency);
    hosts.push(
      ...(await Promise.all(batch.map((profile) => readHost(client, run, profile, profile)))),
    );
  }
  return { status: "ok", hosts };
}
