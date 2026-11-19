import { join } from "node:path";
import type { SshDiscovery, SshReading } from "../../shared/ssh.js";
import type { Paseo } from "../paseo-holder.js";
import { officeDir, claudeConfigFile } from "../paths.js";
import { startMcpStdioClient, serverEnv } from "./client.js";
import { discoverSshServers, type SshServer } from "./discovery.js";
import { listPidFiles, reclaimPidFile } from "./pid-files.js";
import { readSshHosts, UNAVAILABLE } from "./read.js";

export function createSshMonitor(env: NodeJS.ProcessEnv, home: string, procRoot: string) {
  const runDir = join(officeDir(env, home), "ssh-run");
  const active = new Map<string, { cancel: AbortController; result: Promise<SshReading> }>();
  let stopped = false;
  let reclaiming: Promise<unknown> | undefined;
  async function findServers(paseo: Paseo) {
    const directories = new Set<string>();
    let cursor: string | undefined;
    let incomplete = false;
    try {
      do {
        const page = await paseo.workspaces.list({ page: { limit: 200, cursor } });
        for (const entry of page.entries)
          directories.add(entry.workspaceDirectory ?? entry.projectRootPath);
        cursor = page.pageInfo.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
      } while (cursor);
    } catch {
      incomplete = true;
    }
    const result = await discoverSshServers({
      claudeConfigFile: claudeConfigFile(env, home),
      workspaceDirectories: [...directories],
      env: serverEnv({}, env),
    });
    return {
      servers: result.servers,
      discoveryIncomplete: incomplete || result.problems.length > 0,
    };
  }

  // The UI reads each entry separately. Concurrent requests share the same filesystem scan.
  let scanning: ReturnType<typeof findServers> | null = null;
  function discover(paseo: Paseo) {
    scanning ??= findServers(paseo).finally(() => {
      scanning = null;
    });
    return scanning;
  }

  async function poll(server: SshServer, signal: AbortSignal): Promise<SshReading> {
    try {
      reclaiming ??= Promise.all(
        listPidFiles(runDir).map((name) => reclaimPidFile(join(runDir, name), procRoot)),
      );
      await reclaiming;
      const client = await startMcpStdioClient(
        server,
        {
          runDir,
          procRoot,
          name: server.id,
          baseEnv: env,
          startTimeoutMs: 8_000,
          requestTimeoutMs: 12_000,
        },
        signal,
      );
      const close = () => {
        void client.close();
      };
      signal.addEventListener("abort", close, { once: true });
      try {
        return signal.aborted ? UNAVAILABLE : await readSshHosts(client, server.name);
      } finally {
        signal.removeEventListener("abort", close);
        await client.close();
      }
    } catch {
      return UNAVAILABLE;
    }
  }
  return {
    async list(paseo: Paseo): Promise<SshDiscovery> {
      const { servers, discoveryIncomplete } = await discover(paseo);
      return { servers: servers.map(({ id, name }) => ({ id, name })), discoveryIncomplete };
    },
    async read(paseo: Paseo, id: string): Promise<SshReading> {
      const { servers } = await discover(paseo);
      const server = servers.find((entry) => entry.id === id);
      if (stopped || !server || server.missingVariables.length) return UNAVAILABLE;
      const key = server.id + server.fingerprint;
      const current = active.get(key);
      if (current) return current.result;
      const cancel = new AbortController();
      const result = poll(server, cancel.signal).finally(() => active.delete(key));
      active.set(key, { cancel, result });
      return result;
    },
    async stop() {
      stopped = true;
      for (const work of active.values()) work.cancel.abort();
      await Promise.all([...active.values()].map((work) => work.result));
    },
  };
}
