import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { TextInput } from "@getpaseo/plugin/client/ui";
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
  moved,
  newId,
  removeMember,
  removeTeam,
  renameMember,
  renameTeam,
  type RosterHolders,
} from "./teams-text.js";

const SWITCH_LABEL = "Name teams and agents from the roster";
const INTRO =
  "Each workspace takes the first free team, oldest first, and each agent in it the first free " +
  "teammate. Paseo's own names stay. A name you type on a team or an agent wins.";

const layout = StyleSheet.create({
  team: { gap: 8, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  field: { flex: 1, minWidth: 0 },
  // A touch target, whatever the label's length.
  button: { minHeight: 44, minWidth: 44, paddingHorizontal: 10, justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
});

const NO_TEAMS: RosterTeam[] = [];

interface TeamsSettingsProps {
  /** Null while the settings are read or cannot be read: nothing can then be changed. */
  values: HostValues | null;
  /** Resolves false when the host refuses the save; never rejects. */
  change(setting: typeof TEAMS_LABEL, patch: Partial<HostValues>): Promise<boolean>;
  problem: string | null;
  holders: RosterHolders;
  styles: OfficeStyles;
}

/**
 * The roster: a switch, then each team with its teammates in the order they are handed out.
 * Every change is one save of the whole list, with the edition a longer list or the switch
 * going on calls for.
 */
export function TeamsSettings({ values, change, problem, holders, styles }: TeamsSettingsProps) {
  const save = useCallback(
    (on: boolean, teams: RosterTeam[]) => {
      if (values === null) return Promise.resolve(false);
      const rosterEdition = nextEdition(rosterOf(values), { on, teams });
      return change(TEAMS_LABEL, { rosterOn: on, rosterEdition, teams });
    },
    [change, values],
  );
  const on = values?.rosterOn ?? false;
  const teams = values?.teams ?? NO_TEAMS;
  const toggle = useCallback((next: boolean) => void save(next, teams), [save, teams]);
  const edit = useCallback((next: RosterTeam[]) => save(on, next), [save, on]);
  const appendTeam = useCallback(() => void edit(addTeam(teams, newId("t"))), [edit, teams]);
  return (
    <View style={styles.headerFields}>
      <LabeledSwitch
        label={SWITCH_LABEL}
        value={values === null ? null : on}
        onChange={toggle}
        styles={styles}
      />
      <Text style={styles.fieldHint}>{INTRO}</Text>
      {teams.map((team, index) => (
        <TeamBlock
          key={team.id}
          team={team}
          index={index}
          teams={teams}
          edit={edit}
          holders={holders}
          styles={styles}
        />
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
  index: number;
  teams: RosterTeam[];
  edit(next: RosterTeam[]): Promise<boolean>;
  holders: RosterHolders;
  styles: OfficeStyles;
}

function TeamBlock({ team, index, teams, edit, holders, styles }: TeamBlockProps) {
  const rename = useCallback(
    (name: string) => edit(renameTeam(teams, team.id, name)),
    [edit, teams, team.id],
  );
  const up = useCallback(() => void edit(moved(teams, index, -1)), [edit, teams, index]);
  const down = useCallback(() => void edit(moved(teams, index, 1)), [edit, teams, index]);
  const remove = useCallback(() => void edit(removeTeam(teams, team.id)), [edit, teams, team.id]);
  const append = useCallback(
    () => void edit(addMember(teams, team.id, newId("m"))),
    [edit, teams, team.id],
  );
  const workspace = holders.teams.get(team.id);
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
        <TextButton label={`Move ${team.name} up`} text="Up" onPress={up} styles={styles} />
        <TextButton label={`Move ${team.name} down`} text="Down" onPress={down} styles={styles} />
        <TextButton
          label={`Remove team ${team.name}`}
          text="Remove"
          onPress={remove}
          styles={styles}
        />
      </View>
      <Text style={styles.fieldHint}>
        {workspace === undefined ? "No workspace has this team" : `Workspace ${workspace}`}
      </Text>
      {team.members.map((member, at) => (
        <MemberRow
          key={member.id}
          team={team}
          at={at}
          teams={teams}
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
  teams: RosterTeam[];
  edit(next: RosterTeam[]): Promise<boolean>;
  held: boolean;
  styles: OfficeStyles;
}

function MemberRow({ team, at, teams, edit, held, styles }: MemberRowProps) {
  const member = team.members[at];
  const within = useCallback(
    (members: RosterTeam["members"]) =>
      edit(teams.map((entry) => (entry.id === team.id ? { ...entry, members } : entry))),
    [edit, teams, team.id],
  );
  const rename = useCallback(
    (name: string) => edit(renameMember(teams, team.id, member.id, name)),
    [edit, teams, team.id, member.id],
  );
  const up = useCallback(() => void within(moved(team.members, at, -1)), [within, team, at]);
  const down = useCallback(() => void within(moved(team.members, at, 1)), [within, team, at]);
  const remove = useCallback(
    () => void edit(removeMember(teams, team.id, member.id)),
    [edit, teams, team.id, member.id],
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
      <TextButton label={`Move ${member.name} up`} text="Up" onPress={up} styles={styles} />
      <TextButton label={`Move ${member.name} down`} text="Down" onPress={down} styles={styles} />
      <TextButton label={`Remove ${member.name}`} text="Remove" onPress={remove} styles={styles} />
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
  text: string;
  onPress(): void;
  styles: OfficeStyles;
}

function TextButton({ label, text, onPress, styles }: TextButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={StyleSheet.compose(styles.workspaceAction, layout.button)}
    >
      <Text style={styles.sidebarButtonText}>{text}</Text>
    </Pressable>
  );
}
