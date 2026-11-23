import { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import {
  HINT_MAX,
  checksNote,
  clashNote,
  portNote,
  type Alert,
  type AlertKind,
} from "../shared/alerts.js";
import type { Machine } from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import { OfficeModal as Modal } from "./office-modal.js";
import type { OfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";

const layout = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  field: { flex: 1, minWidth: 160 },
});

const STEER = { activeTurnBehavior: "steer" } as const;

const ABOUT: Readonly<Record<AlertKind, string>> = {
  loop: "Stop ends its turn. A hint is sent into the turn, so the agent reads it without starting over.",
  refused:
    "The provider's auto mode refused this call. The agent was told and goes on; nothing is waiting for you.",
  clash: "Tell both sends each a line about the other, into its turn.",
  port: "Tell the agent sends it a line to use another port, into its turn.",
  checks: "Fix it sends the failing checks to an agent of this workspace that is resting.",
};

export interface AlertCardProps {
  /** The alert to show; null closes the card. */
  alert: Alert | null;
  /** The office's name for an agent, for a line sent to another one. */
  nameOf(agentId: string): string;
  /** The host's readings: who holds a port. */
  machine: Machine | null;
  actions: AgentActions;
  styles: OfficeStyles;
  onClose(): void;
  onDismiss(): Promise<void>;
}

interface ActProps extends Omit<AlertCardProps, "alert" | "onClose"> {
  alert: Alert;
}

/** The loop's: stop the turn, or send a hint into it. */
function LoopActions({ alert, actions, styles, onDismiss }: ActProps) {
  const [hint, setHint] = useState("");
  const agentId = alert.agentId ?? "";
  const { cancel } = actions;
  const stop = useCallback(async () => {
    await cancel?.(agentId);
    await onDismiss();
  }, [cancel, agentId, onDismiss]);
  const send = useCallback(async () => {
    await actions.send(agentId, hint.trim().slice(0, HINT_MAX), STEER);
    await onDismiss();
  }, [actions, agentId, hint, onDismiss]);
  const field = useMemo(() => [styles.fieldInput, layout.field], [styles]);
  return (
    <>
      <View style={layout.row}>
        <TextInput
          accessibilityLabel="Hint for the agent"
          value={hint}
          onChangeText={setHint}
          placeholder="What it should try instead"
          maxLength={HINT_MAX}
          style={field}
        />
        <ActionButton
          label="Send a hint"
          pendingLabel="Sending..."
          onPress={send}
          disabled={hint.trim() === ""}
          styles={styles}
          primary
        />
      </View>
      {cancel ? (
        <ActionButton label="Stop" pendingLabel="Stopping..." onPress={stop} styles={styles} />
      ) : null}
    </>
  );
}

/** What is sent to whom for an alert that is answered with one line; null when there is nobody to send to. */
function linesOf({
  alert,
  nameOf,
  machine,
}: ActProps): { label: string; to: [string, string][] } | null {
  const { agentId, otherAgentId } = alert;
  if (agentId === undefined) return null;
  if (alert.kind === "clash" && otherAgentId !== undefined) {
    // (the alert's title names the file only when the host may name files)
    const file = /are in (.+)$/.exec(alert.title)?.[1] ?? "the same file";
    return {
      label: "Tell both",
      to: [
        [agentId, clashNote(file, nameOf(otherAgentId))],
        [otherAgentId, clashNote(file, nameOf(agentId))],
      ],
    };
  }
  if (alert.kind === "port" && alert.port !== undefined) {
    const { port } = alert;
    const holder = machine?.agents.find(
      (held) => held.agentId !== agentId && held.ports.includes(port),
    );
    const name = holder === undefined ? null : nameOf(holder.agentId);
    return { label: "Tell the agent", to: [[agentId, portNote(port, name)]] };
  }
  if (alert.kind === "checks") {
    return { label: "Fix it", to: [[agentId, checksNote(alert.detail)]] };
  }
  return null;
}

function LineAction(props: ActProps) {
  const { alert, actions, styles, onDismiss } = props;
  const lines = linesOf(props);
  const send = useCallback(async () => {
    if (lines === null) return;
    // Failing checks go to a resting agent as its prompt; the rest join a running turn.
    const options = alert.kind === "checks" ? undefined : STEER;
    await Promise.all(lines.to.map(([agentId, text]) => actions.send(agentId, text, options)));
    await onDismiss();
  }, [lines, alert.kind, actions, onDismiss]);
  if (alert.kind === "refused") return null;
  if (lines === null) {
    return <Text style={styles.host.note}>No agent of this workspace is resting now.</Text>;
  }
  return (
    <ActionButton
      label={lines.label}
      pendingLabel="Sending..."
      onPress={send}
      styles={styles}
      primary
    />
  );
}

/** One thing the office noticed, with what can be done about it. */
export function AlertCard({ alert, onClose, ...rest }: AlertCardProps) {
  const { styles, onDismiss } = rest;
  const change = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  const icon = useMemo(
    () => <Icon name="TriangleAlert" size={18} color={String(styles.host.label.color)} />,
    [styles],
  );
  return (
    <Modal icon={icon} title="Noticed" open={alert !== null} onOpenChange={change}>
      <Modal.Content>
        {alert !== null && (
          <View style={styles.host.body}>
            <View style={styles.host.group}>
              <Text accessibilityRole="header" style={styles.host.title}>
                {alert.title}
              </Text>
              {alert.detail !== "" && (
                <Text selectable style={styles.rowMeta}>
                  {alert.detail}
                </Text>
              )}
              <Text style={styles.host.note}>{ABOUT[alert.kind]}</Text>
            </View>
            {alert.kind === "loop" ? (
              <LoopActions alert={alert} {...rest} />
            ) : (
              <LineAction alert={alert} {...rest} />
            )}
            <ActionButton
              label="Dismiss"
              pendingLabel="Dismissing..."
              onPress={onDismiss}
              styles={styles}
            />
          </View>
        )}
      </Modal.Content>
    </Modal>
  );
}
