/**
 * @vitest-environment jsdom
 */
// The Host card, mounted: what it offers depends on whether the host can close an agent's
// runtime. Without that, an idle agent's runtime cannot be closed, so nothing offers to; a closed
// agent's leftover processes can still be stopped.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Machine, MachineAgent } from "../shared/contracts.js";
import { type SshDiscovery, type SshHost, type SshReading } from "../shared/ssh.js";
import { useSshServers } from "./ssh-hosts.js";
import { MachineCard } from "./machine-card.js";
import { PlanPickerContext, PlanUsageContext } from "./use-plan-usage.js";
import { useOfficeStyles } from "./styles.js";

const rpc = vi.hoisted(() => ({
  details: vi.fn(),
  discover: vi.fn<() => Promise<SshDiscovery>>(),
  read: vi.fn<(input: { id: string }) => Promise<SshReading>>(),
}));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: ({ name }: { name: string }) => {
    if (name === "office.machine.details") return rpc.details;
    return name === "office.ssh.servers" ? rpc.discover : rpc.read;
  },
}));

vi.mock("@getpaseo/plugin/client/ui", () => {
  const Modal = (props: { title: string; open: boolean; children: ReactNode }) =>
    props.open ? createElement("section", { "aria-label": props.title }, props.children) : null;
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  return { Modal, Icon: () => null };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

function agent(patch: Partial<MachineAgent>): MachineAgent {
  return {
    agentId: "a1",
    title: "Agent",
    status: "idle",
    rssBytes: 1024 * 1024,
    processCount: 1,
    ports: [],
    idleSince: "2026-11-18T08:00:00.000Z",
    forgotten: false,
    ...patch,
  };
}

function reading(agents: MachineAgent[], canCloseRuntime?: boolean): Machine {
  return {
    readAt: "2026-11-18T09:00:00.000Z",
    memory: { usedBytes: 1, totalBytes: 2 },
    cpuPercent: 1,
    agents,
    ...(canCloseRuntime === undefined ? {} : { canCloseRuntime }),
  };
}

const IDLE = agent({ agentId: "idle", title: "Idler" });
const FORGOTTEN_IDLE = agent({ agentId: "left", title: "Leaver", ports: [5173], forgotten: true });
const CLOSED = agent({
  agentId: "gone",
  title: "Gone",
  status: "closed",
  idleSince: null,
  forgotten: true,
});

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  cleanUp.mockClear();
  rpc.discover.mockReset().mockResolvedValue({ servers: [], discoveryIncomplete: false });
  rpc.read.mockReset().mockResolvedValue({ status: "ok", hosts: [] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const cleanUp = vi.fn(async (_agentIds: readonly string[]): Promise<void> => undefined);
const onClose = () => undefined;

function Card({ machine }: { machine: Machine }) {
  const styles = useOfficeStyles(THEME, false, false);
  return <MachineCard machine={machine} open cleanUp={cleanUp} styles={styles} onClose={onClose} />;
}

const SECTIONS = new Set(["Overview", "Plan", "Agents", "System"]);
/** Shows one of the card's sections: its pill in the row under the title. */
async function section(name: string): Promise<void> {
  const pill = container.querySelector<HTMLElement>(`[aria-label="${name}"]`);
  if (!pill) throw new Error(`No ${name} section`);
  await act(async () => pill.click());
}
/** The actions the card offers: what was left running is on Overview, the agents on Agents. */
async function labels(machine: Machine): Promise<string[]> {
  await act(async () => root.render(<Card machine={machine} />));
  const found: string[] = [];
  for (const name of ["Overview", "Agents"]) {
    await section(name);
    for (const button of container.querySelectorAll<HTMLElement>("button[aria-label]")) {
      const label = button.getAttribute("aria-label")!;
      if (!SECTIONS.has(label) && label !== "Check for forgotten work") found.push(label);
    }
  }
  await section("Overview");
  return found;
}

test("a host that can close offers Close runtime on an idle agent and Clean up on a forgotten one", async () => {
  for (const can of [true, undefined]) {
    expect(await labels(reading([IDLE, FORGOTTEN_IDLE], can))).toEqual([
      "Clean up",
      "Close runtime",
    ]);
  }
});

test("a host that cannot close offers neither for an idle agent", async () => {
  expect(await labels(reading([IDLE, FORGOTTEN_IDLE], false))).toEqual([]);
});

test("a host that cannot close still stops what a closed agent left", async () => {
  expect(await labels(reading([CLOSED, FORGOTTEN_IDLE], false))).toEqual(["Clean up"]);
});

test("Clean up all counts only what this host can clean", async () => {
  const second = { ...CLOSED, agentId: "gone2", title: "Gone too" };
  expect(await labels(reading([CLOSED, second, FORGOTTEN_IDLE], false))).toEqual([
    "Clean up",
    "Clean up",
    "Clean up all 2",
  ]);
  expect(await labels(reading([CLOSED, second, FORGOTTEN_IDLE], true))).toEqual([
    "Clean up",
    "Clean up",
    "Clean up",
    "Clean up all 3",
  ]);
});

test("a host that cannot close offers nothing for an agent in error or still starting", async () => {
  const failed = agent({ agentId: "err", title: "Broken", status: "error", forgotten: true });
  const starting = agent({ agentId: "init", title: "Starting", status: "initializing" });
  expect(await labels(reading([failed, starting], false))).toEqual([]);
});

test("missing resource readings and zero usage are distinct", async () => {
  const machine = reading([]);
  await labels({ ...machine, memory: null, cpuPercent: null });
  expect(container.querySelector('[aria-label="Memory: Not read on this host"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="CPU: Not read yet"]')).not.toBeNull();

  await labels({ ...machine, memory: { usedBytes: 0, totalBytes: 1024 }, cpuPercent: 0 });
  expect(container.querySelector('[aria-label="Memory: 0 B of 1.0 KB (0%)"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="CPU: 0%"]')).not.toBeNull();
});

test("a zero memory capacity does not produce a percentage", async () => {
  await labels({ ...reading([]), memory: { usedBytes: 0, totalBytes: 0 } });
  expect(container.querySelector('[aria-label="Memory: 0 B of 0 B"]')).not.toBeNull();
});

test("Close runtime targets only the selected idle agent", async () => {
  const running = agent({ agentId: "busy", status: "running", idleSince: null });
  expect(await labels(reading([running, IDLE], true))).toEqual(["Close runtime"]);
  await section("Agents");
  const close = container.querySelector<HTMLElement>('button[aria-label="Close runtime"]');
  if (!close) throw new Error("No Close runtime button");
  await act(async () => close.click());
  expect(cleanUp.mock.calls).toEqual([[["idle"]]]);
});

test("bulk cleanup sends only the closed agents on a host unable to close idle runtimes", async () => {
  const second = { ...CLOSED, agentId: "gone2" };
  await labels(reading([IDLE, CLOSED, FORGOTTEN_IDLE, second], false));
  const clean = container.querySelector<HTMLElement>('button[aria-label="Clean up all 2"]');
  if (!clean) throw new Error("No bulk cleanup button for the two closed agents");
  await act(async () => clean.click());
  expect(cleanUp.mock.calls).toEqual([[["gone", "gone2"]]]);
});

const OFFICE_SERVERS = [
  { id: "1".repeat(16), name: "Main" },
  { id: "2".repeat(16), name: "Lab" },
];
const REMOTE: SshHost = {
  name: "build",
  reachable: true,
  cores: 2,
  load1: 2.14,
  load5: 1,
  load15: 0,
  memoryTotalBytes: 1024,
  memoryUsedBytes: 0,
  diskMount: "/",
  diskTotalBytes: 100,
  diskUsedBytes: 62,
};

function DiscoveredCard({ machine, open }: { machine: Machine | null; open: boolean }) {
  const styles = useOfficeStyles(THEME, false, false);
  const ssh = useSshServers(true);
  return (
    <MachineCard
      ssh={ssh}
      machine={machine}
      open={open}
      cleanUp={cleanUp}
      styles={styles}
      onClose={onClose}
    />
  );
}
async function mountCard(machine: Machine | null, open = true) {
  await act(async () => root.render(<DiscoveredCard machine={machine} open={open} />));
}
async function press(label: string) {
  const button = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!button) throw new Error(`Missing control: ${label}`);
  await act(async () => button.click());
}

test("the local card stays available without SSH configuration", async () => {
  await mountCard(reading([]));
  expect(container.querySelector('[role="tablist"]')).toBeNull();
  await section("Agents");
  expect(container.textContent).toContain("Memory by agent");
  expect(rpc.read).not.toHaveBeenCalled();
});

test("only the selected SSH server is polled while its tab and the Host card are open", async () => {
  vi.useFakeTimers();
  rpc.discover.mockResolvedValue({ servers: OFFICE_SERVERS, discoveryIncomplete: false });
  rpc.read.mockResolvedValue({ status: "ok", hosts: [REMOTE] });
  const machine = reading([]);
  await mountCard(machine);
  expect(rpc.read).not.toHaveBeenCalled();
  await press("SSH");
  expect(rpc.read.mock.calls).toEqual([[{ id: OFFICE_SERVERS[0].id }]]);
  expect(container.querySelector('[aria-label="Load: 107% · 2 cores"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Memory: 0% · 0 B"]')).not.toBeNull();
  expect(container.textContent).toContain("Warning");
  await press("Details for build");
  expect(container.textContent).toContain("2.14 / 1.00 / 0.00");
  expect(container.textContent).toContain("62 B of 100 B");
  await press("Lab");
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(rpc.read.mock.calls.slice(1)).toEqual([
    [{ id: OFFICE_SERVERS[1].id }],
    [{ id: OFFICE_SERVERS[1].id }],
  ]);
  await press("This instance");
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(rpc.read).toHaveBeenCalledTimes(3);
  await press("SSH");
  await mountCard(machine, false);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(rpc.read).toHaveBeenCalledTimes(4);
  expect(cleanUp).not.toHaveBeenCalled();
});

test("SSH-only hosts open on remote readings and distinguish unreachable profiles from an empty server", async () => {
  rpc.discover.mockResolvedValue({ servers: OFFICE_SERVERS, discoveryIncomplete: true });
  rpc.read.mockResolvedValueOnce({
    status: "ok",
    hosts: [{ ...REMOTE, name: "offline", reachable: false }],
  });
  await mountCard(null);
  expect(container.querySelector('[aria-label="SSH"]')?.getAttribute("aria-selected")).toBe("true");
  expect(container.textContent).toContain("Unreachable");
  expect(container.querySelector('[aria-label="Details for offline"]')).toBeNull();
  await press("Lab");
  expect(container.textContent).toContain("No SSH hosts configured");
  expect(container.textContent).toContain("Some SSH configurations could not be read");
  await press("This instance");
  expect(container.textContent).toContain("Local resource readings are unavailable");
});

test("a failed SSH read shows an error and keeps This instance usable", async () => {
  rpc.discover.mockResolvedValue({
    servers: OFFICE_SERVERS.slice(0, 1),
    discoveryIncomplete: false,
  });
  rpc.read.mockRejectedValue(new Error("connection failed"));
  await mountCard(reading([]));
  await press("SSH");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Unable to read");
  await press("This instance");
  await section("Agents");
  expect(container.textContent).toContain("Memory by agent");
});

test("partial metrics stay unavailable and expanded hosts disclose their known readings", async () => {
  rpc.discover.mockResolvedValue({
    servers: OFFICE_SERVERS.slice(0, 1),
    discoveryIncomplete: false,
  });
  rpc.read.mockResolvedValue({
    status: "ok",
    hosts: [
      { ...REMOTE, name: "quiet", load1: 0 },
      { ...REMOTE, name: "partial", load1: null, diskUsedBytes: null },
    ],
  });
  await mountCard(null);
  expect(container.textContent).toContain("2 hosts · 1 needs attention");
  expect(container.querySelector('[aria-label="Load: Unavailable"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Disk: Unavailable"]')).not.toBeNull();
  const expand = [...container.querySelectorAll<HTMLElement>('[role="button"]')].find(
    (button) => button.textContent === "Expand all",
  );
  if (!expand) throw new Error("No Expand all button");
  await act(async () => expand.click());
  expect(
    container.querySelector('[aria-label="Details for quiet"]')?.getAttribute("aria-expanded"),
  ).toBe("true");
  expect(
    container.querySelector('[aria-label="Details for partial"]')?.getAttribute("aria-expanded"),
  ).toBe("true");
  expect(container.textContent).toContain("CPU cores · 2");
});

test("System reads local diagnostics when it is opened, refreshes and leaves with its tab", async () => {
  rpc.details.mockResolvedValue({
    hostname: "test-machine",
    readAt: Date.now(),
    cores: 2,
    load: [1, 2, 3],
    swap: { used: 0, total: 0 },
    disk: null,
    apps: [{ name: "node", count: 2, bytes: 1024 }],
    caches: [],
    history: [],
  });
  await labels(reading([IDLE]));
  expect(rpc.details).not.toHaveBeenCalled();
  const click = async (name: string) => {
    const b = container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
    expect(b).not.toBeNull();
    await act(async () => b!.click());
  };
  await section("System");
  expect(container.textContent).toContain("test-machine");
  expect(container.textContent).toContain("node");
  await click("Refresh");
  expect(rpc.details).toHaveBeenCalledTimes(2);
  await section("Overview");
  expect(container.textContent).not.toContain("test-machine");
});

const PLANS = [
  {
    provider: "claude",
    name: "Claude",
    plan: "Max",
    windows: [{ id: "5h", label: "5 hours", usedPct: 46, resetsAt: null }],
  },
  {
    provider: "copilot",
    name: "GitHub Copilot",
    plan: null,
    windows: [{ id: "m", label: "Premium requests", usedPct: 100, resetsAt: null }],
  },
];
const setCounted = vi.fn(async (_provider: string, _counted: boolean) => undefined);
const PICKER = { all: PLANS, hidden: new Set(["copilot"]), setCounted };
const COUNTED = PLANS.slice(0, 1);

function PlanCard() {
  const styles = useOfficeStyles(THEME, false, false);
  return (
    <PlanUsageContext.Provider value={COUNTED}>
      <PlanPickerContext.Provider value={PICKER}>
        <MachineCard
          machine={PLAN_MACHINE}
          open
          cleanUp={cleanUp}
          styles={styles}
          onClose={onClose}
        />
      </PlanPickerContext.Provider>
    </PlanUsageContext.Provider>
  );
}
const PLAN_MACHINE = reading([]);

test("Overview has only the closest limit that counts, and Plan lists every provider with its switch", async () => {
  setCounted.mockClear();
  await act(async () => root.render(<PlanCard />));
  // The provider left out is at 100%, and is not the closest limit.
  expect(container.querySelector('[aria-label^="Claude 5 hours"]')).not.toBeNull();
  expect(container.textContent).not.toContain("GitHub Copilot");

  await section("Plan");
  expect(container.textContent).toContain("GitHub Copilot");
  // Left out: named with its switch, without its meters.
  expect(container.querySelector('[aria-label^="Premium requests"]')).toBeNull();
  expect(container.querySelector('[aria-label^="5 hours"]')).not.toBeNull();
  const off = container.querySelector<HTMLElement>('[role="switch"][aria-label^="GitHub Copilot"]');
  expect(off?.getAttribute("aria-checked")).toBe("false");
  await act(async () => off!.click());
  expect(setCounted).toHaveBeenCalledWith("copilot", true);
  const on = container.querySelector<HTMLElement>('[role="switch"][aria-label^="Claude"]');
  await act(async () => on!.click());
  expect(setCounted).toHaveBeenLastCalledWith("claude", false);
});
