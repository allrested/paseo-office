import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { Paseo } from "../paseo-holder.js";
import { createSshMonitor } from "./monitor.js";
import { METRICS, readSshHosts } from "./read.js";
import { installedLaunch } from "./installed.js";

const temp: string[] = [];
afterEach(async () => {
  await Promise.all(temp.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function directory() {
  const dir = await mkdtemp(join(tmpdir(), "office-ssh-"));
  temp.push(dir);
  return dir;
}
const METRICS_OUTPUT = [
  "@@mem",
  "MemTotal: 200 kB",
  "MemAvailable: 120 kB",
  "@@load",
  "1.2 0.6 0.3 1/23 101",
  "@@cores",
  "4",
  "@@disk",
  "Filesystem 1024-blocks Used Available Capacity Mounted on",
  "tmpfs 1000 990 10 99% /dev/shm",
  "/dev/vda 100 80 20 80% /",
  "/dev/vdb 200 180 20 90% /data",
].join("\n");
test("configured profiles receive only the fixed metrics command and one unreachable host leaves the others visible", async () => {
  const tools = {
    listTools: async () => ["run-command", "list-connections"],
    callTool: vi.fn(async (tool: string, args: Record<string, unknown>) => {
      if (tool === "list-connections")
        return {
          isError: false,
          text: "prod: root@secret.internal:22 [ready] sessions=0 role=read\ntest: user@other:22 [ready] sessions=0 role=read",
        };
      if (args.profile === "test") return { isError: true, text: "private diagnostics" };
      return { isError: false, text: METRICS_OUTPUT };
    }),
  };
  const result = await readSshHosts(tools, "cluster");
  expect(result.status).toBe("ok");
  expect(result.hosts[0]).toEqual({
    name: "prod",
    reachable: true,
    memoryUsedBytes: 81920,
    memoryTotalBytes: 204800,
    load1: 1.2,
    load5: 0.6,
    load15: 0.3,
    cores: 4,
    diskMount: "/data",
    diskUsedBytes: 184320,
    diskTotalBytes: 204800,
  });
  expect(result.hosts[1]).toMatchObject({ name: "test", reachable: false, diskTotalBytes: null });
  expect(JSON.stringify(result)).not.toMatch(/private|secret.internal/);
  expect(tools.callTool.mock.calls).toEqual([
    ["list-connections", {}],
    ["run-command", { command: METRICS, profile: "prod" }],
    ["run-command", { command: METRICS, profile: "test" }],
  ]);
});
test("an unsupported memory reading leaves the other metrics available", async () => {
  const result = await readSshHosts(
    {
      listTools: async () => ["exec"],
      callTool: async () => ({
        isError: false,
        text: METRICS_OUTPUT.replace("MemAvailable: 120 kB", ""),
      }),
    },
    "remote",
  );
  expect(result.hosts[0]).toMatchObject({
    reachable: true,
    cores: 4,
    load1: 1.2,
    diskMount: "/data",
    memoryTotalBytes: null,
  });
});

test("a listed entry's expanded PATH can provide an installed server", async () => {
  const home = await directory();
  const bin = join(home, "private-bin");
  await mkdir(bin);
  await writeFile(join(bin, "ssh-mcp"), "", { mode: 0o755 });
  await writeFile(
    join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: { custom: { command: "ssh-mcp", env: { PATH: "${CUSTOM_BIN}" } } },
    }),
  );
  const monitor = createSshMonitor({ HOME: home, PATH: home, CUSTOM_BIN: bin }, home, "/proc");
  try {
    expect((await monitor.list(workspaceApi(home))).servers).toEqual([
      { id: expect.any(String), name: "custom" },
    ]);
  } finally {
    await monitor.stop();
  }
});

test("an installed server can have zero profiles; refusal and unexpected output are unavailable", async () => {
  for (const [text, isError, status] of [
    ["", false, "ok"],
    ["No config file found and missing required --host/--user.", true, "ok"],
    ["private error", true, "unavailable"],
    ["unexpected response", false, "unavailable"],
  ] as const) {
    const client = {
      listTools: async () => ["list-connections", "run-command"],
      callTool: vi.fn(async () => ({ text, isError })),
    };
    expect(await readSshHosts(client, "entry")).toEqual({ status, hosts: [] });
    expect(client.callTool).toHaveBeenCalledTimes(1);
  }
});
function workspaceApi(dir: string): Paseo {
  return {
    workspaces: {
      list: async () => ({
        entries: [{ projectRootPath: dir }],
        pageInfo: { hasMore: false, nextCursor: null },
      }),
    },
  } as unknown as Paseo;
}
test("discovery skips unavailable launchers, shell code and untrusted projects, even with a package manager present", async () => {
  const home = await directory();
  const project = join(home, "workspace");
  await mkdir(project);
  const env = { PATH: home, HOME: home, PASEO_HOME: home };
  const api = workspaceApi(project);
  const monitor = createSshMonitor(env, home, "/proc");
  await writeFile(join(home, "npx"), "should never run", { mode: 0o755 });
  await writeFile(
    join(home, ".claude.json"),
    JSON.stringify({ mcpServers: { missing: { command: "npx", args: ["-y", "ssh-mcp"] } } }),
  );
  await writeFile(
    join(project, ".mcp.json"),
    JSON.stringify({ mcpServers: { remote: { command: "ssh-mcp" } } }),
  );
  expect(await monitor.list(api)).toEqual({ servers: [], discoveryIncomplete: false });
  expect(await monitor.read(api, "0000000000000000")).toEqual({ status: "unavailable", hosts: [] });
  await writeFile(join(home, "ssh-mcp"), "", { mode: 0o755 });
  await writeFile(join(home, ".claude.json"), "{}");
  expect((await monitor.list(api)).servers).toEqual([]);
  await writeFile(
    join(home, ".claude.json"),
    JSON.stringify({ projects: { [project]: { hasTrustDialogAccepted: true } } }),
  );
  expect((await monitor.list(api)).servers).toEqual([
    { name: "remote", id: expect.stringMatching(/^[a-f0-9]{16}$/) },
  ]);
  expect(
    await installedLaunch(
      "sh",
      ["-c", 'exec npx -y ssh-mcp --config="$HOME/config"; echo other'],
      env,
    ),
  ).toBeNull();
  expect(
    await installedLaunch(
      "sh",
      ["-c", 'exec npx -y ssh-mcp --config="$HOME/.config/ssh-mcp/config.toml"'],
      env,
    ),
  ).toEqual({
    command: join(home, "ssh-mcp"),
    args: ["--config=" + join(home, ".config/ssh-mcp/config.toml")],
  });
  await monitor.stop();
});
test.skipIf(process.platform === "win32")(
  "the handler completes a stdio handshake with an installed ssh-mcp 1.x and never returns its arguments or diagnostics",
  async () => {
    const home = await directory();
    const server = join(home, "ssh-mcp");
    await writeFile(
      server,
      `#!${process.execPath}
    const rl = require('node:readline').createInterface({input:process.stdin});
    rl.on('line',line => {
      const msg=JSON.parse(line); if(!msg.id)return;
      let result;
      if(msg.method==='initialize')result={protocolVersion:'2025-06-18'};
      if(msg.method==='tools/list')result={tools:[{name:'exec'}]};
      if(msg.method==='tools/call')result={content:[{type:'text',text:msg.params.arguments.command===${JSON.stringify(METRICS)}?${JSON.stringify(METRICS_OUTPUT)}:'wrong command'}]};
      console.log(JSON.stringify({jsonrpc:'2.0',id:msg.id,result}));
    });`,
    );
    await chmod(server, 0o755);
    await writeFile(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: { cluster: { command: server, args: ["--password=dummy-secret"] } },
      }),
    );
    const monitor = createSshMonitor({ HOME: home, PATH: home, PASEO_HOME: home }, home, "/proc");
    try {
      const api = workspaceApi(home);
      const { servers } = await monitor.list(api);
      expect(servers).toHaveLength(1);
      expect(await monitor.read(api, servers[0].id)).toMatchObject({
        status: "ok",
        hosts: [{ name: "cluster", reachable: true, cores: 4, diskMount: "/data" }],
      });
    } finally {
      await monitor.stop();
    }
  },
);
