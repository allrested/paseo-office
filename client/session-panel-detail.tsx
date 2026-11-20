import { AVATARS, shirtColor } from "../shared/appearance.js";
import { useCallback, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { OfficeAgent } from "../shared/contracts.js";
import { agentTask, agentTitle, dotTone } from "../shared/model.js";
import { stateLabel } from "./agent-card.js";
import { contextLine, contextPercent } from "./context-text.js";
import { costText } from "./list-text.js";
import { avatarInitials } from "./sessions-text.js";
import { statusLine } from "./session-text.js";
import type { OfficeStyles } from "./styles.js";

export function SessionHeading({
  agent,
  room,
  styles,
}: {
  agent: OfficeAgent;
  room: string | null;
  styles: OfficeStyles;
}) {
  const name = agentTitle(agent);
  const borderColor = shirtColor(agent.appearance);
  const avatarStyle = useMemo(
    () => [styles.sessions.identityAvatar, borderColor && { borderColor, borderWidth: 2 }],
    [styles.sessions.identityAvatar, borderColor],
  );
  return (
    <View style={styles.sessions.identityLead}>
      <View style={avatarStyle} aria-hidden>
        <Text style={styles.sessions.initials}>
          {agent.appearance?.avatar ? AVATARS[agent.appearance.avatar] : avatarInitials(name)}
        </Text>
        <View style={styles.sessions.badge}>
          <View style={styles.dot[dotTone(agent)]} />
        </View>
      </View>
      <View style={styles.sessions.identityText}>
        <Text accessibilityRole="header" style={styles.sessions.identityName} numberOfLines={2}>
          {name}
        </Text>
        <Text numberOfLines={2} style={styles.chatMeta}>
          {statusLine(agent, room)}
        </Text>
      </View>
    </View>
  );
}

export function SessionMetadata({ agent, styles }: { agent: OfficeAgent; styles: OfficeStyles }) {
  const context = contextPercent(agent);
  const cost = agent.costUsd === 0 ? "$0.00" : costText(agent.costUsd);
  const fill = useMemo(
    () => [styles.sessions.contextGauge, { width: `${context ?? 0}%` as const }],
    [context, styles],
  );
  return (
    <View style={styles.sessions.metadata}>
      <View style={styles.sessions.metaChip}>
        <Text style={styles.sessions.caption}>{agent.model ? "Model" : "Provider"}</Text>
        <Text style={styles.sessions.metaValue} numberOfLines={2} selectable>
          {agent.model || agent.provider}
        </Text>
      </View>
      {context !== null && (
        <View
          style={styles.sessions.metaChip}
          accessible
          accessibilityLabel={contextLine(agent) ?? undefined}
        >
          <Text style={styles.sessions.caption}>Context</Text>
          <View style={styles.sessions.contextTrack} aria-hidden>
            <View style={fill} />
          </View>
          <Text style={styles.sessions.metaValue}>{context}%</Text>
        </View>
      )}
      {cost !== null && (
        <View style={styles.sessions.metaChip}>
          <Text style={styles.sessions.caption}>Cost</Text>
          <Text style={styles.sessions.metaValue}>{cost}</Text>
        </View>
      )}
    </View>
  );
}

export function SessionButton({
  icon,
  label,
  onPress,
  styles,
  primary = false,
  caption,
  expanded,
  disabled = false,
}: {
  icon: string;
  label: string;
  onPress(): void;
  styles: OfficeStyles;
  primary?: boolean;
  caption?: "plain" | "button";
  expanded?: boolean;
  disabled?: boolean;
}) {
  const buttonStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => {
      const palette = styles.sessions;
      if (caption === "button") return pressed ? palette.workspacePressed : palette.workspaceButton;
      if (caption) return palette.deskLink;
      if (!primary) return pressed ? palette.deskActionPressed : palette.deskAction;
      if (disabled) return palette.sendDisabled;
      return pressed ? palette.sendPressed : palette.send;
    },
    [primary, disabled, caption, styles],
  );
  const color = primary && !disabled ? String(styles.buttonPrimaryText.color) : styles.iconColor;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-expanded={expanded}
      disabled={disabled}
      onPress={onPress}
      style={buttonStyle}
    >
      <Icon name={icon} size={caption ? 15 : 18} color={color} />
      {caption && <Text style={styles.sessions.deskLinkLabel}>{label}</Text>}
    </Pressable>
  );
}

export type SessionDetailTab = "chat" | "steps" | "subagents";
const detailTabs = [
  { id: "chat", label: "Chat", icon: "MessageCircle" },
  { id: "steps", label: "Steps", icon: "ListChecks" },
  { id: "subagents", label: "Subagents", icon: "UsersRound" },
] as const;

export function SessionDetailTabs({
  tab,
  setTab,
  childCount,
  styles,
}: {
  tab: SessionDetailTab;
  setTab(tab: SessionDetailTab): void;
  childCount?: number;
  styles: OfficeStyles;
}) {
  return (
    <View style={styles.sessions.detailTabs} role="group" aria-label="Session details">
      {detailTabs.map((item) =>
        item.id === "subagents" && childCount === undefined ? null : (
          <DetailTab
            key={item.id}
            item={item}
            selected={tab === item.id}
            onSelect={setTab}
            count={item.id === "subagents" ? childCount : undefined}
            styles={styles}
          />
        ),
      )}
    </View>
  );
}

function DetailTab({
  item,
  selected,
  onSelect,
  count,
  styles,
}: {
  item: (typeof detailTabs)[number];
  selected: boolean;
  onSelect(tab: SessionDetailTab): void;
  count?: number;
  styles: OfficeStyles;
}) {
  const press = useCallback(() => onSelect(item.id), [item.id, onSelect]);
  const tabStyle = useMemo(
    () => [styles.sessions.detailTab, selected && styles.sessions.detailTabActive],
    [styles, selected],
  );
  const label = selected ? styles.sessions.detailLabelActive : styles.sessions.detailLabel;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Session ${item.id}`}
      aria-pressed={selected}
      onPress={press}
      style={tabStyle}
    >
      <Icon name={item.icon} size={14} color={String(label.color)} />
      <Text numberOfLines={1} style={label}>
        {item.label}
        {count ? ` · ${count}` : ""}
      </Text>
    </Pressable>
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
