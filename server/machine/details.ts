import { execFile } from "node:child_process";
import { readFile, readdir, statfs } from "node:fs/promises";
import { availableParallelism, hostname, loadavg } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { HostDetails, HostSample } from "../../shared/host-details.js";
import type { Machine } from "../../shared/contracts.js";
import { memoryPercent } from "../../shared/machine-text.js";

const exec = promisify(execFile);
const WINDOW = 30 * 60_000;

export function recordSample(history: HostSample[], machine: Machine) {
  const at = Date.parse(machine.readAt);
  while (history.length && (history[0].at < at - WINDOW || history.length >= 180)) history.shift();
  history.push({ at, ram: memoryPercent(machine), cpu: machine.cpuPercent });
}

export function swapReading(text: string) {
  const total = /^SwapTotal:\s+(\d+) kB$/m.exec(text);
  const free = /^SwapFree:\s+(\d+) kB$/m.exec(text);
  if (!total || !free) return null;
  return {
    total: Number(total[1]) * 1024,
    used: Math.max(0, Number(total[1]) - Number(free[1])) * 1024,
  };
}

async function rankedApps(root: string): Promise<HostDetails["apps"]> {
  const names = (await readdir(root)).filter((name) => /^\d+$/.test(name));
  const groups = new Map<string, HostDetails["apps"][number]>();
  for (let first = 0; first < names.length; first += 32) {
    const statuses = await Promise.all(
      names
        .slice(first, first + 32)
        .map((pid) => readFile(join(root, pid, "status"), "utf8").catch(() => "")),
    );
    for (const status of statuses) {
      const name = /^Name:\s*([^\n]+)/m.exec(status)?.[1].trim();
      const kb = /^VmRSS:\s+(\d+) kB$/m.exec(status)?.[1];
      if (!name || !kb || Number(kb) === 0) continue;
      const group = groups.get(name) ?? { name, bytes: 0, count: 0 };
      group.bytes += Number(kb) * 1024;
      group.count += 1;
      groups.set(name, group);
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
    .slice(0, 12);
}

// Only fixed cache directories are measured. A missing cache or a slow filesystem can be skipped.
async function cacheSize(name: string, folder: string) {
  try {
    const { stdout } = await exec("du", ["-skx", "--", folder], { timeout: 2000, maxBuffer: 4096 });
    const kb = /^(\d+)\s/.exec(stdout)?.[1];
    return kb ? { name, bytes: Number(kb) * 1024 } : null;
  } catch {
    return null;
  }
}

export async function readHostDetails(
  procRoot: string,
  home: string,
  history: HostSample[],
): Promise<HostDetails> {
  const [apps, memory, fs, caches] = await Promise.all([
    rankedApps(procRoot),
    readFile(join(procRoot, "meminfo"), "utf8").catch(() => ""),
    statfs(home).catch(() => null),
    Promise.all([
      cacheSize("npm download cache", join(home, ".npm", "_cacache")),
      cacheSize("pip download cache", join(home, ".cache", "pip")),
    ]),
  ]);
  const readAt = Date.now();
  return {
    readAt,
    hostname: hostname(),
    cores: availableParallelism(),
    load: loadavg(),
    swap: swapReading(memory),
    disk:
      fs && fs.blocks > 0 ? { available: fs.bavail * fs.bsize, total: fs.blocks * fs.bsize } : null,
    apps,
    caches: caches.filter((row) => row !== null),
    history: history.filter((row) => row.at >= readAt - WINDOW),
  };
}
