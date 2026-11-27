// What the office reads from a Mac: the host's memory, CPU, swap, disk, load, largest process
// groups and the processes of each agent, from the commands macOS ships. An agent's processes are
// found by the PASEO_AGENT_ID that `ps -E` prints after the arguments of the user's own processes.
import { execFile } from "node:child_process";
import { availableParallelism, hostname, loadavg } from "node:os";
import { promisify } from "node:util";
import type { Machine } from "../../shared/contracts.js";
import type { HostDetails, HostSample } from "../../shared/host-details.js";
import type { AgentProcess, MemoryReading } from "./proc.js";
import { buildMachine, type KnownAgent } from "./reading.js";

const exec = promisify(execFile);

const COMMAND_TIMEOUT_MS = 5000;
// Two samples one second apart: top's first sample is the average since boot.
const CPU_TIMEOUT_MS = 8000;
// Every process with its environment on one line: a busy Mac's output is several megabytes.
const ENVIRONMENT_MAX_BUFFER = 128 * 1024 * 1024;
const APP_GROUPS = 12;
const WINDOW = 30 * 60_000;

/** Runs a program with no shell and returns its output; null when it fails or runs out of time. */
export type Run = (
  file: string,
  args: readonly string[],
  timeoutMs?: number,
  maxBuffer?: number,
) => Promise<string | null>;

export const runCommand: Run = async (
  file,
  args,
  timeoutMs = COMMAND_TIMEOUT_MS,
  maxBuffer = 8 * 1024 * 1024,
) => {
  try {
    const { stdout } = await exec(file, [...args], {
      timeout: timeoutMs,
      maxBuffer,
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

/** Why a Mac offers no clean-up: its readings have not yet been seen on a Mac. */
export const MAC_CLEANUP_REFUSAL =
  "The office does not stop processes on a Mac until its readings have been seen there";

const sysctlArgs = ["-n", "hw.memsize", "hw.ncpu", "vm.loadavg", "vm.swapusage"];
const environmentArgs = ["-axEww", "-o", "pid=,ppid=,rss=,command="];
const listenerArgs = ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"];

/** One row of `ps -axEww -o pid=,ppid=,rss=,command=`: the command is the arguments, then the environment. */
export interface EnvironmentRow {
  pid: number;
  ppid: number;
  rssBytes: number;
  /** Never shown or kept: only searched for the agent's id. */
  command: string;
}

/** The rows of the `ps -E` output. A header, a blank line or a malformed row is skipped. */
export function parsePsEnvironment(text: string): EnvironmentRow[] {
  const rows: EnvironmentRow[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)(?:\s+(.*))?$/.exec(line);
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssBytes: Number(match[3]) * KIBIBYTE,
      command: match[4] ?? "",
    });
  }
  return rows;
}

const AGENT_ID_TOKEN = /(?:^|\s)PASEO_AGENT_ID=(\S+)/g;
const AGENT_ID_FORMAT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
// Set in the environment of nearly every user process: a sign that `ps -E` showed environments.
const ENVIRONMENT_SIGN = /(?:^|\s)(?:PATH|HOME|USER)=\S/;

/**
 * The agent id in a command line with its environment. The environment follows the arguments, so
 * the last token is the process's own; an argument that merely says "PASEO_AGENT_ID=x" comes
 * before it and cannot override it. Null without a token or when the value is not an id's shape.
 */
export function lastAgentId(command: string): string | null {
  let value: string | null = null;
  for (const match of command.matchAll(AGENT_ID_TOKEN)) value = match[1] ?? null;
  return value !== null && AGENT_ID_FORMAT.test(value) ? value : null;
}

export interface MacAgentProcesses {
  /** Whether `ps -E` showed any process's environment: false when the flag did nothing. */
  environmentSeen: boolean;
  processes: AgentProcess[];
}

/**
 * The processes of the given agents. A row counts when its last PASEO_AGENT_ID token names a
 * known agent AND its parent chain is genuine: its parent is an accepted process of the same
 * agent (a child inherits the environment), or it is the top of a chain, started by the daemon
 * (`daemonPid`) or left behind with launchd (pid 1). A command line that only contains the text
 * has, as its parent, a shell or another program that carries no id, so it is dropped. The daemon
 * and the processes above it are never counted: they may have been started from an agent's shell.
 */
export function macAgentProcesses(
  rows: readonly EnvironmentRow[],
  knownIds: ReadonlySet<string>,
  daemonPid: number,
): MacAgentProcesses {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const claimed = new Map<number, string>();
  for (const row of rows) {
    const id = lastAgentId(row.command);
    if (id !== null && knownIds.has(id)) claimed.set(row.pid, id);
  }
  const barred = new Set<number>([daemonPid]);
  for (let row = byPid.get(daemonPid); row !== undefined && !barred.has(row.ppid); ) {
    barred.add(row.ppid);
    row = byPid.get(row.ppid);
  }

  const verdict = new Map<number, boolean>();
  function genuine(pid: number): boolean {
    const known = verdict.get(pid);
    if (known !== undefined) return known;
    verdict.set(pid, false); // a loop in the parent chain is never genuine
    const row = byPid.get(pid);
    const id = claimed.get(pid);
    let ok = false;
    if (row !== undefined && id !== undefined && !barred.has(pid)) {
      ok =
        row.ppid === daemonPid ||
        row.ppid === 1 ||
        (claimed.get(row.ppid) === id && genuine(row.ppid));
    }
    verdict.set(pid, ok);
    return ok;
  }

  const processes: AgentProcess[] = [];
  for (const row of rows) {
    const agentId = claimed.get(row.pid);
    if (agentId === undefined || !genuine(row.pid)) continue;
    // No start time or name is read: nothing signals a process on a Mac.
    processes.push({
      pid: row.pid,
      startTime: 0,
      ppid: row.ppid,
      agentId,
      name: "",
      rssBytes: row.rssBytes,
    });
  }
  return { environmentSeen: rows.some((row) => ENVIRONMENT_SIGN.test(row.command)), processes };
}

/**
 * The TCP ports each process listens on, from `lsof -nP -iTCP -sTCP:LISTEN -Fpn`: a "p<pid>" line
 * names a process and each "n<address>:<port>" line after it one of its listening sockets.
 */
export function parseLsofListeners(text: string): Map<number, number[]> {
  const listeners = new Map<number, number[]>();
  let pid: number | null = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) {
      const next = Number(line.slice(1));
      pid = Number.isSafeInteger(next) ? next : null;
    } else if (line.startsWith("n") && pid !== null) {
      const port = /:(\d{1,5})$/.exec(line)?.[1];
      if (port === undefined) continue;
      const ports = listeners.get(pid) ?? [];
      ports.push(Number(port));
      listeners.set(pid, ports);
    }
  }
  return listeners;
}

export interface MacReaderPorts {
  now(): number;
  run: Run;
  /** The agents with a runtime: only these are counted. */
  liveAgents(): Promise<KnownAgent[]>;
  /** This daemon's pid. */
  daemonPid: number;
}

/**
 * The host's readings on a Mac. Without an environment in the `ps -E` output the card keeps no
 * breakdown by agent (`perAgent: false`). It never offers clean-up: see MAC_CLEANUP_REFUSAL.
 */
export function createMacMachineReader(ports: MacReaderPorts): { read(): Promise<Machine> } {
  return {
    async read() {
      const [sysctlText, vmText, topText, psText, lsofText, live] = await Promise.all([
        ports.run("sysctl", sysctlArgs),
        ports.run("vm_stat", []),
        ports.run("top", ["-l", "2", "-n", "0", "-s", "1"], CPU_TIMEOUT_MS),
        ports.run("ps", environmentArgs, CPU_TIMEOUT_MS, ENVIRONMENT_MAX_BUFFER),
        ports.run("lsof", listenerArgs, CPU_TIMEOUT_MS, ENVIRONMENT_MAX_BUFFER),
        ports.liveAgents(),
      ]);
      const memory = macMemory(
        sysctlText === null ? null : parseSysctl(sysctlText),
        vmText === null ? null : parseVmStat(vmText),
      );
      const cpuPercent = topText === null ? null : parseTopCpu(topText);
      const found =
        psText === null
          ? null
          : macAgentProcesses(
              parsePsEnvironment(psText),
              new Set(live.map((agent) => agent.id)),
              ports.daemonPid,
            );
      if (found === null || !found.environmentSeen) {
        return {
          readAt: new Date(ports.now()).toISOString(),
          memory,
          cpuPercent,
          agents: [],
          canCloseRuntime: false,
          perAgent: false,
        };
      }
      return {
        ...buildMachine({
          now: ports.now(),
          memory,
          cpuPercent,
          processes: found.processes,
          // Without lsof no port is known: an idle agent is then not marked as left running.
          listeners: lsofText === null ? new Map() : parseLsofListeners(lsofText),
          agents: live,
        }),
        canCloseRuntime: false,
        perAgent: true,
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
