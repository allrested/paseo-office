import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import {
  MEMBER_NAME_MAX,
  ROSTER_MEMBERS_MAX,
  ROSTER_TEAMS_MAX,
  nextEdition,
  rosterOf,
  type RosterTeam,
} from "../shared/roster.js";
import { TEAM_NAME_MAX } from "../shared/team-name.js";
import type { HostValues } from "./host-switches.js";
import { LabeledSwitch } from "./labeled-switch.js";
import type { OfficeStyles } from "./styles.js";
import {
  TEAMS_LABEL,
  addMember,
  addTeam,
  moveMember,
  moveTeam,
  newId,
  removeMember,
  removeTeam,
  renameMember,
  renameTeam,
  type RosterHolders,
  seatedLine,
} from "./teams-text.js";

const SWITCH_LABEL = "Name teams and agents from the roster";
const INTRO =
  "Agents fill the first team, then the next: each takes a free teammate, by chance, and sits " +
  "with that team on the 3D floor whatever its workspace. An agent the roster has nobody left " +
  "for keeps its own name and its workspace's team. Paseo's own names stay. A name you type " +
  "on a team or an agent wins.";

const layout = StyleSheet.create({
  // One column the width of the page: each row then shrinks its name to make room for its buttons.
  section: { gap: 14, alignSelf: "stretch" },
  team: { gap: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  field: { flex: 1, minWidth: 0 },
  // A touch target, whatever the label's length.
  button: { minHeight: 44, minWidth: 44, paddingHorizontal: 10, justifyContent: "center" },
  // Three of these beside a name leave the name room on a phone: a word each did not fit.
  iconButton: { height: 44, width: 44, alignItems: "center", justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
});

const NO_TEAMS: RosterTeam[] = [];

interface Draft {
  on: boolean;
  teams: RosterTeam[];
}

/** One change to the roster, read off the list as it stands when the change is saved. */
type Edit = (draft: Draft) => Draft;

type EditRoster = (edit: Edit) => Promise<boolean>;

interface Queued {
  edit: Edit;
  answer(saved: boolean): void;
}

interface TeamsSettingsProps {
  /** Null while the settings are read or cannot be read: nothing can then be changed. */
  values: HostValues | null;
  /** The revision the values were read at; it changes when the host keeps a save. */
  revision: string | null;
  /** Resolves false when the host refuses the save; never rejects. */
  change(setting: typeof TEAMS_LABEL, patch: Partial<HostValues>): Promise<boolean>;
  problem: string | null;
  holders: RosterHolders;
  styles: OfficeStyles;
}

/** The same switch position and the same teams, team for team and teammate for teammate. */
function sameRoster(draft: Draft, values: HostValues): boolean {
  if (draft.on !== values.rosterOn || draft.teams.length !== values.teams.length) return false;
  return draft.teams.every((team, at) => {
    const kept = values.teams[at];
    return (
      team.id === kept.id &&
      team.name === kept.name &&
      team.members.length === kept.members.length &&
      team.members.every(
        (member, place) =>
          member.id === kept.members[place].id && member.name === kept.members[place].name,
      )
    );
  });
}

/**
 * The roster: a switch, then the teams in the order they are handed out, each with its teammates.
 * Every change is one save of the whole list, with the edition a longer list or the switch
 * going on calls for. The saves go one at a time, each from the values the host last kept, so an
 * edit made before the last one is answered is saved after it, on top of it. An edit that leaves
 * the roster as it is saves nothing.
 */
export function TeamsSettings({
  values,
  revision,
  change,
  problem,
  holders,
  styles,
}: TeamsSettingsProps) {
  const latest = useRef({ values, revision, change });
  latest.current = { values, revision, change };
  const queue = useRef<Queued[]>([]);
  // A save that kept its values is followed only once the host has drawn them: the values are a
  // new object on every draw, so only a new revision says they are the kept ones.
  const last = useRef<{ busy: boolean; kept: boolean; from: string | null }>({
    busy: false,
    kept: false,
    from: null,
  });
  const mounted = useRef(true);
  const [answered, setAnswered] = useState(0);
  const drain = useCallback(() => {
    const { values: current, revision: read, change: save } = latest.current;
    if (last.current.busy || queue.current.length === 0) return;
    if (current === null) {
      for (const { answer } of queue.current.splice(0)) answer(false);
      return;
    }
    if (last.current.kept && last.current.from === read) return;
    const taken = queue.current.splice(0);
    const draft = taken.reduce<Draft>((now, { edit }) => edit(now), {
      on: current.rosterOn,
      teams: current.teams,
    });
    if (sameRoster(draft, current)) {
      for (const { answer } of taken) answer(true);
      return;
    }
    const rosterEdition = nextEdition(rosterOf(current), draft);
    last.current = { busy: true, kept: false, from: read };
    void save(TEAMS_LABEL, { rosterOn: draft.on, rosterEdition, teams: draft.teams }).then(
      (kept) => {
        last.current = { busy: false, kept, from: read };
        for (const { answer } of taken) answer(kept);
        if (mounted.current) setAnswered((count) => count + 1);
        return kept;
      },
    );
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(drain, [drain, values, revision, answered]);
  const edit = useCallback<EditRoster>(
    (next) =>
      new Promise<boolean>((answer) => {
        queue.current.push({ edit: next, answer });
        drain();
      }),
    [drain],
  );
  const on = values?.rosterOn ?? false;
  const teams = values?.teams ?? NO_TEAMS;
  const toggle = useCallback(
    (next: boolean) => void edit((draft) => ({ ...draft, on: next })),
    [edit],
  );
  const appendTeam = useCallback(() => {
    const id = newId("t");
    void edit((draft) => ({ ...draft, teams: addTeam(draft.teams, id) }));
  }, [edit]);
  return (
    <View style={layout.section}>
      <LabeledSwitch
        label={SWITCH_LABEL}
        value={values === null ? null : on}
        onChange={toggle}
        styles={styles}
      />
      <Text style={styles.fieldHint}>{INTRO}</Text>
      {teams.map((team) => (
        <TeamBlock key={team.id} team={team} edit={edit} holders={holders} styles={styles} />
      ))}
      {values !== null && teams.length < ROSTER_TEAMS_MAX && (
        <TextButton label="Add team" text="Add team" onPress={appendTeam} styles={styles} />
      )}
      {problem && (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {problem}
        </Text>
      )}
    </View>
  );
}

interface TeamBlockProps {
  team: RosterTeam;
  edit: EditRoster;
  holders: RosterHolders;
  styles: OfficeStyles;
}

function TeamBlock({ team, edit, holders, styles }: TeamBlockProps) {
  const rename = useCallback(
    (name: string) =>
      edit((draft) => ({ ...draft, teams: renameTeam(draft.teams, team.id, name) })),
    [edit, team.id],
  );
  const up = useCallback(
    () => void edit((draft) => ({ ...draft, teams: moveTeam(draft.teams, team.id, -1) })),
    [edit, team.id],
  );
  const down = useCallback(
    () => void edit((draft) => ({ ...draft, teams: moveTeam(draft.teams, team.id, 1) })),
    [edit, team.id],
  );
  const remove = useCallback(
    () => void edit((draft) => ({ ...draft, teams: removeTeam(draft.teams, team.id) })),
    [edit, team.id],
  );
  const append = useCallback(() => {
    const id = newId("m");
    void edit((draft) => ({ ...draft, teams: addMember(draft.teams, team.id, id) }));
  }, [edit, team.id]);
  return (
    <View
      style={StyleSheet.compose(layout.team, {
        borderTopColor: styles.sidebarButton.borderColor,
      })}
    >
      <View style={layout.row}>
        <NameField
          label={`${team.name} name`}
          value={team.name}
          max={TEAM_NAME_MAX}
          onSave={rename}
          styles={styles}
        />
        <TextButton label={`Move ${team.name} up`} icon="ChevronUp" onPress={up} styles={styles} />
        <TextButton
          label={`Move ${team.name} down`}
          icon="ChevronDown"
          onPress={down}
          styles={styles}
        />
        <TextButton
          label={`Remove team ${team.name}`}
          icon="Trash2"
          onPress={remove}
          styles={styles}
        />
      </View>
      <Text style={styles.fieldHint}>{seatedLine(team, holders)}</Text>
      {team.members.map((member, at) => (
        <MemberRow
          key={member.id}
          team={team}
          at={at}
          edit={edit}
          held={holders.members.has(member.id)}
          styles={styles}
        />
      ))}
      {team.members.length < ROSTER_MEMBERS_MAX && (
        <TextButton
          label={`Add teammate to ${team.name}`}
          text="Add teammate"
          onPress={append}
          styles={styles}
        />
      )}
    </View>
  );
}

interface MemberRowProps {
  team: RosterTeam;
  at: number;
  edit: EditRoster;
  held: boolean;
  styles: OfficeStyles;
}

function MemberRow({ team, at, edit, held, styles }: MemberRowProps) {
  const member = team.members[at];
  const rename = useCallback(
    (name: string) =>
      edit((draft) => ({ ...draft, teams: renameMember(draft.teams, team.id, member.id, name) })),
    [edit, team.id, member.id],
  );
  const up = useCallback(
    () =>
      void edit((draft) => ({ ...draft, teams: moveMember(draft.teams, team.id, member.id, -1) })),
    [edit, team.id, member.id],
  );
  const down = useCallback(
    () =>
      void edit((draft) => ({ ...draft, teams: moveMember(draft.teams, team.id, member.id, 1) })),
    [edit, team.id, member.id],
  );
  const remove = useCallback(
    () =>
      void edit((draft) => ({ ...draft, teams: removeMember(draft.teams, team.id, member.id) })),
    [edit, team.id, member.id],
  );
  return (
    <View style={layout.row}>
      {held && (
        <View
          accessibilityLabel={`${member.name}, at a desk`}
          style={StyleSheet.compose(layout.dot, { backgroundColor: styles.workspaceAccent })}
        />
      )}
      <NameField
        label={`${team.name} teammate ${at + 1}`}
        value={member.name}
        max={MEMBER_NAME_MAX}
        onSave={rename}
        styles={styles}
      />
      <TextButton label={`Move ${member.name} up`} icon="ChevronUp" onPress={up} styles={styles} />
      <TextButton
        label={`Move ${member.name} down`}
        icon="ChevronDown"
        onPress={down}
        styles={styles}
      />
      <TextButton label={`Remove ${member.name}`} icon="Trash2" onPress={remove} styles={styles} />
    </View>
  );
}

interface NameFieldProps {
  label: string;
  value: string;
  max: number;
  /** Resolves once the host has answered, and never rejects. */
  onSave(next: string): Promise<boolean>;
  styles: OfficeStyles;
}

/** A name that saves when it is submitted or loses focus, as SettingField does; a refused or empty one goes back. */
function NameField({ label, value, max, onSave, styles }: NameFieldProps) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [draft, setDraft] = useState<string | null>(null);
  // A submit blurs the field too: one save, not a second.
  const saving = useRef(false);
  const commit = useCallback(() => {
    if (draft === null || saving.current) return;
    const next = draft.trim();
    if (next === "" || next === value) {
      setDraft(null);
      return;
    }
    saving.current = true;
    void onSave(next).finally(() => {
      saving.current = false;
      if (mounted.current) setDraft(null);
    });
  }, [draft, value, onSave]);
  return (
    <View style={layout.field}>
      <TextInput
        accessibilityLabel={label}
        value={draft ?? value}
        maxLength={max}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        autoCorrect={false}
        spellCheck={false}
        style={styles.fieldInput}
      />
    </View>
  );
}

interface TextButtonProps {
  label: string;
  /** The words on the button, or the icon that stands for its label. */
  text?: string;
  icon?: "ChevronUp" | "ChevronDown" | "Trash2";
  onPress(): void;
  styles: OfficeStyles;
}

function TextButton({ label, text, icon, onPress, styles }: TextButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={StyleSheet.compose(
        styles.workspaceAction,
        icon === undefined ? layout.button : layout.iconButton,
      )}
    >
      {icon === undefined ? (
        <Text style={styles.sidebarButtonText}>{text}</Text>
      ) : (
        <Icon name={icon} size={18} color={styles.iconColor} />
      )}
    </Pressable>
  );
}
