import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import type { Machine, OfficeWorkspace } from "../shared/contracts.js";
import { hostDetailsRpc, type HostDetails } from "../shared/host-details.js";
import { formatBytes, machineTitle, readAtText } from "../shared/machine-text.js";
import { ActionButton } from "./action-button.js";
import type { OfficeStyles } from "./styles.js";

interface Row {
  id?: string;
  label: string;
  value: string;
  note?: string;
}

function Section({
  title,
  rows,
  empty,
  styles,
}: {
  title: string;
  rows: Row[];
  empty: string;
  styles: OfficeStyles;
}) {
  const host = styles.host;
  return (
    <View style={host.group}>
      <Text style={host.title}>{title}</Text>
      <View style={host.list}>
        {rows.length ? (
          rows.map((item, index) => (
            <View
              key={item.id ?? item.label}
              style={index > 0 ? host.detailRowDivided : host.detailRow}
            >
              <View style={host.identity}>
                <Text style={host.name}>{item.label}</Text>
                {item.note && <Text style={host.note}>{item.note}</Text>}
              </View>
              <Text style={host.bytes}>{item.value}</Text>
            </View>
          ))
        ) : (
          <Text style={host.empty}>{empty}</Text>
        )}
      </View>
    </View>
  );
}

function TrendBar({ value, styles }: { value: number | null; styles: OfficeStyles }) {
  const bar = useMemo(
    () => [
      styles.host.historyBar,
      { height: value === null ? 1 : Math.max(2, value * 0.32), opacity: value === null ? 0.2 : 1 },
    ],
    [styles.host.historyBar, value],
  );
  return <View style={bar} />;
}

function Trend({
  details,
  metric,
  styles,
}: {
  details: HostDetails;
  metric: "cpu" | "ram";
  styles: OfficeStyles;
}) {
  const buckets = Array.from({ length: 30 }, (_, minute) => ({
    at: details.readAt - (29 - minute) * 60000,
    value: null as number | null,
  }));
  for (const point of details.history) {
    const bucket = 29 - Math.floor((details.readAt - point.at) / 60000);
    if (bucket >= 0 && bucket < 30 && point[metric] !== null) buckets[bucket].value = point[metric];
  }
  const values = buckets.map((b) => b.value).filter((v) => v !== null);
  const title = metric === "cpu" ? "CPU" : "RAM";
  const range = values.length
    ? `${Math.min(...values)}–${Math.max(...values)}%`
    : "Awaiting readings";
  return (
    <View
      accessible
      accessibilityLabel={`${title}: ${range} in the last 30 minutes`}
      style={styles.host.group}
    >
      <View style={styles.host.groupHead}>
        <Text style={styles.host.label}>{title}</Text>
        <Text style={styles.host.note}>{range}</Text>
      </View>
      <View style={styles.host.historyPlot}>
        {buckets.map(({ at, value }) => (
          <TrendBar key={at} value={value} styles={styles} />
        ))}
      </View>
    </View>
  );
}

function SystemReadings({ details, styles }: { details: HostDetails; styles: OfficeStyles }) {
  const { swap, disk } = details;
  const rows = useMemo<Row[]>(
    () => [
      {
        label: "System swap",
        value: swap ? formatBytes(swap.used) : "Unavailable",
        note: swap ? `${formatBytes(swap.total)} configured` : undefined,
      },
      {
        label: "Home filesystem",
        value: disk ? `${formatBytes(disk.available)} free` : "Unavailable",
        note: disk ? `${formatBytes(disk.total)} total` : undefined,
      },
      {
        label: "System load",
        value: details.load.map((v) => v.toFixed(1)).join(" / "),
        note: `1, 5 and 15 min · ${details.cores} CPUs available to Paseo`,
      },
    ],
    [swap, disk, details.cores, details.load],
  );
  const apps = useMemo(
    () =>
      details.apps.map((app) => ({
        label: app.name,
        value: formatBytes(app.bytes),
        note: `${app.count} process${app.count === 1 ? "" : "es"} · resident memory`,
      })),
    [details.apps],
  );
  return (
    <>
      <Section title={details.hostname} rows={rows} empty="" styles={styles} />
      <View style={styles.host.meter}>
        <Text style={styles.host.title}>Last 30 minutes</Text>
        <Trend details={details} metric="ram" styles={styles} />
        <Trend details={details} metric="cpu" styles={styles} />
      </View>
      <Section
        title="Top processes by memory"
        rows={apps}
        empty="No process readings available."
        styles={styles}
      />
    </>
  );
}

export function LocalHostDetails({
  machine,
  workspaces,
  styles,
}: {
  machine: Machine;
  workspaces: readonly OfficeWorkspace[];
  styles: OfficeStyles;
}) {
  const read = useRpc(hostDetailsRpc);
  const [details, setDetails] = useState<HostDetails | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    async function load() {
      try {
        const value = await read({});
        if (current) setDetails(value);
      } catch {
        if (current) setError("Host details could not be read. Try refreshing.");
      } finally {
        if (current) setLoading(false);
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, [read, revision]);
  const services = useMemo(() => {
    const ports = machine.agents
      .filter((a) => a.ports.length)
      .map((a) => ({
        id: "agent-" + a.agentId,
        label: machineTitle(a),
        value: a.ports.join(", "),
        note: a.forgotten ? "Left running" : "Listening TCP ports",
      }));
    const scripts = workspaces.flatMap((w) =>
      (w.scripts ?? [])
        .filter((s) => s.running)
        .map((s) => ({
          id: JSON.stringify([w.id, s.kind, s.name]),
          label: s.name,
          value: s.port ? `Port ${s.port}` : "Running",
          note: w.name,
        })),
    );
    return [...scripts, ...ports];
  }, [machine.agents, workspaces]);
  const changed = useMemo(
    () =>
      workspaces
        .filter((w) => w.changes && (w.changes.additions || w.changes.deletions))
        .map((w) => ({
          id: w.id,
          label: w.name,
          value: `+${w.changes!.additions} / −${w.changes!.deletions}`,
          note: w.branch,
        })),
    [workspaces],
  );
  const caches = useMemo(
    () => (details?.caches ?? []).map((c) => ({ label: c.name, value: formatBytes(c.bytes) })),
    [details],
  );
  const asOf = details
    ? `Details read at ${readAtText(new Date(details.readAt).toISOString())}`
    : "Host details";
  return (
    <View style={styles.host.body}>
      <View style={styles.host.groupHead}>
        <Text style={styles.host.note}>{loading ? "Reading host details…" : asOf}</Text>
        <ActionButton
          label="Refresh"
          pendingLabel="Refreshing…"
          disabled={loading}
          onPress={refresh}
          styles={styles}
        />
      </View>
      {error && (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {error}
        </Text>
      )}
      {details && <SystemReadings details={details} styles={styles} />}
      <Section
        title="Running services and listeners"
        rows={services}
        empty="No workspace services or agent listeners reported."
        styles={styles}
      />
      <Section
        title="Workspaces with changes"
        rows={changed}
        empty="No workspace changes reported."
        styles={styles}
      />
      {details && (
        <Section
          title="Disk caches"
          rows={caches}
          empty="No readable npm or pip cache was measured."
          styles={styles}
        />
      )}
    </View>
  );
}
