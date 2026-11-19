import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { agentTitle, buildOfficeModel, dotTone } from "../shared/model.js";
import { loadProblem, Pill } from "./activity-panel.js";
import { stateLabel } from "./agent-card.js";
import { ActionButton } from "./action-button.js";
import { NewAgentForm } from "./new-agent-form.js";
import { LIST_TABS, NO_MATCH, SEARCH_LABEL, tabCounts, type ListTab } from "./list-text.js";
import type { ColumnPanelProps, OfficeLink } from "./office-link.js";
import { NO_AGENTS, sessionRows, type SessionRow } from "./sessions-text.js";
import type { OfficeStyles } from "./styles.js";

interface AgentRowProps {
  entry: SessionRow;
  /** The last sub-agent of its parent. */
  endsGroup: boolean;
  link: OfficeLink;
  styles: OfficeStyles;
}

function AgentRow({ entry, endsGroup, link, styles }: AgentRowProps) {
  const { row, room } = entry;
  const { agent } = row;
  const child = row.depth === 1;
  const press = useCallback(() => link.select(agent.id), [agent.id, link]);
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  const lit = pressed || hovered;
  const title = agentTitle(agent);
  const tone = dotTone(agent);
  const state = stateLabel(agent);
  let wrapper = child ? undefined : styles.rowDivider;
  if (child && endsGroup) wrapper = styles.rowGroupEnd;
  return (
    <View style={wrapper}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${state}`}
        onPress={press}
        onPressIn={pressIn}
        onPressOut={pressOut}
        onHoverIn={hoverIn}
        onHoverOut={hoverOut}
        style={child ? styles.rowChild : styles.row}
      >
        {lit ? <View style={styles.pressedFill} /> : null}
        <View style={styles.lead}>
          <View style={styles.dot[tone]} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {room.name}
          </Text>
          {row.activity ? (
            <Text style={styles.rowActivity} numberOfLines={1}>
              {row.activity}
            </Text>
          ) : (
            <Text style={styles.rowState[tone]} numberOfLines={1}>
              {state}
            </Text>
          )}
        </View>
      </Pressable>
    </View>
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
  const [query, setQuery] = useState("");
  const model = useMemo(() => buildOfficeModel(state), [state]);
  // The counts ignore the search, as the List view's do.
  const counts = useMemo(() => tabCounts(model.rooms.flatMap((room) => room.rows)), [model]);
  const shown = useMemo(() => sessionRows(model, tab, query), [model, tab, query]);
  const problem = loadProblem(subscription);
  let status: string | null = null;
  if (!loaded) status = problem === null ? "Loading..." : null;
  else if (counts.all === 0) status = NO_AGENTS;
  else if (shown.length === 0) status = NO_MATCH;
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.panelFeed}>
        <View style={styles.panelTop}>
          <View style={styles.sessionTools}>
            <TextInput
              accessibilityLabel={SEARCH_LABEL}
              placeholder={SEARCH_LABEL}
              placeholderTextColor={styles.placeholderColor}
              value={query}
              onChangeText={setQuery}
              style={styles.sessionSearch}
            />
            <ActionButton
              primary
              label="New agent"
              pendingLabel="Opening..."
              onPress={onNewAgent}
              styles={styles}
            />
          </View>
          <View role="group" aria-label="Sessions" style={styles.panelChips}>
            {[LIST_TABS.slice(0, 2), LIST_TABS.slice(2)].map((pair) => (
              <View key={pair[0].tab} style={styles.sessionFilterPair}>
                {pair.map(({ tab: each, label }) => (
                  <Pill<ListTab>
                    key={each}
                    compact
                    value={each}
                    label={label}
                    name={`${label}, ${counts[each]}`}
                    count={counts[each]}
                    on={each === tab}
                    toggle={false}
                    onPress={setTab}
                    styles={styles}
                  />
                ))}
              </View>
            ))}
          </View>
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
        {shown.map((entry, index) => (
          <AgentRow
            key={entry.row.agent.id}
            entry={entry}
            endsGroup={entry.row.depth === 1 && shown[index + 1]?.row.depth !== 1}
            link={link}
            styles={styles}
          />
        ))}
      </ScrollView>
    </View>
  );
}
