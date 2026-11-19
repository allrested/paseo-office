import { AVATARS, shirtColor } from "../shared/appearance.js";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import type { ChecklistProgress } from "../shared/contracts.js";
import { useRowClock } from "./structure-view.js";
import { ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { agentTitle, buildOfficeModel, dotTone } from "../shared/model.js";
import { loadProblem } from "./activity-panel.js";
import { stateLabel } from "./agent-card.js";
import { ActionButton } from "./action-button.js";
import { NewAgentForm } from "./new-agent-form.js";
import { NO_MATCH, SEARCH_LABEL, tabCounts, timeText, type ListTab } from "./list-text.js";
import type { ColumnPanelProps, OfficeLink } from "./office-link.js";
import {
  NO_AGENTS,
  avatarInitials,
  sessionDetail,
  sessionMeter,
  sessionSections,
  type GroupedSession,
  type SessionGroup,
} from "./sessions-text.js";
import type { OfficeStyles } from "./styles.js";

interface AgentRowProps {
  now: number;
  progress?: ChecklistProgress;
  entry: GroupedSession;
  link: OfficeLink;
  styles: OfficeStyles;
}

type Meter = NonNullable<ReturnType<typeof sessionMeter>>;

function SessionMeter({ meter, styles }: { meter: Meter; styles: OfficeStyles }) {
  const ui = styles.sessions;
  const fill = useMemo(
    (): ViewStyle[] => [
      meter.kind === "tasks" ? ui.tasksFill : ui.contextFill,
      { width: `${meter.percent}%` },
    ],
    [meter.kind, meter.percent, ui],
  );
  return (
    <View style={ui.meterRow}>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={meter.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={meter.percent}
        style={ui.track}
      >
        <View style={fill} />
      </View>
      <Text style={ui.meterText}>{meter.label}</Text>
    </View>
  );
}

function AgentRow({ entry, link, styles, now, progress }: AgentRowProps) {
  const { row, room, level } = entry;
  const { agent } = row;
  const ui = styles.sessions;
  const title = agentTitle(agent);
  const tone =
    row.waitingOn && agent.status === "idle" && !agent.permissions.length
      ? "running"
      : dotTone(agent);
  const state = stateLabel(agent);
  const text = sessionDetail(entry);
  const time = timeText(row, now);
  const meter = sessionMeter(agent, progress);
  const press = useCallback(() => link.select(agent.id), [link, agent.id]);
  let accent: typeof ui.error | undefined;
  let detailColor: typeof ui.warningText | undefined;
  if (tone === "warning") {
    accent = ui.approval;
    detailColor = ui.warningText;
  }
  if (tone === "danger") {
    accent = ui.error;
    detailColor = ui.errorText;
  }
  const borderColor = shirtColor(agent.appearance);
  const avatarStyle = useMemo(
    () => [ui.avatar, borderColor && { borderColor, borderWidth: 2 }],
    [ui.avatar, borderColor],
  );
  const clockStyle = useMemo(
    () => [ui.clock, detailColor, tone === "running" && ui.workingClock],
    [ui, tone, detailColor],
  );
  const rowStyle = useMemo(() => [ui.row, accent], [ui, accent]);
  const detailStyle = useMemo(() => [ui.detail, detailColor], [ui, detailColor]);
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const nested = level > 1 ? ui.deep : ui.nested;
  return (
    <View style={level ? nested : undefined}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${state}`}
        accessibilityHint={[text || room.name, time, meter?.label].filter(Boolean).join(", ")}
        onPress={press}
        onHoverIn={hoverIn}
        onHoverOut={hoverOut}
        style={rowStyle}
      >
        {({ pressed }) => (
          <>
            {(pressed || hovered) && <View style={styles.pressedFill} />}
            <View style={avatarStyle}>
              <Text style={ui.initials}>
                {agent.appearance?.avatar
                  ? AVATARS[agent.appearance.avatar]
                  : avatarInitials(title)}
              </Text>
              <View style={ui.badge}>
                <View style={styles.dot[tone]} />
              </View>
            </View>
            <View style={styles.rowBody}>
              <View style={ui.rowTitle}>
                <Text style={ui.name} numberOfLines={1}>
                  {title}
                </Text>
                <Text numberOfLines={1} style={ui.project}>
                  {room.name}
                </Text>
                {time ? (
                  <Text numberOfLines={1} style={clockStyle}>
                    {time}
                  </Text>
                ) : null}
              </View>
              {text ? (
                <Text style={detailStyle} numberOfLines={1}>
                  {text}
                </Text>
              ) : null}
              {meter ? <SessionMeter meter={meter} styles={styles} /> : null}
            </View>
          </>
        )}
      </Pressable>
    </View>
  );
}

const METRICS = [
  { group: "working", label: "Working", tone: "running" },
  { group: "attention", label: "Needs you", tone: "warning" },
  { group: "resting", label: "Resting", tone: "idle" },
] as const;
const GROUPS: readonly SessionGroup[] = ["attention", "working", "resting"];
function SectionHeading({
  group,
  rows,
  styles,
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle(): void;
  group: SessionGroup;
  rows: GroupedSession[];
  styles: OfficeStyles;
}) {
  const ui = styles.sessions;
  let title = group === "working" ? "Working" : "Resting";
  let accent: typeof ui.warningText | undefined;
  if (group === "attention") {
    title = rows.every(
      ({ row }) =>
        row.agent.permissions.length > 0 && row.agent.permissions[0]?.kind !== "question",
    )
      ? "Needs your approval"
      : "Needs your attention";
    accent = rows.every(({ row }) => dotTone(row.agent) === "danger")
      ? ui.errorText
      : ui.warningText;
  }
  const headingStyle = useMemo(() => [ui.headingText, accent], [ui, accent]);
  const chevron = useMemo(() => [ui.chevron, expanded ? ui.down : ui.right], [ui, expanded]);
  const heading = (
    <>
      <Text accessibilityRole="header" style={headingStyle}>
        {title}
      </Text>
      <Text style={ui.headingCount}>{rows.length}</Text>
      {group === "resting" ? <View style={chevron} /> : null}
    </>
  );
  if (group !== "resting") return <View style={ui.heading}>{heading}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Resting sessions"
      aria-expanded={expanded}
      onPress={onToggle}
      style={ui.heading}
    >
      {heading}
    </Pressable>
  );
}

/**
 * The Sessions tab of the office's column, fed by the surface's subscription: every agent in one
 * list, under the List view's tabs and search.
 */
export function SessionsPanel(props: ColumnPanelProps) {
  const { link, styles, newAgent } = props;
  const { setOpen, change } = newAgent;
  const open = useCallback(() => setOpen(true), [setOpen]);
  const back = useCallback(() => setOpen(false), [setOpen]);
  const created = useCallback(
    (agentId: string) => {
      setOpen(false);
      change({ prompt: "" });
      link.openSession(agentId);
    },
    [link, setOpen, change],
  );
  if (newAgent.open) {
    return (
      <NewAgentForm
        choice={newAgent.choice}
        change={change}
        onBack={back}
        onCreated={created}
        styles={styles}
      />
    );
  }
  return <SessionList {...props} onNewAgent={open} />;
}

function SessionList({
  office,
  styles,
  link,
  onNewAgent,
}: ColumnPanelProps & { onNewAgent(): void }) {
  const { state, loaded, subscription } = office;
  const [tab, setTab] = useState<ListTab>("all");
  const [restingExpanded, setRestingExpanded] = useState(true);
  const toggleResting = useCallback(() => setRestingExpanded((value) => !value), []);
  const [query, setQuery] = useState("");
  const model = useMemo(() => buildOfficeModel(state), [state]);
  const now = useRowClock(model.rooms);
  // The counts ignore the search, as the List view's do.
  const counts = useMemo(() => tabCounts(model.rooms.flatMap((room) => room.rows)), [model]);
  const shown = useMemo(() => sessionSections(model, tab, query), [model, tab, query]);
  const filtered = tab !== "all" || query.length > 0;
  const reset = useCallback(() => {
    setTab("all");
    setQuery("");
    setRestingExpanded(true);
  }, []);
  const choose = useCallback((next: ListTab) => {
    setTab(next);
    if (next === "resting") setRestingExpanded(true);
  }, []);
  const changeQuery = useCallback((value: string) => {
    setQuery(value);
    if (value.trim()) setRestingExpanded(true);
  }, []);
  const ui = styles.sessions;
  const problem = loadProblem(subscription);
  let status: string | null = null;
  if (!loaded) status = problem === null ? "Loading..." : null;
  else if (counts.all === 0) status = NO_AGENTS;
  else if (GROUPS.every((group) => shown[group].length === 0)) status = NO_MATCH;
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.panelFeed}>
        <View style={ui.top}>
          <View style={ui.actions}>
            <Pressable
              accessibilityRole="tab"
              aria-selected={!filtered}
              accessibilityLabel={filtered ? "Clear filters" : `All, ${counts.all}`}
              onPress={reset}
              style={ui.all}
            >
              <Text style={filtered ? ui.resetText : ui.allText}>
                {filtered ? "Clear filters" : `All sessions · ${counts.all}`}
              </Text>
            </Pressable>
            <ActionButton
              primary
              label="New agent"
              pendingLabel="Opening..."
              onPress={onNewAgent}
              styles={styles}
            />
          </View>
          <View role="group" aria-label="Sessions" style={ui.summary}>
            {METRICS.map(({ group, label, tone }) => (
              <Metric
                key={group}
                group={group}
                label={label}
                tone={tone}
                count={counts[group]}
                chosen={tab === group}
                choose={choose}
                styles={styles}
              />
            ))}
          </View>
          <TextInput
            accessibilityLabel={SEARCH_LABEL}
            placeholder="Search sessions"
            placeholderTextColor={styles.placeholderColor}
            value={query}
            onChangeText={changeQuery}
            style={ui.search}
          />
        </View>
        {problem === null ? null : (
          <View style={styles.bannerSlot}>
            <View style={styles.banner}>
              <Text accessibilityRole="alert" style={styles.bannerText}>
                {problem}
              </Text>
            </View>
          </View>
        )}
        {status === null ? null : <Text style={styles.sceneStatus}>{status}</Text>}
        {GROUPS.map((group) =>
          shown[group].length ? (
            <View key={group} style={ui.section}>
              <SectionHeading
                group={group}
                rows={shown[group]}
                styles={styles}
                expanded={restingExpanded}
                onToggle={toggleResting}
              />
              {(group !== "resting" || restingExpanded) &&
                shown[group].map((entry) => (
                  <AgentRow
                    key={entry.row.agent.id}
                    entry={entry}
                    link={link}
                    styles={styles}
                    now={now}
                    progress={state.checklistProgress?.[entry.row.agent.id]}
                  />
                ))}
            </View>
          ) : null,
        )}
      </ScrollView>
    </View>
  );
}

interface MetricProps {
  group: SessionGroup;
  label: string;
  tone: "running" | "warning" | "idle";
  count: number;
  chosen: boolean;
  choose(tab: ListTab): void;
  styles: OfficeStyles;
}
function Metric({ group, label, tone, count, chosen, choose, styles }: MetricProps) {
  const press = useCallback(() => choose(chosen ? "all" : group), [chosen, choose, group]);
  const ui = styles.sessions;
  const metricStyle = useMemo(() => [ui.metric, chosen && ui.selectedMetric], [ui, chosen]);
  return (
    <Pressable
      accessibilityRole="tab"
      aria-selected={chosen}
      accessibilityLabel={`${label}, ${count}`}
      onPress={press}
      style={metricStyle}
    >
      <View style={ui.metricTop}>
        <View style={styles.dot[count ? tone : "idle"]} />
        <Text style={ui.count}>{count}</Text>
      </View>
      <Text style={ui.caption}>{label}</Text>
    </Pressable>
  );
}
