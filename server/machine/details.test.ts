import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readHostDetails, recordSample, swapReading } from "./details.js";
import type { HostSample } from "../../shared/host-details.js";

test("host details group readable processes, report zero swap and skip missing cache folders", async () => {
  const home = await mkdtemp(join(tmpdir(), "office-host-detail-"));
  try {
    for (const [pid, kb] of [
      ["1", "7"],
      ["2", "9"],
    ]) {
      await mkdir(join(home, pid));
      await writeFile(join(home, pid, "status"), `Name:\tnode\nVmRSS:\t${kb} kB\n`);
    }
    await writeFile(join(home, "meminfo"), "SwapTotal: 0 kB\nSwapFree: 0 kB\n");
    const result = await readHostDetails(home, home, []);
    expect(result.apps).toEqual([{ name: "node", count: 2, bytes: 16 * 1024 }]);
    expect(result.swap).toEqual({ used: 0, total: 0 });
    expect(result.caches).toEqual([]);
    expect(result.disk?.total).toBeGreaterThan(0);
    expect(swapReading("")).toBeNull();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
test("history drops old observations across office visits", () => {
  const history: HostSample[] = [{ at: 0, ram: 100, cpu: 100 }];
  recordSample(history, {
    readAt: new Date(3600000).toISOString(),
    cpuPercent: null,
    memory: { usedBytes: 3, totalBytes: 4 },
    agents: [],
  });
  expect(history).toEqual([{ at: 3600000, ram: 75, cpu: null }]);
});
