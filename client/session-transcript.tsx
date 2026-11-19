import { type Appearance, AVATARS, shirtColor } from "../shared/appearance.js";
import { memo, useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon, Markdown } from "@getpaseo/plugin/client/ui";
import { readLobbyAssignment } from "../shared/lobby-assignment.js";
import type { ConversationRow } from "./conversation-model.js";
import { NOTHING_SAID, rowLabel } from "./session-text.js";
import { avatarInitials } from "./sessions-text.js";
import type { OfficeStyles } from "./styles.js";

type Tool = Extract<ConversationRow, { kind: "tool" }>;
interface RowProps {
  appearance?: Appearance;
  row: ConversationRow;
  name: string;
  styles: OfficeStyles;
}

function Assignment({
  task,
  original,
  styles,
}: {
  task: { id: string; body: string; kind: "lobby" | "duty" };
  original: string;
  styles: OfficeStyles;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((current) => !current), []);
  const s = styles.transcript;
  const what = task.kind === "duty" ? "Duty" : "Lobby task";
  return (
    <View style={s.assignment}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${what} ${task.id}, original message`}
        aria-expanded={expanded}
        onPress={toggle}
        style={s.disclosure}
      >
        <Icon name="ClipboardList" size={15} color={styles.brandIcon.color} />
        <Text style={s.stepTitle}>{what}</Text>
        <Text style={s.taskId}>{task.id}</Text>
        <Icon
          name={expanded ? "ChevronUp" : "ChevronDown"}
          size={14}
          color={styles.placeholderColor}
        />
      </Pressable>
      <Text selectable style={s.text}>
        {task.body}
      </Text>
      {expanded && (
        <View style={s.raw}>
          <Text selectable style={s.code}>
            {original}
          </Text>
        </View>
      )}
    </View>
  );
}

function sameRow(before: RowProps, after: RowProps): boolean {
  const [a, b] = [before.row, after.row];
  return (
    before.name === after.name &&
    before.appearance?.avatar === after.appearance?.avatar &&
    before.appearance?.color === after.appearance?.color &&
    before.styles === after.styles &&
    a.kind === b.kind &&
    a.key === b.key &&
    a.text === b.text &&
    (a.kind !== "notice" || (b.kind === "notice" && a.tone === b.tone)) &&
    (a.kind !== "tool" || (b.kind === "tool" && a.outcome === b.outcome))
  );
}

/** Streamed messages update only their own row. Tool lines retain their accessibility labels. */
const Row = memo(function Row({ row, name, appearance, styles }: RowProps) {
  const s = styles.transcript;
  const label = rowLabel(row, name);
  const borderColor = shirtColor(appearance);
  const avatarStyle = useMemo(
    () => [s.avatar, borderColor && { borderColor, borderWidth: 2 }],
    [s.avatar, borderColor],
  );
  switch (row.kind) {
    case "tool": {
      const status = row.outcome === "failed" ? s.danger : s.warning;
      return (
        <Text
          accessibilityLabel={label}
          selectable
          numberOfLines={1}
          style={row.outcome ? StyleSheet.compose(s.code, status) : s.code}
        >
          {row.text}
        </Text>
      );
    }
    case "notice": {
      const danger = row.tone === "danger";
      return (
        <View style={danger ? StyleSheet.compose(s.notice, s.errorNotice) : s.notice}>
          <Text
            accessibilityLabel={label}
            accessibilityRole={danger ? "alert" : undefined}
            selectable
            style={danger ? StyleSheet.compose(s.text, s.danger) : styles.chatMeta}
          >
            {row.text}
          </Text>
        </View>
      );
    }
    case "you": {
      const task = readLobbyAssignment(row.text);
      if (task) return <Assignment task={task} original={row.text} styles={styles} />;
      return (
        <View accessibilityLabel={label} style={s.outgoing}>
          <Text style={s.name}>You</Text>
          <Text selectable style={s.text}>
            {row.text}
          </Text>
        </View>
      );
    }
    case "agent":
      return (
        <View accessibilityLabel={label} style={s.assistant}>
          <View style={s.speaker}>
            <View aria-hidden style={avatarStyle}>
              <Text style={s.initials}>
                {appearance?.avatar ? AVATARS[appearance.avatar] : avatarInitials(name)}
              </Text>
            </View>
            <Text style={s.name}>{name}</Text>
          </View>
          <Markdown>{row.text}</Markdown>
        </View>
      );
  }
}, sameRow);

function ToolRun({ rows, name, styles }: { rows: Tool[]; name: string; styles: OfficeStyles }) {
  const [expanded, setExpanded] = useState(false);
  const [hovered, setHovered] = useState(false);
  const toggle = useCallback(() => setExpanded((current) => !current), []);
  const enter = useCallback(() => setHovered(true), []);
  const leave = useCallback(() => setHovered(false), []);
  const s = styles.transcript;
  return (
    <View style={s.steps}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${rows.length} tool steps`}
        aria-expanded={expanded}
        onPress={toggle}
        onHoverIn={enter}
        onHoverOut={leave}
        style={hovered ? StyleSheet.compose(s.stepButton, s.pressed) : s.stepButton}
      >
        <Icon name="Terminal" size={14} color={styles.placeholderColor} />
        <Text style={s.stepTitle}>{rows.length} tool steps</Text>
        <Icon
          name={expanded ? "ChevronUp" : "ChevronDown"}
          size={14}
          color={styles.placeholderColor}
        />
      </Pressable>
      {expanded && (
        <View style={s.stepList}>
          {rows.map((row) => (
            <Row key={row.key} row={row} name={name} styles={styles} />
          ))}
        </View>
      )}
    </View>
  );
}

/** Errors and canceled steps remain in chronological order even when the surrounding run is folded. */
function displayRows(
  rows: readonly ConversationRow[],
  steps: boolean,
): (ConversationRow | Tool[])[] {
  if (steps) return rows.filter((row) => row.kind === "tool" || row.kind === "notice");
  const result: (ConversationRow | Tool[])[] = [];
  let run: Tool[] | null = null;
  for (const row of rows) {
    if (row.kind === "tool" && !row.outcome) {
      if (run === null) {
        run = [];
        result.push(run);
      }
      run.push(row);
    } else {
      run = null;
      result.push(row);
    }
  }
  return result;
}

export function SessionTranscript({
  appearance,
  rows,
  steps,
  name,
  styles,
}: {
  rows: readonly ConversationRow[];
  appearance?: Appearance;
  steps: boolean;
  name: string;
  styles: OfficeStyles;
}) {
  const entries = useMemo(() => displayRows(rows, steps), [rows, steps]);
  if (!entries.length)
    return (
      <Text style={styles.muted}>{steps ? "No steps in the loaded history." : NOTHING_SAID}</Text>
    );
  return (
    <View style={steps ? styles.transcript.steps : styles.transcript.messages}>
      {entries.map((entry) => {
        if (Array.isArray(entry) && entry.length > 1)
          return <ToolRun key={entry[0].key} rows={entry} name={name} styles={styles} />;
        const row = Array.isArray(entry) ? entry[0] : entry;
        return <Row appearance={appearance} key={row.key} row={row} name={name} styles={styles} />;
      })}
    </View>
  );
}
