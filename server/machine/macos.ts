// What the office reads from a Mac: the host's memory, CPU, swap, disk, load and largest process
// groups, from the commands macOS ships. A Mac gives an unprivileged process neither another
// process's environment nor its working folder, so no process can be tied to an agent here.
import { execFile } from "node:child_process";
import { availableParallelism, hostname, loadavg } from "node:os";
import { promisify } from "node:util";
import type { Machine } from "../../shared/contracts.js";
import type { HostDetails, HostSample } from "../../shared/host-details.js";
import type { MemoryReading } from "./proc.js";

const exec = promisify(execFile);

const COMMAND_TIMEOUT_MS = 5000;
// Two samples one second apart: top's first sample is the average since boot.
const CPU_TIMEOUT_MS = 8000;
const APP_GROUPS = 12;
const WINDOW = 30 * 60_000;

/** Runs a program with no shell and returns its output; null when it fails or runs out of time. */
export type Run = (
  file: string,
  args: readonly string[],
  timeoutMs?: number,
) => Promise<string | null>;

export const runCommand: Run = async (file, args, timeoutMs = COMMAND_TIMEOUT_MS) => {
  try {
    const { stdout } = await exec(file, [...args], {
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, LC_ALL: "C" },
    });
    return stdout;
  } catch {
    return null;
  }
};

/** A number as a Mac may print it, with a comma for the decimal point in some languages. */
function decimal(text: string): number {
  return Number(text.replace(",", "."));
}

const KIBIBYTE = 1024;
const SWAP_UNITS: Record<string, number> = { K: KIBIBYTE, M: KIBIBYTE ** 2, G: KIBIBYTE ** 3 };

export interface Sysctl {
  memsize: number;
  cores: number;
  load: number[];
  swap: { total: number; used: number } | null;
}

/** The output of `sysctl -n hw.memsize hw.ncpu vm.loadavg vm.swapusage`: one line each, in order. */
export function parseSysctl(text: string): Sysctl | null {
  const [memsize, cores, loadLine, swapLine] = text.split("\n").map((line) => line.trim());
  const memory = Number(memsize);
  const cpus = Number(cores);
  if (!Number.isSafeInteger(memory) || memory <= 0 || !Number.isSafeInteger(cpus) || cpus <= 0) {
    return null;
  }
  const load = /^\{\s*([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s*\}$/.exec(loadLine ?? "");
  const swap = /total = ([\d.,]+)([KMG])\s+used = ([\d.,]+)([KMG])/.exec(swapLine ?? "");
  return {
    memsize: memory,
    cores: cpus,
    load: load ? [load[1], load[2], load[3]].map((value) => decimal(value ?? "")) : [],
    swap: swap
      ? {
          total: Math.round(decimal(swap[1] ?? "") * (SWAP_UNITS[swap[2] ?? ""] ?? 0)),
          used: Math.round(decimal(swap[3] ?? "") * (SWAP_UNITS[swap[4] ?? ""] ?? 0)),
        }
      : null,
  };
}

export interface VmStat {
  pageSize: number;
  /** Page counts by the name vm_stat prints. */
  pages: ReadonlyMap<string, number>;
}

/** The output of `vm_stat`: the page size is in the first line, then "Pages free:   3715.". */
export function parseVmStat(text: string): VmStat | null {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) return null;
  const pages = new Map<string, number>();
  for (const line of text.split("\n")) {
    const match = /^"?([^":]+)"?:\s+(\d+)\.?$/.exec(line.trim());
    if (match) pages.set(match[1] ?? "", Number(match[2]));
  }
  return { pageSize, pages };
}

/**
 * Memory in use as Activity Monitor's "Memory Used" counts it: App Memory (anonymous pages less
 * the purgeable ones) plus wired memory plus what the compressor occupies. File cache is not in
 * use. Null when vm_stat gave no anonymous-page count.
 */
export function activityMonitorUsedBytes(vm: VmStat): number | null {
  const anonymous = vm.pages.get("Anonymous pages");
  if (anonymous === undefined) return null;
  const purgeable = vm.pages.get("Pages purgeable") ?? 0;
  const wired = vm.pages.get("Pages wired down") ?? 0;
  const compressed = vm.pages.get("Pages occupied by compressor") ?? 0;
  const pages = Math.max(0, anonymous - purgeable) + wired + compressed;
  return pages * vm.pageSize;
}

/** Used and total memory from `sysctl` and `vm_stat`; null without both. */
export function macMemory(sysctl: Sysctl | null, vm: VmStat | null): MemoryReading | null {
  const used = vm === null ? null : activityMonitorUsedBytes(vm);
  if (sysctl === null || used === null) return null;
  return { usedBytes: Math.min(used, sysctl.memsize), totalBytes: sysctl.memsize };
}

/** The busy share of the last sample in `top -l 2 -n 0 -s 1`, 0 to 100; null when it has none. */
export function parseTopCpu(text: string): number | null {
  const idles = [...text.matchAll(/^CPU usage:.*?([\d.,]+)% idle/gm)];
  const last = idles.at(-1)?.[1];
  if (last === undefined) return null;
  const idle = decimal(last);
  if (!Number.isFinite(idle)) return null;
  return Math.round(Math.min(100, Math.max(0, 100 - idle)));
}

export interface ProcessRow {
  pid: number;
  rssBytes: number;
  /** The program's file name, never its arguments. */
  name: string;
}

/**
 * The output of `ps -axo pid=,rss=,comm=`: pid, resident KiB and the program's path, which may
 * hold spaces and so comes last. A header, a blank line or a row with no memory (a zombie, shown
 * as "(name)", or a kernel task) is skipped.
 */
export function parsePs(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S.*?)\s*$/.exec(line);
    if (!match) continue;
    const kibibytes = Number(match[2]);
    const name = (match[3] ?? "").slice((match[3] ?? "").lastIndexOf("/") + 1);
    if (kibibytes === 0 || name === "" || name.startsWith("(")) continue;
    rows.push({ pid: Number(match[1]), rssBytes: kibibytes * KIBIBYTE, name });
  }
  return rows;
}

/** The largest groups of processes of one program, by resident memory. */
export function rankProcessGroups(rows: readonly ProcessRow[]): HostDetails["apps"] {
  const groups = new Map<string, HostDetails["apps"][number]>();
  for (const row of rows) {
    const group = groups.get(row.name) ?? { name: row.name, bytes: 0, count: 0 };
    group.bytes += row.rssBytes;
    group.count += 1;
    groups.set(row.name, group);
  }
  return [...groups.values()]
    .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
    .slice(0, APP_GROUPS);
}

/** The home filesystem from `df -k <path>`; the row's name and mount point may hold spaces. */
export function parseDf(text: string): { available: number; total: number } | null {
  const lines = text.trim().split("\n");
  const match = /^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%/.exec(lines.at(-1) ?? "");
  if (lines.length < 2 || !match) return null;
  const total = Number(match[2]) * KIBIBYTE;
  return total > 0 ? { available: Number(match[4]) * KIBIBYTE, total } : null;
}

async function cacheSize(run: Run, name: string, folder: string) {
  const out = await run("du", ["-sk", "--", folder], 2000);
  const kilobytes = out === null ? undefined : /^(\d+)\s/.exec(out)?.[1];
  return kilobytes ? { name, bytes: Number(kilobytes) * KIBIBYTE } : null;
}

/** Why a Mac offers no clean-up: no process can be tied to the agent that started it. */
export const MAC_CLEANUP_REFUSAL =
  "This Mac cannot tell which process an agent started, so the office stops none";

const sysctlArgs = ["-n", "hw.memsize", "hw.ncpu", "vm.loadavg", "vm.swapusage"];

export interface MacReaderPorts {
  now(): number;
  run: Run;
}

/** The host's readings on a Mac. It names no agent: see the top of this file. */
export function createMacMachineReader(ports: MacReaderPorts): { read(): Promise<Machine> } {
  return {
    async read() {
      const [sysctlText, vmText, topText] = await Promise.all([
        ports.run("sysctl", sysctlArgs),
        ports.run("vm_stat", []),
        ports.run("top", ["-l", "2", "-n", "0", "-s", "1"], CPU_TIMEOUT_MS),
      ]);
      return {
        readAt: new Date(ports.now()).toISOString(),
        memory: macMemory(
          sysctlText === null ? null : parseSysctl(sysctlText),
          vmText === null ? null : parseVmStat(vmText),
        ),
        cpuPercent: topText === null ? null : parseTopCpu(topText),
        agents: [],
        canCloseRuntime: false,
        perAgent: false,
      };
    },
  };
}

export async function readMacHostDetails(
  run: Run,
  home: string,
  history: HostSample[],
): Promise<HostDetails> {
  const [sysctlText, psText, dfText, npm, pip] = await Promise.all([
    run("sysctl", sysctlArgs),
    run("ps", ["-axo", "pid=,rss=,comm="]),
    run("df", ["-k", home]),
    cacheSize(run, "npm download cache", `${home}/.npm/_cacache`),
    cacheSize(run, "pip download cache", `${home}/Library/Caches/pip`),
  ]);
  const sysctl = sysctlText === null ? null : parseSysctl(sysctlText);
  const readAt = Date.now();
  return {
    readAt,
    hostname: hostname(),
    cores: sysctl?.cores ?? availableParallelism(),
    load: sysctl?.load.length ? sysctl.load : loadavg(),
    swap: sysctl?.swap ?? null,
    disk: dfText === null ? null : parseDf(dfText),
    apps: psText === null ? [] : rankProcessGroups(parsePs(psText)),
    caches: [npm, pip].filter((row) => row !== null),
    history: history.filter((row) => row.at >= readAt - WINDOW),
  };
}
