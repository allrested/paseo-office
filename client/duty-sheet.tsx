import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "./text.js";
import { Icon } from "@getpaseo/plugin/client/ui";
import { TextInput } from "./text.js";
import type { Duty } from "../shared/contracts.js";
import {
  DUTY_INSTRUCTIONS_MAX,
  DUTY_MAX,
  DUTY_NAME_MAX,
  dutyListProblem,
  type DutyDraft,
  type DutyRow,
} from "../shared/duties.js";
import { ActionButton } from "./action-button.js";
import { dutyRowTitle, dutyStateText } from "./duty-text.js";
import { DAY_NAMES } from "./notes-days.js";
import { OfficeModal as Modal } from "./office-modal.js";
import { SegmentPill } from "./segment-pill.js";
import type { OfficeStyles } from "./styles.js";
import type { DutyActions } from "./use-duty-actions.js";

const WEEKDAYS = [1, 2, 3, 4, 5];
const HINT =
  "A duty without instructions is pretend: the 3D office acts it out and no agent is asked. One with instructions goes to an idle agent on each of its days, from 08:00 in the notes' time zone.";

/** A duty as the editor holds it: `key` tells the rows apart, a new duty having no id yet. */
interface Draft extends DutyDraft {
  key: string;
  days: number[];
}

function draftsOf(list: readonly Duty[]): Draft[] {
  return list.map((duty) => ({
    key: duty.id,
    id: duty.id,
    name: duty.name,
    instructions: duty.instructions,
    days: [...duty.days],
  }));
}

/** What a save sends: a listed duty with its id, a new one without. */
function sent({ id, name, instructions, days }: Draft): DutyDraft {
  return id === undefined ? { name, instructions, days } : { id, name, instructions, days };
}

interface TodayRowProps {
  row: DutyRow;
  name(author: string): string;
  actions: DutyActions;
  styles: OfficeStyles;
}

/**
 * A duty due today, who has it, and the owner's hand: Mark done until it is done, and Reopen once
 * someone has it or it is done, so a duty held by an agent that has gone is not stuck.
 */
function TodayRow({ row, name, actions, styles }: TodayRowProps) {
  const title = dutyRowTitle(row);
  const done = row.post.state === "done";
  const held = done || row.post.state === "claimed";
  const { id } = row.post;
  const reopen = useCallback(() => actions.reopen(id), [actions, id]);
  const markDone = useCallback(() => actions.markDone(id), [actions, id]);
  return (
    <View style={styles.dutyCard}>
      <View style={styles.post}>
        <Text style={done ? styles.todoTextDone : styles.rowTitle}>{title}</Text>
        <Text style={styles.postMeta}>{dutyStateText(row, name)}</Text>
      </View>
      <View style={styles.actions}>
        {held ? (
          <ActionButton
            label="Reopen"
            name={`Reopen ${title}`}
            pendingLabel="Saving..."
            onPress={reopen}
            styles={styles}
          />
        ) : null}
        {done ? null : (
          <ActionButton
            label="Mark done"
            name={`Mark ${title} done`}
            pendingLabel="Saving..."
            onPress={markDone}
            styles={styles}
          />
        )}
      </View>
    </View>
  );
}

interface DutyDaysProps {
  label: string;
  days: readonly number[];
  onToggle(day: number): void;
  styles: OfficeStyles;
}

/** The days a duty is due, Sunday to Saturday, as the stand-up days are chosen. */
function DutyDays({ label, days, onToggle, styles }: DutyDaysProps) {
  return (
    <View role="group" aria-label={label} style={styles.notesDays}>
      {DAY_NAMES.map((dayName, day) => (
        <SegmentPill
          key={dayName}
          value={day}
          name={dayName}
          text={dayName.slice(0, 3)}
          on={days.includes(day)}
          disabled={false}
          onPress={onToggle}
          styles={styles}
        />
      ))}
    </View>
  );
}

interface DutyFieldsProps {
  index: number;
  draft: Draft;
  onChange(key: string, patch: Partial<Draft>): void;
  onRemove(key: string): void;
  styles: OfficeStyles;
}

/** One duty of the list: its name, its instructions for an agent, its days, and Remove. */
function DutyFields({ index, draft, onChange, onRemove, styles }: DutyFieldsProps) {
  const { key, days } = draft;
  const n = index + 1;
  const setName = useCallback((name: string) => onChange(key, { name }), [onChange, key]);
  const setInstructions = useCallback(
    (instructions: string) => onChange(key, { instructions }),
    [onChange, key],
  );
  const toggle = useCallback(
    (day: number) =>
      onChange(key, {
        days: days.includes(day)
          ? days.filter((other) => other !== day)
          : [...days, day].sort((a, b) => a - b),
      }),
    [onChange, key, days],
  );
  const remove = useCallback(() => onRemove(key), [onRemove, key]);
  return (
    <View style={styles.dutyCard}>
      <View style={styles.lobbyTaskLine}>
        <View style={styles.rowBody}>
          <TextInput
            accessibilityLabel={`Duty ${n} name`}
            value={draft.name}
            onChangeText={setName}
            placeholder="Name"
            placeholderTextColor={styles.placeholderColor}
            maxLength={DUTY_NAME_MAX}
            style={styles.fieldInput}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${draft.name.trim() || `duty ${n}`}`}
          onPress={remove}
          style={styles.lobbyDelete}
        >
          <Icon name="Trash2" size={16} color={styles.iconColor} />
        </Pressable>
      </View>
      <TextInput
        accessibilityLabel={`Duty ${n} instructions`}
        value={draft.instructions}
        onChangeText={setInstructions}
        placeholder="Instructions for an agent (none: a pretend duty)"
        placeholderTextColor={styles.placeholderColor}
        maxLength={DUTY_INSTRUCTIONS_MAX}
        multiline
        style={styles.input}
      />
      <DutyDays label={`Duty ${n} days`} days={days} onToggle={toggle} styles={styles} />
    </View>
  );
}

interface DutyListProps {
  list: readonly Duty[];
  actions: DutyActions;
  styles: OfficeStyles;
}

/** The list as the owner edits it, saved whole; until an edit it is the host's list. */
function DutyList({ list, actions, styles }: DutyListProps) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const shown = useMemo(() => drafts ?? draftsOf(list), [drafts, list]);
  const added = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const edit = useCallback(
    (next: (current: Draft[]) => Draft[]) =>
      setDrafts((current) => next(current ?? draftsOf(list))),
    [list],
  );
  const change = useCallback(
    (key: string, patch: Partial<Draft>) =>
      edit((current) =>
        current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)),
      ),
    [edit],
  );
  const remove = useCallback(
    (key: string) => edit((current) => current.filter((draft) => draft.key !== key)),
    [edit],
  );
  const add = useCallback(() => {
    added.current += 1;
    const key = `new-${added.current}`;
    edit((current) => [...current, { key, name: "", instructions: "", days: [...WEEKDAYS] }]);
  }, [edit]);
  const save = useCallback(async () => {
    const duties = shown.map(sent);
    const problem = dutyListProblem(duties);
    if (problem !== null) throw new Error(problem);
    await actions.save(duties);
    // Saved: the host's list, with the new duties' ids, is what shows from now.
    if (mounted.current) setDrafts(null);
  }, [shown, actions]);
  return (
    <View style={styles.lobbySection}>
      <Text accessibilityRole="header" style={styles.lobbyHeading}>
        Duties
      </Text>
      <Text style={styles.fieldHint}>{HINT}</Text>
      {shown.map((draft, index) => (
        <DutyFields
          key={draft.key}
          index={index}
          draft={draft}
          onChange={change}
          onRemove={remove}
          styles={styles}
        />
      ))}
      <View style={styles.actions}>
        <ActionButton
          label="Add duty"
          name="Add a duty"
          pendingLabel="Adding..."
          onPress={add}
          disabled={shown.length >= DUTY_MAX}
          styles={styles}
        />
        <ActionButton
          label="Save"
          name="Save duties"
          pendingLabel="Saving..."
          onPress={save}
          disabled={drafts === null}
          styles={styles}
          primary
        />
      </View>
    </View>
  );
}

export interface DutySheetProps {
  open: boolean;
  /** The duty list; null until the host has sent it. */
  list: readonly Duty[] | null;
  /** The day's duties: today's posts and the owed ones. */
  rows: readonly DutyRow[];
  name(author: string): string;
  actions: DutyActions;
  styles: OfficeStyles;
  onClose(): void;
}

/**
 * The duty board: today's duties with who has each, and the list the host posts them from. A
 * duty with instructions goes to an idle agent; one without is acted out in the 3D office.
 */
export function DutySheet({ open, list, rows, name, actions, styles, onClose }: DutySheetProps) {
  const change = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  const icon = useMemo(
    () => <Icon name="ClipboardCheck" size={18} color={styles.iconColor} />,
    [styles.iconColor],
  );
  return (
    <Modal title="Duty board" icon={icon} open={open} onOpenChange={change}>
      <Modal.Content>
        <View style={styles.sheet}>
          <View style={styles.lobbySection}>
            <Text accessibilityRole="header" style={styles.lobbyHeading}>
              Today
            </Text>
            {rows.length === 0 ? <Text style={styles.muted}>No duty is due today.</Text> : null}
            {rows.map((row) => (
              <TodayRow key={row.post.id} row={row} name={name} actions={actions} styles={styles} />
            ))}
          </View>
          {list === null ? (
            <Text style={styles.muted}>Loading the duty list...</Text>
          ) : (
            <DutyList list={list} actions={actions} styles={styles} />
          )}
        </View>
      </Modal.Content>
    </Modal>
  );
}
