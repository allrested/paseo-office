import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { Text } from "./text.js";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { sshReadingRpc, sshServersRpc, type SshDiscovery, type SshReading } from "../shared/ssh.js";
import {
  STATUS_ORDER,
  summarizeHost,
  usedOf,
  type HostSummary,
  type RemoteMeter,
} from "./ssh-metrics.js";
import type { OfficeStyles } from "./styles.js";

export type { SshDiscovery } from "../shared/ssh.js";
export const NO_SSH: SshDiscovery = { servers: [], discoveryIncomplete: false };

const DISCOVERY_UNAVAILABLE: SshDiscovery = { servers: [], discoveryIncomplete: true };

export function useSshServers(enabled: boolean): SshDiscovery {
  const discover = useRpc(sshServersRpc);
  const [result, setResult] = useState(NO_SSH);
  useEffect(() => {
    if (!enabled) {
      setResult(NO_SSH);
      return;
    }
    let current = true;
    async function load() {
      let found: SshDiscovery;
      try {
        found = await discover({});
      } catch {
        found = DISCOVERY_UNAVAILABLE;
      }
      if (current) setResult(found);
    }
    void load();
    return () => {
      current = false;
    };
  }, [enabled, discover]);
  return enabled ? result : NO_SSH;
}

interface TabProps {
  id: string;
  label: string;
  selected: boolean;
  select(id: string): void;
  styles: OfficeStyles;
}

function Tab({ id, label, selected, select, styles }: TabProps) {
  const press = useCallback(() => select(id), [id, select]);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      aria-selected={selected}
      style={styles.segment}
      onPress={press}
    >
      {selected && <View style={styles.segmentFill} />}
      <Text style={selected ? styles.segmentTextSelected : styles.segmentText}>{label}</Text>
    </Pressable>
  );
}

function SshMeter({ meter, styles }: { meter: RemoteMeter; styles: OfficeStyles }) {
  const { host } = styles;
  const color = host[meter.tone].color;
  const fill = useMemo(
    (): ViewStyle => ({
      height: "100%",
      borderRadius: 3,
      width: `${Math.min(100, Math.max(0, meter.value ?? 0))}%`,
      backgroundColor: color,
    }),
    [meter.value, color],
  );
  return (
    <View style={host.remoteMeter} accessible accessibilityLabel={`${meter.label}: ${meter.text}`}>
      <Text style={host.note}>{meter.label}</Text>
      <Text style={host.name}>{meter.text}</Text>
      <View style={host.track}>{meter.value !== null && <View style={fill} />}</View>
    </View>
  );
}

const TONES = {
  OK: "healthy",
  Partial: "warning",
  Warning: "warning",
  Critical: "critical",
  Unreachable: "critical",
} as const;
const ICONS = {
  OK: "CircleCheck",
  Partial: "CircleHelp",
  Warning: "TriangleAlert",
  Critical: "CircleAlert",
  Unreachable: "CircleX",
} as const;

function HostDetails({ summary, styles }: { summary: HostSummary; styles: OfficeStyles }) {
  const { host } = summary;
  const averages = [host.load1, host.load5, host.load15]
    .map((v) => v?.toFixed(2) ?? "—")
    .join(" / ");
  return (
    <View style={styles.host.details}>
      <Text style={styles.host.note}>
        Memory used / total · {usedOf(host.memoryUsedBytes, host.memoryTotalBytes)}
      </Text>
      <Text style={styles.host.note}>Load averages (1 / 5 / 15 min) · {averages}</Text>
      <Text style={styles.host.note}>CPU cores · {host.cores ?? "Unavailable"}</Text>
      <Text style={styles.host.note}>
        Disk used / total{host.diskMount && ` (${host.diskMount})`} ·{" "}
        {usedOf(host.diskUsedBytes, host.diskTotalBytes)}
      </Text>
    </View>
  );
}

function HostRow({
  summary,
  expanded,
  toggle,
  styles,
}: {
  summary: HostSummary;
  expanded: boolean;
  toggle(name: string): void;
  styles: OfficeStyles;
}) {
  const { host, status, meters } = summary;
  const tone = styles.host[TONES[status]];
  const press = useCallback(() => toggle(host.name), [toggle, host.name]);
  return (
    <View style={styles.host.remoteCard}>
      <View style={styles.host.remoteHeading}>
        <Icon name={ICONS[status]} size={15} color={tone.color} />
        <Text style={styles.host.remoteName}>{host.name}</Text>
        <Text style={tone}>{status}</Text>
      </View>
      {host.reachable && (
        <>
          <View style={styles.host.meters}>
            {meters.map((meter) => (
              <SshMeter key={meter.label} meter={meter} styles={styles} />
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Details for ${host.name}`}
            aria-expanded={expanded}
            onPress={press}
            style={styles.host.detailsButton}
          >
            <Text style={styles.host.note}>Details</Text>
            <Icon
              name={expanded ? "ChevronUp" : "ChevronDown"}
              size={14}
              color={styles.host.note.color}
            />
          </Pressable>
          {expanded && <HostDetails summary={summary} styles={styles} />}
        </>
      )}
    </View>
  );
}

// Wait for a read to finish before scheduling the next. Switching tabs unmounts this panel.
const POLL_MS = 30_000;
function useRemoteReading(id: string) {
  const read = useRpc(sshReadingRpc);
  const [result, setResult] = useState<SshReading | null>(null);
  useEffect(() => {
    let current = true;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout>;
    const page = typeof document === "undefined" ? undefined : document;
    async function poll() {
      clearTimeout(timer);
      if (!current || inFlight || page?.hidden) return;
      inFlight = true;
      let reading: SshReading;
      try {
        reading = await read({ id });
      } catch {
        reading = { status: "unavailable", hosts: [] };
      }
      inFlight = false;
      if (current) {
        setResult(reading);
        if (!page?.hidden) timer = setTimeout(poll, POLL_MS);
      }
    }
    const visibilityChanged = () => void poll();
    page?.addEventListener("visibilitychange", visibilityChanged);
    void poll();
    return () => {
      current = false;
      page?.removeEventListener("visibilitychange", visibilityChanged);
      clearTimeout(timer);
    };
  }, [id, read]);
  return result;
}

function ServerPanel({ id, styles }: { id: string; styles: OfficeStyles }) {
  const reading = useRemoteReading(id);
  const rows = useMemo(
    () =>
      (reading?.hosts ?? [])
        .map(summarizeHost)
        .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]),
    [reading],
  );
  const [expanded, setExpanded] = useState<string[]>([]);
  const toggle = useCallback(
    (name: string) =>
      setExpanded((prev) =>
        prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
      ),
    [],
  );
  const available = rows.filter(({ host }) => host.reachable);
  const allOpen = available.every(({ host }) => expanded.includes(host.name));
  const toggleAll = useCallback(
    () => setExpanded(allOpen ? [] : available.map(({ host }) => host.name)),
    [allOpen, available],
  );
  if (!reading) return <Text style={styles.host.note}>Reading SSH hosts…</Text>;
  if (reading.status === "unavailable")
    return (
      <Text accessibilityRole="alert" style={styles.host.critical}>
        Unable to read this SSH server.
      </Text>
    );
  if (!rows.length)
    return <Text style={styles.host.note}>No SSH hosts configured on this server.</Text>;
  const attention = rows.filter((row) => row.status !== "OK").length;
  return (
    <View style={styles.host.group}>
      <View style={styles.host.groupHead}>
        <Text accessibilityRole="header" style={styles.host.title}>
          {rows.length} {rows.length === 1 ? "host" : "hosts"}
          {attention > 0 && ` · ${attention} need${attention === 1 ? "s" : ""} attention`}
        </Text>
        {available.length > 1 && (
          <Pressable
            accessibilityRole="button"
            onPress={toggleAll}
            style={styles.host.detailsButton}
          >
            <Text style={styles.host.note}>{allOpen ? "Collapse all" : "Expand all"}</Text>
          </Pressable>
        )}
      </View>
      {rows.map((summary) => (
        <HostRow
          key={summary.host.name}
          summary={summary}
          expanded={expanded.includes(summary.host.name)}
          toggle={toggle}
          styles={styles}
        />
      ))}
    </View>
  );
}

function SshPanel({ discovery, styles }: { discovery: SshDiscovery; styles: OfficeStyles }) {
  const { servers } = discovery;
  const [id, select] = useState(servers[0].id);
  const server = servers.find((each) => each.id === id) ?? servers[0];
  return (
    <View style={styles.host.group}>
      {servers.length > 1 && (
        <View accessibilityRole="tablist" accessibilityLabel="SSH servers" style={styles.host.tabs}>
          {servers.map((each) => (
            <Tab
              key={each.id}
              id={each.id}
              label={each.name}
              selected={each.id === server.id}
              select={select}
              styles={styles}
            />
          ))}
        </View>
      )}
      {discovery.discoveryIncomplete && (
        <Text style={styles.host.note}>Some SSH configurations could not be read.</Text>
      )}
      <ServerPanel key={server.id} id={server.id} styles={styles} />
    </View>
  );
}

export function HostViews({
  discovery,
  hasLocal,
  styles,
  children,
}: {
  discovery: SshDiscovery;
  hasLocal: boolean;
  styles: OfficeStyles;
  children: ReactNode;
}) {
  const [tab, select] = useState(hasLocal ? "local" : "ssh");
  if (!discovery.servers.length) return children;
  const ssh = tab === "ssh";
  return (
    <View style={styles.host.body}>
      <View
        accessibilityRole="tablist"
        accessibilityLabel="Host resources"
        style={styles.host.tabs}
      >
        <Tab id="local" label="This instance" selected={!ssh} select={select} styles={styles} />
        <Tab id="ssh" label="SSH" selected={ssh} select={select} styles={styles} />
      </View>
      {ssh ? <SshPanel discovery={discovery} styles={styles} /> : children}
    </View>
  );
}
