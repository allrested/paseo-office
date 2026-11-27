import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ActionButton } from "./action-button.js";
import { LabeledSwitch } from "./labeled-switch.js";
import { SegmentPill } from "./segment-pill.js";
import {
  matchingCommands,
  commandWord,
  sessionOptions,
  type SessionCommand,
  type SessionOption,
} from "./session-extras.js";
import type { OfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";

export const NO_OPTIONS = "This session has no options to change here.";

/**
 * The session's slash commands, read once the first "/" is typed: the provider answers from the
 * running session, so the list has its own commands and skills. Empty until then, and where the
 * host or the provider lists none.
 */
function useCommands(agentId: string, actions: AgentActions, wanted: boolean): SessionCommand[] {
  const [commands, setCommands] = useState<SessionCommand[]>([]);
  const { commands: read } = actions;
  useEffect(() => {
    if (!wanted || read === undefined) return undefined;
    let current = true;
    void (async () => {
      try {
        const listed = await read(agentId);
        if (current) setCommands(listed);
      } catch {
        // No list: the command can still be typed whole and sent.
      }
    })();
    return () => {
      current = false;
    };
  }, [agentId, read, wanted]);
  return commands;
}

function CommandRow({
  command,
  onPick,
  styles,
}: {
  command: SessionCommand;
  onPick(name: string): void;
  styles: OfficeStyles;
}) {
  const press = useCallback(() => onPick(command.name), [onPick, command.name]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`/${command.name}: ${command.description}`}
      onPress={press}
      style={styles.machineRow}
    >
      <Text style={styles.permissionTitle}>{`/${command.name}`}</Text>
      <Text style={styles.rowMeta} numberOfLines={1}>
        {command.description}
      </Text>
    </Pressable>
  );
}

interface CommandListProps {
  agentId: string;
  text: string;
  actions: AgentActions;
  /** Puts the command in the reply box, with a space after it for what it takes. */
  onPick(text: string): void;
  styles: OfficeStyles;
}

/** Over the reply box while a slash command is typed: the session's commands that match. */
export function CommandList({ agentId, text, actions, onPick, styles }: CommandListProps) {
  const typing = commandWord(text) !== null;
  // Once asked for, the list stays for the panel's life: the word typed only filters it.
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (typing) setAsked(true);
  }, [typing]);
  const commands = useCommands(agentId, actions, asked);
  const pick = useCallback((name: string) => onPick(`/${name} `), [onPick]);
  const shown = matchingCommands(commands, text);
  if (shown.length === 0) return null;
  return (
    <View role="list" aria-label="Slash commands" style={styles.janitorRows}>
      {shown.map((command) => (
        <CommandRow key={command.name} command={command} onPick={pick} styles={styles} />
      ))}
    </View>
  );
}

interface OptionProps {
  option: SessionOption;
  onChange(key: string, value: string | boolean): void;
  styles: OfficeStyles;
}

function Option({ option, onChange, styles }: OptionProps) {
  const { key } = option;
  const toggle = useCallback((next: boolean) => onChange(key, next), [onChange, key]);
  const choose = useCallback((next: string) => onChange(key, next), [onChange, key]);
  if (option.type === "toggle") {
    return (
      <View style={styles.headerField}>
        <LabeledSwitch
          label={option.label}
          value={option.value}
          onChange={toggle}
          styles={styles}
        />
        {option.hint === null ? null : <Text style={styles.fieldHint}>{option.hint}</Text>}
      </View>
    );
  }
  return (
    <View style={styles.headerField}>
      <Text style={styles.sheetLabel}>{option.label}</Text>
      <View role="group" aria-label={option.label} style={styles.notesDays}>
        {option.choices.map((choice) => (
          <SegmentPill
            key={choice.value}
            value={choice.value}
            name={choice.label}
            on={option.value === choice.value}
            disabled={false}
            onPress={choose}
            styles={styles}
          />
        ))}
      </View>
      {option.hint === null ? null : <Text style={styles.fieldHint}>{option.hint}</Text>}
    </View>
  );
}

interface OptionsProps {
  agentId: string;
  actions: AgentActions;
  styles: OfficeStyles;
}

/**
 * The session's own options behind an Options button: what its provider lets a client change (a
 * model, a mode, a switch), read when the button opens them. A change is sent at once and shown
 * as the provider then reports it; one it refuses says why under the options.
 */
export function SessionOptions({ agentId, actions, styles }: OptionsProps) {
  const { controls, setOption } = actions;
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<SessionOption[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const read = useCallback(async () => {
    if (controls === undefined) return;
    const answer = await controls(agentId);
    setOptions(sessionOptions(answer?.controls, answer?.options));
  }, [controls, agentId]);
  const toggle = useCallback(async () => {
    setProblem(null);
    if (!open) await read();
    setOpen(!open);
  }, [open, read]);
  const change = useCallback(
    (key: string, value: string | boolean) => {
      if (setOption === undefined) return;
      setProblem(null);
      void (async () => {
        try {
          await setOption(agentId, key, value);
          await read();
        } catch (error) {
          setProblem(error instanceof Error ? error.message : "The option was not changed");
        }
      })();
    },
    [setOption, agentId, read],
  );
  if (controls === undefined || setOption === undefined) return null;
  return (
    <View style={styles.headerField}>
      <View style={styles.actions}>
        <ActionButton
          label={open ? "Hide options" : "Options"}
          pendingLabel="Reading..."
          name={open ? "Hide session options" : "Session options"}
          onPress={toggle}
          styles={styles}
        />
      </View>
      {open && options !== null && options.length === 0 ? (
        <Text style={styles.muted}>{NO_OPTIONS}</Text>
      ) : null}
      {open && options !== null
        ? options.map((option) => (
            <Option key={option.key} option={option} onChange={change} styles={styles} />
          ))
        : null}
      {problem === null ? null : (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {problem}
        </Text>
      )}
    </View>
  );
}
