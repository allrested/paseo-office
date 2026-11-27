import type { Machine } from "../../shared/contracts.js";
import type { HostDetails, HostSample } from "../../shared/host-details.js";
import {
  cpuPercent,
  readAgentProcesses,
  readCpuTimes,
  readListeners,
  readMemory,
  type CpuTimes,
} from "./proc.js";
import { createMacMachineReader, readMacHostDetails, runCommand, type Run } from "./macos.js";
import { readHostDetails } from "./details.js";
import { buildMachine, type KnownAgent } from "./reading.js";

export interface MachinePorts {
  procRoot: string;
  cgroupRoot: string;
  /** `process.platform`: the readings exist on Linux and macOS ("darwin"). */
  platform: string;
  /** Runs a program on macOS, where the readings are its commands' output; the system's by default. */
  run?: Run;
  now(): number;
  /** The daemon's pid, which the Mac reading keeps out of an agent's processes; this process's by default. */
  daemonPid?: number;
  /** The agents with a runtime: starting, idle, running or in error. */
  liveAgents(): Promise<KnownAgent[]>;
  /** An agent in whatever state; null when this daemon does not know the id. */
  agent(id: string): Promise<KnownAgent | null>;
  /** Whether this host can close an agent's runtime; a reading carries the answer when given. */
  canCloseRuntime?(): boolean;
}

export interface MachineReader {
  /** Null on a host that is neither Linux nor a Mac. */
  read(): Promise<Machine | null>;
}

/** The Host card's System readings: from /proc on Linux, from the system's commands on a Mac. */
export function readDetails(
  ports: Pick<MachinePorts, "platform" | "procRoot" | "run">,
  home: string,
  history: HostSample[],
): Promise<HostDetails> {
  return ports.platform === "darwin"
    ? readMacHostDetails(ports.run ?? runCommand, home, history)
    : readHostDetails(ports.procRoot, home, history);
}

export function createMachineReader(ports: MachinePorts): MachineReader {
  if (ports.platform === "darwin") {
    return createMacMachineReader({
      now: ports.now,
      run: ports.run ?? runCommand,
      liveAgents: ports.liveAgents,
      daemonPid: ports.daemonPid ?? process.pid,
    });
  }
  let cpuBefore: CpuTimes | null = null;
  // An id no agent of this daemon has: asked once, since an agent id is never given out twice.
  const strangers = new Set<string>();

  /** The agents the processes belong to: the live ones, and the others this daemon knows. */
  async function owners(agentIds: ReadonlySet<string>): Promise<KnownAgent[]> {
    const live = await ports.liveAgents();
    const known = new Set(live.map((agent) => agent.id));
    const others: KnownAgent[] = [];
    for (const id of agentIds) {
      if (known.has(id) || strangers.has(id)) continue;
      const agent = await ports.agent(id);
      if (agent === null) strangers.add(id);
      // An agent that got a runtime between the two calls is listed at the next reading.
      else if (agent.status === "closed") others.push(agent);
    }
    return [...live, ...others];
  }

  return {
    async read() {
      if (ports.platform !== "linux") return null;
      const processes = await readAgentProcesses(ports.procRoot);
      const [listeners, memory, cpuNow, agents] = await Promise.all([
        readListeners(
          ports.procRoot,
          processes.map((process) => process.pid),
        ),
        readMemory(ports.procRoot, ports.cgroupRoot),
        readCpuTimes(ports.procRoot),
        owners(new Set(processes.map((process) => process.agentId))),
      ]);
      const percent = cpuPercent(cpuBefore, cpuNow);
      cpuBefore = cpuNow;
      const machine = buildMachine({
        now: ports.now(),
        memory,
        cpuPercent: percent,
        processes,
        listeners,
        agents,
      });
      return ports.canCloseRuntime
        ? { ...machine, canCloseRuntime: ports.canCloseRuntime() }
        : machine;
    },
  };
}
