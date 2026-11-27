import { expect, test } from "vitest";
import {
  activityMonitorUsedBytes,
  createMacMachineReader,
  lastAgentId,
  macAgentProcesses,
  macMemory,
  parseDf,
  parseLsofListeners,
  parsePs,
  parsePsEnvironment,
  parseSysctl,
  parseTopCpu,
  parseVmStat,
  rankProcessGroups,
  readMacHostDetails,
  type Run,
} from "./macos.js";
import { createMachineReader, readDetails } from "./machine.js";
import type { KnownAgent } from "./reading.js";

const GIB = 1024 ** 3;

const SYSCTL = `17179869184
8
{ 2.35 2.11 1.98 }
total = 2048.00M  used = 1024.50M  free = 1023.50M  (encrypted)
`;

function vmStat(pageSize: number, anonymous: number) {
  return `Mach Virtual Memory Statistics: (page size of ${pageSize} bytes)
Pages free:                               3715.
Pages active:                           200000.
Pages inactive:                         197000.
Pages speculative:                        2500.
Pages throttled:                             0.
Pages wired down:                        96000.
Pages purgeable:                          4000.
"Translation faults":                123456789.
Pages copy-on-write:                   1234567.
Pages zero filled:                    50000000.
Pages reactivated:                      123456.
Pages purged:                           123456.
File-backed pages:                      120000.
Anonymous pages:                  ${String(anonymous).padStart(12)}.
Pages stored in compressor:             300000.
Pages occupied by compressor:           100000.
Decompressions:                         654321.
Compressions:                           987654.
Pageins:                               4567890.
Pageouts:                                 1234.
Swapins:                                     0.
Swapouts:                                    0.
`;
}

const PS = `  PID   RSS COMM
    1  12000 /sbin/launchd
  101   4096 /usr/sbin/cfprefsd
  202 812344 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  203 301212 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/120/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)
  204 200000 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/120/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)
  305      0 (sh)
  306      0 /usr/libexec/kernelmanagerd
  400  50000 /opt/homebrew/bin/node
  401  70000 /opt/homebrew/bin/node

`;

const DF = `Filesystem    1024-blocks      Used Available Capacity iused      ifree %iused  Mounted on
/dev/disk3s5    494384795 400000000  80000000    84% 4000000 800000000    1%   /System/Volumes/Data
`;

const TOP = `Processes: 400 total, 3 running
Load Avg: 2.35, 2.11, 1.98
CPU usage: 30.10% user, 20.20% sys, 49.70% idle
SharedLibs: 100M resident

Processes: 400 total, 2 running
Load Avg: 2.35, 2.11, 1.98
CPU usage: 4.76% user, 6.35% sys, 88.88% idle
`;

test("sysctl gives memory, cores, load and swap, and tolerates a decimal comma", () => {
  expect(parseSysctl(SYSCTL)).toEqual({
    memsize: 17179869184,
    cores: 8,
    load: [2.35, 2.11, 1.98],
    swap: { total: 2048 * 1024 ** 2, used: Math.round(1024.5 * 1024 ** 2) },
  });
  const comma = parseSysctl(
    "8589934592\n4\n{ 1,87 1,95 2,01 }\ntotal = 1,50G  used = 0,25G  free = 1,25G  (encrypted)\n",
  );
  expect(comma?.load).toEqual([1.87, 1.95, 2.01]);
  expect(comma?.swap).toEqual({ total: 1.5 * GIB, used: 0.25 * GIB });
});

test("a sysctl without memory or cores is not a reading; an odd load or swap line is only missing", () => {
  expect(parseSysctl("")).toBeNull();
  expect(parseSysctl("sysctl: unknown oid\n")).toBeNull();
  expect(parseSysctl("1024\n2\n")).toEqual({ memsize: 1024, cores: 2, load: [], swap: null });
});

test("vm_stat's page size is read from the first line, on Intel and on Apple Silicon", () => {
  expect(parseVmStat(vmStat(4096, 1000))?.pageSize).toBe(4096);
  expect(parseVmStat(vmStat(16384, 1000))?.pageSize).toBe(16384);
  expect(parseVmStat(vmStat(16384, 1000))?.pages.get("Translation faults")).toBe(123456789);
  expect(parseVmStat("vm_stat: command not found\n")).toBeNull();
});

test("memory used is app memory plus wired plus compressed, as Activity Monitor counts it", () => {
  const intel = parseVmStat(vmStat(4096, 280000));
  const silicon = parseVmStat(vmStat(16384, 280000));
  // (280000 - 4000 purgeable + 96000 wired + 100000 compressed) pages
  expect(activityMonitorUsedBytes(intel!)).toBe(472000 * 4096);
  expect(activityMonitorUsedBytes(silicon!)).toBe(472000 * 16384);
});

test("memory used never goes below zero, never passes the total, and is unread without anonymous pages", () => {
  const vm = parseVmStat(vmStat(16384, 1000));
  expect(activityMonitorUsedBytes(vm!)).toBe((96000 + 100000) * 16384);
  const sysctl = parseSysctl(SYSCTL)!;
  expect(macMemory(sysctl, vm)).toEqual({ usedBytes: 196000 * 16384, totalBytes: 17179869184 });
  expect(macMemory({ ...sysctl, memsize: 1000 }, vm)?.usedBytes).toBe(1000);
  const noAnonymous = parseVmStat(
    "Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free: 1.\n",
  );
  expect(activityMonitorUsedBytes(noAnonymous!)).toBeNull();
  expect(macMemory(sysctl, noAnonymous)).toBeNull();
  expect(macMemory(null, vm)).toBeNull();
});

test("top's last CPU sample is the one used, with a decimal comma as well", () => {
  expect(parseTopCpu(TOP)).toBe(11);
  expect(parseTopCpu("CPU usage: 4,76% user, 6,35% sys, 88,88% idle\n")).toBe(11);
  expect(parseTopCpu("CPU usage: 0.00% user, 0.00% sys, 100.00% idle\n")).toBe(0);
  expect(parseTopCpu("nothing\n")).toBeNull();
});

test("ps rows keep a program's path whole, spaces and parentheses included, and skip the rest", () => {
  const rows = parsePs(PS);
  expect(rows.map((row) => row.pid)).toEqual([1, 101, 202, 203, 204, 400, 401]);
  expect(rows[0]).toEqual({ pid: 1, rssBytes: 12000 * 1024, name: "launchd" });
  expect(rows[2]?.name).toBe("Google Chrome");
  expect(rows[3]?.name).toBe("Google Chrome Helper (Renderer)");
  expect(parsePs("")).toEqual([]);
});

test("process groups are ranked by memory, then name, and cut to twelve", () => {
  expect(rankProcessGroups(parsePs(PS)).slice(0, 3)).toEqual([
    { name: "Google Chrome", bytes: 812344 * 1024, count: 1 },
    { name: "Google Chrome Helper (Renderer)", bytes: 501212 * 1024, count: 2 },
    { name: "node", bytes: 120000 * 1024, count: 2 },
  ]);
  const many = Array.from({ length: 20 }, (_, i) => ({ pid: i, rssBytes: 1, name: `p${i}` }));
  expect(rankProcessGroups(many)).toHaveLength(12);
});

test("df gives the home filesystem from its last row, whatever the name holds", () => {
  expect(parseDf(DF)).toEqual({ available: 80000000 * 1024, total: 494384795 * 1024 });
  const spaced = `${DF.split("\n")[0]}\n//user@nas/Home Share  1000  400  600  40%  10  20  33%  /Volumes/Home Share\n`;
  expect(parseDf(spaced)).toEqual({ available: 600 * 1024, total: 1000 * 1024 });
  expect(parseDf("df: /nowhere: No such file or directory\n")).toBeNull();
  expect(parseDf(`${DF.split("\n")[0]}\n`)).toBeNull();
});

const NOW = Date.parse("2026-11-27T10:00:00.000Z");

function fakeRun(outputs: Record<string, string | null>, asked: string[][] = []): Run {
  return async (file, args) => {
    asked.push([file, ...args]);
    return outputs[file] ?? null;
  };
}

const NO_AGENTS = async (): Promise<KnownAgent[]> => [];

test("a Mac whose ps shows no environment has memory and CPU and no agent, says so, and offers no clean-up", async () => {
  const asked: string[][] = [];
  const reader = createMacMachineReader({
    now: () => NOW,
    liveAgents: NO_AGENTS,
    daemonPid: 100,
    run: fakeRun({ sysctl: SYSCTL, vm_stat: vmStat(16384, 280000), top: TOP, ps: PS }, asked),
  });
  expect(await reader.read()).toEqual({
    readAt: "2026-11-27T10:00:00.000Z",
    memory: { usedBytes: 472000 * 16384, totalBytes: 17179869184 },
    cpuPercent: 11,
    agents: [],
    canCloseRuntime: false,
    perAgent: false,
  });
  expect(asked.map((command) => command[0]).toSorted()).toEqual([
    "lsof",
    "ps",
    "sysctl",
    "top",
    "vm_stat",
  ]);
});

test("a command that fails leaves its figure unread, not zero", async () => {
  const reader = createMacMachineReader({
    now: () => NOW,
    liveAgents: NO_AGENTS,
    daemonPid: 100,
    run: fakeRun({}),
  });
  const machine = await reader.read();
  expect(machine.memory).toBeNull();
  expect(machine.cpuPercent).toBeNull();
});

test("the machine reader picks the Mac's source on darwin, and neither on another platform", async () => {
  const ports = {
    procRoot: "/nonexistent",
    cgroupRoot: "/nonexistent",
    now: () => NOW,
    liveAgents: NO_AGENTS,
    agent: async () => null,
    run: fakeRun({ sysctl: SYSCTL, vm_stat: vmStat(4096, 280000), top: TOP }),
  };
  const mac = await createMachineReader({ ...ports, platform: "darwin" }).read();
  expect(mac?.perAgent).toBe(false);
  expect(mac?.memory?.usedBytes).toBe(472000 * 4096);
  expect(await createMachineReader({ ...ports, platform: "win32" }).read()).toBeNull();
});

test("a Mac's details have load, swap, disk, the largest groups and the history", async () => {
  const history = [{ at: Date.now() - 60_000, ram: 40, cpu: 10 }];
  const details = await readMacHostDetails(
    fakeRun({ sysctl: SYSCTL, ps: PS, df: DF, du: "2048\t/x\n" }),
    "/Users/me",
    history,
  );
  expect(details.cores).toBe(8);
  expect(details.load).toEqual([2.35, 2.11, 1.98]);
  expect(details.swap?.total).toBe(2048 * 1024 ** 2);
  expect(details.disk).toEqual({ available: 80000000 * 1024, total: 494384795 * 1024 });
  expect(details.apps[0]?.name).toBe("Google Chrome");
  expect(details.caches).toEqual([
    { name: "npm download cache", bytes: 2048 * 1024 },
    { name: "pip download cache", bytes: 2048 * 1024 },
  ]);
  expect(details.history).toEqual(history);
});

test("a command that fails leaves its details unread; load and cores come from node instead", async () => {
  const details = await readMacHostDetails(fakeRun({}), "/Users/me", []);
  expect(details.swap).toBeNull();
  expect(details.disk).toBeNull();
  expect(details.apps).toEqual([]);
  expect(details.caches).toEqual([]);
  expect(details.cores).toBeGreaterThan(0);
  expect(details.load).toHaveLength(3);
});

test("the details come from the Mac's commands on darwin only", async () => {
  const run = fakeRun({ sysctl: SYSCTL, ps: PS, df: DF });
  const darwin = await readDetails(
    { platform: "darwin", procRoot: "/nonexistent", run },
    "/Users/me",
    [],
  );
  expect(darwin.apps[0]?.name).toBe("Google Chrome");
});

// `ps -axEww -o pid=,ppid=,rss=,command=`: arguments, then the environment, on one line.
const ENV = "HOME=/Users/me USER=me PATH=/usr/bin:/bin SHELL=/bin/zsh";
const OLD_ID = "0b1c-agent_old";
const ID_A = "a1b2c3d4-0000-4000-8000-000000000001";
const ID_B = "b1b2c3d4-0000-4000-8000-000000000002";
const ID_GONE = "c1b2c3d4-0000-4000-8000-000000000003";

const PS_E = `  PID  PPID   RSS COMMAND
    1     0  9000 /sbin/launchd
  100     1 80000 /usr/local/bin/node /opt/paseo/daemon.js ${ENV}
  200   100 50000 /usr/local/bin/claude --model x PASEO_AGENT_ID=${ID_A} ${ENV} PASEO_AGENT_ID=${ID_A}
  201   200 30000 /bin/zsh -c node my app.js --flag=a=b PASEO_AGENT_ID=${ID_A} ${ENV}
  202   201 20000 node /Users/me/my project/server.js --title=x PASEO_AGENT_ID=${ID_A} ${ENV}
  300   100 40000 /usr/local/bin/claude PASEO_AGENT_ID=${ID_B} ${ENV}
  301     1 10000 node /tmp/orphan.js PASEO_AGENT_ID=${ID_B} ${ENV}
  400   500  1000 grep PASEO_AGENT_ID=${ID_A} ${ENV}
  500     1  5000 /bin/zsh ${ENV}
  600   200  2000 sh -c echo PASEO_AGENT_ID=fake ${ENV} PASEO_AGENT_ID=${ID_A}
  610   200  3000 node tool.js PASEO_AGENT_ID=${ID_B} ${ENV}
  620   200     0 (defunct-child)
  700     1 60000 /Applications/Other User App.app/Contents/MacOS/App
  710   700  7000 node x PASEO_AGENT_ID=${ID_GONE} ${ENV}
`;

test("the rows of ps -E keep pid, parent and resident memory, and skip the header", () => {
  const rows = parsePsEnvironment(PS_E);
  expect(rows).toHaveLength(14);
  expect(rows[1]).toMatchObject({ pid: 100, ppid: 1, rssBytes: 80000 * 1024 });
  expect(rows.find((row) => row.pid === 620)).toMatchObject({ rssBytes: 0 });
  expect(parsePsEnvironment("garbage\n\n  12  1  5\n")).toEqual([
    { pid: 12, ppid: 1, rssBytes: 5 * 1024, command: "" },
  ]);
});

test("the agent id is the last PASEO_AGENT_ID token, and only one of an id's shape", () => {
  expect(lastAgentId(`node a=b PASEO_AGENT_ID=${ID_A} ${ENV}`)).toBe(ID_A);
  expect(lastAgentId(`node PASEO_AGENT_ID=fake ${ENV} PASEO_AGENT_ID=${ID_B}`)).toBe(ID_B);
  expect(lastAgentId(`node ${ENV} PASEO_AGENT_ID=fake`)).toBe("fake");
  expect(lastAgentId(`node ${ENV}`)).toBeNull();
  expect(lastAgentId(`node XPASEO_AGENT_ID=${ID_A}`)).toBeNull();
  expect(lastAgentId(`node --x=PASEO_AGENT_ID=${ID_A}`)).toBeNull();
  expect(lastAgentId("node PASEO_AGENT_ID=")).toBeNull();
  expect(lastAgentId("node PASEO_AGENT_ID=../../etc")).toBeNull();
  expect(lastAgentId(`node PASEO_AGENT_ID=${"a".repeat(81)}`)).toBeNull();
});

test("a process counts for an agent it descends from, and an argument that names an id counts for nothing", () => {
  const { processes, environmentSeen } = macAgentProcesses(
    parsePsEnvironment(PS_E),
    new Set([ID_A, ID_B]),
    100,
  );
  expect(environmentSeen).toBe(true);
  const byAgent = (id: string) => processes.filter((p) => p.agentId === id).map((p) => p.pid);
  // 200 is started by the daemon; 201 and 202 descend through it; 600's env token is the last.
  expect(byAgent(ID_A)).toEqual([200, 201, 202, 600]);
  // 300 is started by the daemon, 301 was left with launchd; 610 carries B under A's process.
  expect(byAgent(ID_B)).toEqual([300, 301]);
  // The grep names A under a shell, an agent the daemon does not know is ignored, a zombie has none.
  expect(processes.map((p) => p.pid)).not.toContain(400);
  expect(processes.map((p) => p.pid)).not.toContain(710);
  expect(processes.map((p) => p.pid)).not.toContain(620);
  expect(processes.find((p) => p.pid === 202)?.rssBytes).toBe(20000 * 1024);
});

test("the daemon and the processes above it are never an agent's, whatever their environment says", () => {
  const rows = parsePsEnvironment(
    `    1     0  9000 /sbin/launchd
   50     1  9000 /bin/zsh ${ENV} PASEO_AGENT_ID=${ID_A}
  100    50 80000 node daemon.js ${ENV} PASEO_AGENT_ID=${ID_A}
  200   100 50000 claude ${ENV} PASEO_AGENT_ID=${ID_A}
  210    50  1000 node sibling.js ${ENV} PASEO_AGENT_ID=${ID_A}
`,
  );
  expect(
    macAgentProcesses(rows, new Set([ID_A]), 100).processes.map((process) => process.pid),
  ).toEqual([200]);
});

test("a loop in the parent chain and an old-style id are handled without hanging", () => {
  const rows = parsePsEnvironment(
    `  10  11 1000 node ${ENV} PASEO_AGENT_ID=${OLD_ID}
  11  10 1000 node ${ENV} PASEO_AGENT_ID=${OLD_ID}
  12   1 1000 node ${ENV} PASEO_AGENT_ID=${OLD_ID}
`,
  );
  expect(macAgentProcesses(rows, new Set([OLD_ID]), 999).processes.map((p) => p.pid)).toEqual([12]);
});

test("a very long line is read whole, and the environment is not kept in the result", () => {
  const long = `node ${"--flag=a=b ".repeat(20000)} PASEO_AGENT_ID=fake ${ENV} PASEO_AGENT_ID=${ID_A}`;
  const rows = parsePsEnvironment(`  200  100  4000 ${long}\n`);
  const { processes } = macAgentProcesses(rows, new Set([ID_A]), 100);
  expect(processes).toHaveLength(1);
  expect(JSON.stringify(processes)).not.toContain("--flag");
  expect(JSON.stringify(processes)).not.toContain("/Users/me");
});

test("ps that shows no environment is not taken for a breakdown", () => {
  const rows = parsePsEnvironment(PS);
  expect(macAgentProcesses(rows, new Set([ID_A]), 100)).toEqual({
    environmentSeen: false,
    processes: [],
  });
});

const LSOF = `p200
f12
n*:3000
f13
n127.0.0.1:8080
p202
n[::1]:5173
n*:3000
p999
nlocalhost:http
`;

test("lsof gives each process's listening ports", () => {
  expect(parseLsofListeners(LSOF)).toEqual(
    new Map([
      [200, [3000, 8080]],
      [202, [5173, 3000]],
    ]),
  );
  expect(parseLsofListeners("")).toEqual(new Map());
});

const AGENT_A: KnownAgent = { id: ID_A, title: "Build", status: "idle", updatedAt: null };
const AGENT_B: KnownAgent = { id: ID_B, title: null, status: "running", updatedAt: null };

test("a Mac reads memory, process counts and ports by agent, and still offers no clean-up", async () => {
  const reader = createMacMachineReader({
    now: () => NOW,
    liveAgents: async () => [AGENT_A, AGENT_B],
    daemonPid: 100,
    run: fakeRun({
      sysctl: SYSCTL,
      vm_stat: vmStat(16384, 280000),
      top: TOP,
      ps: PS_E,
      lsof: LSOF,
    }),
  });
  const machine = await reader.read();
  expect(machine.perAgent).toBe(true);
  expect(machine.canCloseRuntime).toBe(false);
  expect(machine.agents.map((agent) => agent.agentId)).toEqual([ID_A, ID_B]);
  expect(machine.agents[0]).toMatchObject({
    rssBytes: (50000 + 30000 + 20000 + 2000) * 1024,
    processCount: 4,
    ports: [3000, 5173, 8080],
  });
  expect(machine.agents[1]).toMatchObject({ processCount: 2, ports: [] });
});

test("a Mac whose lsof fails still reads memory by agent, with no ports", async () => {
  const reader = createMacMachineReader({
    now: () => NOW,
    liveAgents: async () => [AGENT_A],
    daemonPid: 100,
    run: fakeRun({ sysctl: SYSCTL, vm_stat: vmStat(16384, 1), top: TOP, ps: PS_E }),
  });
  const machine = await reader.read();
  expect(machine.perAgent).toBe(true);
  expect(machine.agents[0]?.ports).toEqual([]);
});

test("a Mac whose ps fails keeps the card without a breakdown", async () => {
  const reader = createMacMachineReader({
    now: () => NOW,
    liveAgents: async () => [AGENT_A],
    daemonPid: 100,
    run: fakeRun({ sysctl: SYSCTL, vm_stat: vmStat(16384, 1), top: TOP }),
  });
  expect(await reader.read()).toMatchObject({ perAgent: false, agents: [] });
});
