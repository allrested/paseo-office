import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import type { OfficeAgent } from "../shared/contracts.js";
import { agentTask, agentTitle, dotTone } from "../shared/model.js";
import { stateLabel } from "./agent-card.js";
import { contextLine, contextPercent } from "./context-text.js";
import { costText } from "./list-text.js";
import { avatarInitials } from "./sessions-text.js";
import { statusLine } from "./session-text.js";
import type { OfficeStyles } from "./styles.js";

export function SessionIdentity({
  agent,
  room,
  styles,
}: {
  agent: OfficeAgent;
  room: string | null;
  styles: OfficeStyles;
}) {
  const name = agentTitle(agent);
  const context = contextPercent(agent);
  const cost = agent.costUsd === 0 ? "$0.00" : costText(agent.costUsd);
  return (
    <>
      <View style={styles.chatRow}>
        <View style={styles.sessions.avatar} aria-hidden>
          <Text style={styles.sessions.initials}>{avatarInitials(name)}</Text>
          <View style={styles.sessions.badge}>
            <View style={styles.dot[dotTone(agent)]} />
          </View>
        </View>
        <View style={styles.columnBody}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {name}
          </Text>
          <Text style={styles.chatMeta}>{statusLine(agent, room)}</Text>
        </View>
      </View>
      <View style={styles.sessions.summary}>
        <View style={styles.sessions.metric}>
          <Text style={styles.sessions.caption}>{agent.model ? "Model" : "Provider"}</Text>
          <Text style={styles.sessions.name} numberOfLines={2} selectable>
            {agent.model || agent.provider}
          </Text>
        </View>
        {context !== null && (
          <View
            style={styles.sessions.metric}
            accessible
            accessibilityLabel={contextLine(agent) ?? undefined}
          >
            <Text style={styles.sessions.caption}>Context</Text>
            <Text style={styles.sessions.count}>{context}%</Text>
          </View>
        )}
        {cost !== null && (
          <View style={styles.sessions.metric}>
            <Text style={styles.sessions.caption}>Cost</Text>
            <Text style={styles.sessions.count}>{cost}</Text>
          </View>
        )}
      </View>
    </>
  );
}

export function SubagentRow({
  agent,
  onOpen,
  styles,
}: {
  agent: OfficeAgent;
  onOpen(id: string): void;
  styles: OfficeStyles;
}) {
  const title = agentTitle(agent);
  const task = agentTask(agent);
  const state = stateLabel(agent);
  const open = useCallback(() => onOpen(agent.id), [agent.id, onOpen]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${title}, ${state}`}
      onPress={open}
      style={styles.sessions.row}
    >
      <View style={styles.dot[dotTone(agent)]} />
      <View style={styles.columnBody}>
        <Text numberOfLines={1} style={styles.sessions.name}>
          {title}
        </Text>
        <Text numberOfLines={2} style={styles.chatMeta}>
          {task ? `${state} · ${task}` : state}
        </Text>
      </View>
    </Pressable>
  );
}
