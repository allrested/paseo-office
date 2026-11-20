import { useCallback, useMemo, useState } from "react";
import { Text, View, type ViewStyle } from "react-native";
import { OfficeModal as Modal } from "./office-modal.js";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { Machine, MachineAgent, OfficeWorkspace } from "../shared/contracts.js";
import { HostViews, NO_SSH, type SshDiscovery } from "./ssh-hosts.js";
import { LocalHostDetails } from "./host-details.js";
import { ActionButton } from "./action-button.js";
import {
  agentLine,
  agentRowLabel,
  formatBytes,
  machineTitle,
  memoryPercent,
  memoryText,
  memoryTone,
  readAtText,
  type HostTone,
} from "../shared/machine-text.js";
import type { OfficeStyles } from "./styles.js";

interface MeterProps {
  label: string;
  icon: string;
  detail?: string;
  percent: number | null;
  tone: HostTone;
  styles: OfficeStyles;
}

function Meter({ label, icon, detail, percent, tone, styles }: MeterProps) {
  const host = styles.host;
  const value = percent === null ? (detail ?? "Not read yet") : `${percent}%`;
  const description = detail && percent !== null ? `${detail} (${value})` : value;
  const fill = useMemo(
    (): ViewStyle => ({
      height: "100%",
      borderRadius: 3,
      width: `${Math.min(100, Math.max(0, percent ?? 0))}%`,
      backgroundColor:
        tone === "muted" && label === "Memory"
          ? host.memoryFill.backgroundColor
          : styles.machineFill[tone].backgroundColor,
    }),
    [percent, tone, label, host, styles],
  );
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${description}`}
      accessibilityRole="text"
      style={host.meter}
    >
      <View style={host.metricHead}>
        <Icon name={icon} size={16} color={host.label.color} />
        <Text style={host.label}>{label}</Text>
      </View>
      <View style={host.reading}>
        <Text style={host.percent}>
          {percent ?? "—"}
          {percent !== null && <Text style={host.unit}>%</Text>}
        </Text>
        {(detail || percent === null) && <Text style={host.note}>{detail ?? value}</Text>}
      </View>
      <View style={host.track}>{percent !== null && <View style={fill} />}</View>
    </View>
  );
}

interface RowAction {
  label: string;
  pendingLabel: string;
  primary: boolean;
}

interface AgentRowProps {
  agent: MachineAgent;
  now: number;
  action: RowAction | null;
  actionColumn: boolean;
  divided: boolean;
  totalBytes: number;
  cleanUp(agentIds: readonly string[]): Promise<void>;
  styles: OfficeStyles;
}

const STATUS_TONE = {
  idle: "idle",
  running: "running",
  initializing: "starting",
  closed: "idle",
  error: "danger",
} as const;

function AgentRow({
  agent,
  now,
  action,
  actionColumn,
  divided,
  totalBytes,
  cleanUp,
  styles,
}: AgentRowProps) {
  const host = styles.host;
  const press = useCallback(() => cleanUp([agent.agentId]), [cleanUp, agent.agentId]);
  const rowStyle = useMemo(() => [host.row, divided && host.divider], [host, divided]);
  const dotStyle = useMemo(
    () => [styles.dot[STATUS_TONE[agent.status]], host.status],
    [styles, agent.status, host],
  );
  const shareStyle = useMemo(
    (): ViewStyle => ({
      height: "100%",
      borderRadius: 2,
      backgroundColor: host.memoryFill.backgroundColor,
      width: `${totalBytes > 0 ? (agent.rssBytes / totalBytes) * 100 : 0}%`,
    }),
    [host, agent.rssBytes, totalBytes],
  );
  return (
    <View style={rowStyle}>
      <View
        accessible
        accessibilityLabel={agentRowLabel(agent, now)}
        accessibilityRole="text"
        style={host.info}
      >
        <View style={dotStyle} />
        <View style={host.identity}>
          <Text style={host.name} numberOfLines={1}>
            {machineTitle(agent)}
          </Text>
          <Text style={host.note}>{agentLine(agent, now)}</Text>
        </View>
        <View style={host.usage}>
          <Text style={host.bytes}>{formatBytes(agent.rssBytes)}</Text>
          <View style={host.share}>
            <View style={shareStyle} />
          </View>
        </View>
      </View>
      {action ? (
        <View style={host.action}>
          <ActionButton {...action} onPress={press} styles={styles} />
        </View>
      ) : (
        actionColumn && <View style={host.emptyAction} />
      )}
    </View>
  );
}

interface AgentGroupProps {
  title: string;
  agents: readonly MachineAgent[];
  now: number;
  actionFor(agent: MachineAgent): RowAction | null;
  cleanUp: AgentRowProps["cleanUp"];
  styles: OfficeStyles;
  empty?: string;
}

function AgentGroup({ title, agents, now, actionFor, cleanUp, styles, empty }: AgentGroupProps) {
  const host = styles.host;
  const totalBytes = agents.reduce((sum, agent) => sum + agent.rssBytes, 0);
  const actionColumn = agents.some((agent) => actionFor(agent) !== null);
  return (
    <View style={host.group}>
      <View style={host.groupHead}>
        <Text accessibilityRole="header" style={host.title}>
          {title}
        </Text>
        {agents.length > 0 && <Text style={host.note}>{formatBytes(totalBytes)} total</Text>}
      </View>
      <View style={host.list}>
        {agents.length === 0 && <Text style={host.empty}>{empty}</Text>}
        {agents.map((agent, index) => (
          <AgentRow
            key={agent.agentId}
            agent={agent}
            now={now}
            divided={index > 0}
            actionColumn={actionColumn}
            totalBytes={totalBytes}
            action={actionFor(agent)}
            cleanUp={cleanUp}
            styles={styles}
          />
        ))}
      </View>
    </View>
  );
}

interface MachineBodyProps {
  workspaces?: readonly OfficeWorkspace[];
  machine: Machine;
  cleanUp(agentIds: readonly string[]): Promise<void>;
  styles: OfficeStyles;
}

// One accent button per sheet (docs/design.md section 3): the row's own when one agent left
// something, the one for all of them when several did.
const CLEAN_ONLY = { label: "Clean up", pendingLabel: "Cleaning up...", primary: true };
const CLEAN_ONE = { label: "Clean up", pendingLabel: "Cleaning up...", primary: false };
const CLOSE = { label: "Close runtime", pendingLabel: "Closing...", primary: false };

const NO_WORKSPACES: readonly OfficeWorkspace[] = [];

function MachineBody({ machine, cleanUp, styles, workspaces = NO_WORKSPACES }: MachineBodyProps) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const now = Date.parse(machine.readAt);
  const left = useMemo(() => machine.agents.filter((agent) => agent.forgotten), [machine.agents]);
  const others = useMemo(
    () => machine.agents.filter((agent) => !agent.forgotten),
    [machine.agents],
  );
  // A host that cannot close an agent's runtime can still stop what a closed agent left behind.
  const canClose = machine.canCloseRuntime !== false;
  const cleanable = useMemo(
    () => left.filter((agent) => canClose || agent.status === "closed"),
    [left, canClose],
  );
  const cleanAll = useCallback(
    () => cleanUp(cleanable.map((agent) => agent.agentId)),
    [cleanUp, cleanable],
  );
  const percent = memoryPercent(machine);
  const rowAction = cleanable.length === 1 ? CLEAN_ONLY : CLEAN_ONE;
  const forLeft = useCallback(
    (agent: MachineAgent) => (cleanable.includes(agent) ? rowAction : null),
    [cleanable, rowAction],
  );
  const forOther = useCallback(
    (agent: MachineAgent) => (canClose && agent.status === "idle" ? CLOSE : null),
    [canClose],
  );
  return (
    <View style={styles.host.body}>
      <View style={styles.host.meters}>
        <Meter
          icon="MemoryStick"
          label="Memory"
          detail={memoryText(machine)}
          percent={percent}
          tone={memoryTone(percent)}
          styles={styles}
        />
        <Meter icon="Cpu" label="CPU" percent={machine.cpuPercent} tone="muted" styles={styles} />
      </View>
      <View style={styles.host.groupHead}>
        <Text style={styles.host.note}>Read at {readAtText(machine.readAt)}</Text>
        <ActionButton
          label={expanded ? "Hide details" : "Details"}
          pendingLabel="Details"
          onPress={toggle}
          styles={styles}
        />
      </View>
      {expanded && <LocalHostDetails machine={machine} workspaces={workspaces} styles={styles} />}
      {left.length > 0 ? (
        <View style={styles.host.group}>
          <AgentGroup
            title="Left running"
            agents={left}
            now={now}
            actionFor={forLeft}
            cleanUp={cleanUp}
            styles={styles}
          />
          <Text style={styles.rowMeta}>
            {canClose
              ? "Cleaning up closes an idle agent, which its next prompt resumes, and stops what a closed agent left behind."
              : `This host cannot close an idle agent's runtime.${cleanable.length > 0 ? " Cleaning up stops what a closed agent left behind." : ""}`}
          </Text>
          {cleanable.length > 1 ? (
            <ActionButton
              label={`Clean up all ${cleanable.length}`}
              pendingLabel="Cleaning up..."
              onPress={cleanAll}
              styles={styles}
              primary
            />
          ) : null}
        </View>
      ) : null}
      <AgentGroup
        title="Memory by agent"
        agents={others}
        now={now}
        actionFor={forOther}
        cleanUp={cleanUp}
        styles={styles}
        empty={
          left.length === 0
            ? "No agent holds a process on this host."
            : "No other agent holds a process on this host."
        }
      />
    </View>
  );
}

export interface MachineCardProps {
  workspaces?: readonly OfficeWorkspace[];
  /** Empty on hosts without local readings. */
  machine: Machine | null;
  ssh?: SshDiscovery;
  open: boolean;
  cleanUp(agentIds: readonly string[]): Promise<void>;
  styles: OfficeStyles;
  onClose(): void;
}

/** The host: its memory, what each agent holds of it, and what was left running. */
export function MachineCard({
  machine,
  ssh = NO_SSH,
  workspaces,
  open,
  cleanUp,
  styles,
  onClose,
}: MachineCardProps) {
  const change = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  const icon = useMemo(
    () => <Icon name="Server" size={18} color={styles.host.label.color} />,
    [styles],
  );
  const visible = open && (machine !== null || ssh.servers.length > 0);
  return (
    <Modal icon={icon} title="Host" open={visible} onOpenChange={change}>
      <Modal.Content>
        {visible && (
          <HostViews discovery={ssh} hasLocal={machine !== null} styles={styles}>
            {machine ? (
              <MachineBody
                workspaces={workspaces}
                machine={machine}
                cleanUp={cleanUp}
                styles={styles}
              />
            ) : (
              <Text style={styles.host.note}>
                Local resource readings are unavailable on this host.
              </Text>
            )}
          </HostViews>
        )}
      </Modal.Content>
    </Modal>
  );
}
