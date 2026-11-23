import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { ChecklistStep } from "../shared/contracts.js";
import { agentTask, agentTitle, dotTone } from "../shared/model.js";
import { stepMark, workText, type BoardAgent, type BoardTeam } from "./board-text.js";
import type { OfficeStyles } from "./styles.js";

interface StepLine {
  key: string;
  text: string;
}

/**
 * A step's line, with a key: a step has no id, and a checklist may repeat a line ("Run tests"),
 * so the key is the text and how many times it has come so far.
 */
function stepLines(steps: readonly ChecklistStep[]): StepLine[] {
  const seen = new Map<string, number>();
  return steps.map((step) => {
    const count = (seen.get(step.text) ?? 0) + 1;
    seen.set(step.text, count);
    return { key: `${count}:${step.text}`, text: `${stepMark(step.status)} ${step.text}` };
  });
}

/** Lit is under a finger or a pointer. */
function useLit() {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  return {
    lit: hovered || pressed,
    onHoverIn: useCallback(() => setHovered(true), []),
    onHoverOut: useCallback(() => setHovered(false), []),
    onPressIn: useCallback(() => setPressed(true), []),
    onPressOut: useCallback(() => setPressed(false), []),
  };
}

interface BoardAgentRowProps {
  entry: BoardAgent;
  styles: OfficeStyles;
  onSelect(agentId: string): void;
}

/**
 * An agent on a board: its name, what it is at in the whiteboard's words, and the steps left of
 * its own checklist. A press on the name opens the agent, as a press on its desk does. The steps
 * sit under the button, not in it: a button's label replaces its words for a screen reader.
 */
function BoardAgentRow({ entry, styles, onSelect }: BoardAgentRowProps) {
  const { agent } = entry.row;
  const press = useCallback(() => onSelect(agent.id), [onSelect, agent.id]);
  const { lit, ...handlers } = useLit();
  const lines = useMemo(() => stepLines(entry.steps), [entry.steps]);
  const title = agentTitle(agent);
  const task = agentTask(agent);
  const text = workText(entry.row);
  return (
    <View style={styles.boardAgent}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${text}`}
        onPress={press}
        {...handlers}
        style={styles.boardAgentHead}
      >
        {lit ? <View style={styles.pressedFill} /> : null}
        <View style={styles.lead}>
          <View style={styles.dot[dotTone(agent)]} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.boardAgentTitle} numberOfLines={2}>
            {title}
          </Text>
          {task === null ? null : (
            <Text style={styles.rowActivity} numberOfLines={2}>
              {task}
            </Text>
          )}
          <Text style={styles.rowMeta}>{text}</Text>
        </View>
      </Pressable>
      {lines.length === 0 ? null : (
        <View style={styles.boardAgentSteps}>
          {lines.map((line) => (
            <Text key={line.key} style={styles.postText}>
              {line.text}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

export interface BoardAgentsProps {
  agents: readonly BoardAgent[];
  styles: OfficeStyles;
  onSelectAgent(agentId: string): void;
}

/** The agents of one room on a board, in the order given. */
export function BoardAgents({ agents, styles, onSelectAgent }: BoardAgentsProps) {
  return (
    <View style={styles.boardAgents}>
      {agents.map((entry) => (
        <BoardAgentRow
          key={entry.row.agent.id}
          entry={entry}
          styles={styles}
          onSelect={onSelectAgent}
        />
      ))}
    </View>
  );
}

interface TeamHeadingProps {
  team: BoardTeam;
  styles: OfficeStyles;
  onOpenBoard(roomId: string): void;
}

/** A room's name over its agents. It opens that room's board; the lobby's own is the one open. */
function TeamHeading({ team, styles, onOpenBoard }: TeamHeadingProps) {
  const { room } = team;
  const open = useCallback(() => onOpenBoard(room.id), [onOpenBoard, room.id]);
  const { lit, ...handlers } = useLit();
  if (room.lobby) {
    return (
      <View style={styles.boardTeamHead}>
        <Text style={styles.boardTeamName} numberOfLines={1}>
          {room.name}
        </Text>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${room.name} board`}
      onPress={open}
      {...handlers}
      style={styles.boardTeamHead}
    >
      {lit ? <View style={styles.pressedFill} /> : null}
      <Text style={styles.boardTeamName} numberOfLines={1}>
        {room.name}
      </Text>
      <Icon name="ChevronRight" size={16} color={styles.iconColor} />
    </Pressable>
  );
}

export interface BoardTeamsProps {
  teams: readonly BoardTeam[];
  styles: OfficeStyles;
  onSelectAgent(agentId: string): void;
  onOpenBoard(roomId: string): void;
}

/** The lobby's board: each room with someone at work, under the room's name. */
export function BoardTeams({ teams, styles, onSelectAgent, onOpenBoard }: BoardTeamsProps) {
  return (
    <View style={styles.boardTeams}>
      {teams.map((team) => (
        <View key={team.room.id} style={styles.boardTeam}>
          <TeamHeading team={team} styles={styles} onOpenBoard={onOpenBoard} />
          <BoardAgents agents={team.agents} styles={styles} onSelectAgent={onSelectAgent} />
        </View>
      ))}
    </View>
  );
}
