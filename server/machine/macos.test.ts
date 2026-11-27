import { expect, test } from "vitest";
import {
  activityMonitorUsedBytes,
  createMacMachineReader,
  macMemory,
  parseDf,
  parsePs,
  parseSysctl,
  parseTopCpu,
  parseVmStat,
  rankProcessGroups,
  readMacHostDetails,
  type Run,
} from "./macos.js";
import { createMachineReader, readDetails } from "./machine.js";

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

test("a Mac's reading has memory and CPU and no agent, says so, and offers no clean-up", async () => {
  const asked: string[][] = [];
  const reader = createMacMachineReader({
    now: () => NOW,
    run: fakeRun({ sysctl: SYSCTL, vm_stat: vmStat(16384, 280000), top: TOP }, asked),
  });
  expect(await reader.read()).toEqual({
    readAt: "2026-11-27T10:00:00.000Z",
    memory: { usedBytes: 472000 * 16384, totalBytes: 17179869184 },
    cpuPercent: 11,
    agents: [],
    canCloseRuntime: false,
    perAgent: false,
  });
  expect(asked.map((command) => command[0]).toSorted()).toEqual(["sysctl", "top", "vm_stat"]);
});

test("a command that fails leaves its figure unread, not zero", async () => {
  const reader = createMacMachineReader({ now: () => NOW, run: fakeRun({}) });
  const machine = await reader.read();
  expect(machine.memory).toBeNull();
  expect(machine.cpuPercent).toBeNull();
});

test("the machine reader picks the Mac's source on darwin, and neither on another platform", async () => {
  const ports = {
    procRoot: "/nonexistent",
    cgroupRoot: "/nonexistent",
    now: () => NOW,
    liveAgents: async () => {
      throw new Error("a Mac reading asks no agent");
    },
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
