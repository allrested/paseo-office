import { useOfficeBrand } from "./office-brand-context.js";
import { OfficeMark } from "./office-mark.js";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { Text } from "./text.js";
import { useSettings, type SettingsState } from "@getpaseo/plugin/client";
import { SettingsSections, settingsLayout } from "./settings-sections.js";
import { SettingField } from "./setting-field.js";
import { WeatherFields, type WeatherSetting } from "./weather-settings.js";
import { NotifyFields, type NotifySetting } from "./notify-settings.js";
import type { IncidentsState, WakeState } from "../shared/contracts.js";
import {
  CACHE_CLOCKS,
  CHAT_CULTURES,
  officeHostSettings,
  STICKY_NOTES_MAX,
  type CacheClock,
  type ChatCulture,
  STICKY_NOTE_MAX,
  type FloorPlanChoice,
} from "../shared/settings.js";
import { failureText } from "./action-button.js";
import { wakeSummary } from "./board-text.js";
import { FLOOR_PLAN_LABEL, FloorPlanRow } from "./floor-plan-row.js";
import { SegmentPill } from "./segment-pill.js";
import { LabeledSwitch } from "./labeled-switch.js";
import { NOTES_DAYS_LABEL, NotesDays } from "./notes-days.js";
import { NOTES_MODE_LABEL, NotesModeRow } from "./notes-mode-row.js";
import { TeamsSettings } from "./teams-settings.js";
import { NO_HOLDERS, TEAMS_LABEL, type RosterHolders } from "./teams-text.js";
import { JiraConnection, SentryConnection } from "./tracker-connections.js";
import type { OfficeStyles } from "./styles.js";
import type { BoardActions } from "./use-board-actions.js";

type HostSettings = SettingsState<typeof officeHostSettings.schema>;
export type HostValues = Extract<HostSettings, { status: "ready" }>["values"];
/** A host setting, as its control is labelled. */
type HostSetting =
  | "Office name"
  | "Logo URL"
  | "Brand color"
  | "Archive idle sessions"
  | "Agent tools"
  | "Streamer mode"
  | "History vault"
  | "Keep watching"
  | "Stop repeated failing calls"
  | "Undo last turn"
  | "Pinned notes"
  | "Cache clock"
  | "Team chat"
  | "Gen-UI cards"
  | "Sticky notes"
  | "Notes folder"
  | "Time zone"
  | typeof TEAMS_LABEL
  | typeof NOTES_DAYS_LABEL
  | typeof NOTES_MODE_LABEL
  | typeof FLOOR_PLAN_LABEL
  | "Jira projects"
  | "Jira issue types"
  | "Sentry organisation"
  | "Sentry projects"
  | "Sentry address"
  | "AWS profile"
  | "AWS region"
  | "CloudWatch log groups"
  | "Error pattern"
  | WeatherSetting
  | NotifySetting;

/** What the incidents fields need to know from the host: never a token's value. */
type TrackerState = Pick<
  IncidentsState,
  "jiraReady" | "sentryReady" | "scheduleError" | "connections"
> & { problems?: IncidentsState["problems"] };

const JIRA_UNSET = "No Jira connection on this host: save one above";
const SENTRY_UNSET = "No Sentry token on this host: save one above";

/** The line under a tracker's field: `missing` while the field is set, nothing while it is empty. */
function unsetLine(value: string | null, missing: string | null): string | null {
  return value !== null && value.trim() !== "" ? missing : null;
}

const DEFAULTS: HostValues = officeHostSettings.schema.parse({});

/**
 * The settings as the host holds them. A document that is not valid shows the defaults ("Agent
 * tools" on, as the host itself reads it), and a change overwrites it; null while it is read or
 * cannot be read.
 */
function storedValues(settings: HostSettings): HostValues | null {
  if (settings.status === "ready") return settings.values;
  return settings.status === "invalid" ? DEFAULTS : null;
}

/** The stored floor plan; null while the settings are read or cannot be read. */
function storedPlan(values: HostValues | null): FloorPlanChoice | null {
  return values === null ? null : values.floorPlan;
}

export interface HostSwitchesProps {
  /** Null until the office has loaded and while its data is frozen: the switch is then not usable. */
  wake: WakeState | null;
  actions: BoardActions;
  styles: OfficeStyles;
  /** A failure of the device's own switch, shown under the row with the host's. */
  deviceProblem: string | null;
  /** Why the daemon's 8:00 schedule could not follow the notes settings: under the Time zone field. */
  scheduleError: string | null;
  /** Absent until the office's server has read the incidents: no field then says a variable is unset. */
  incidents: TrackerState | undefined;
  /** The device's own switch: last in the row, so on a phone it wraps to the line above the view. */
  weather?: import("../shared/contracts.js").WeatherState | undefined;
  /** Who holds which team and teammate, for the Teams section; none until the office has loaded. */
  rosterHolders?: RosterHolders;
  language?: ReactNode;
  /** In a dialog: the sections scroll inside its body. */
  bounded?: boolean;
  children?: ReactNode;
}

/**
 * The header's switches. Host-wide: "Wake agents" pauses every wake, and "Agent tools" adds the
 * board tools to sessions opened from then on. Each follows the tap at once and goes back if the
 * host refuses it, with the reason on a line under the row. Under them, the 3D floor's plan, then
 * the stand-up notes' folder, time zone and days, then the trackers the incidents check reads.
 */
export function HostSwitches({
  wake,
  actions,
  styles,
  deviceProblem,
  scheduleError,
  incidents,
  weather,
  rosterHolders,
  language,
  bounded,
  children,
}: HostSwitchesProps) {
  const settings = useSettings(officeHostSettings);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The tap, until the host has answered it.
  const [wantedWakes, setWantedWakes] = useState<boolean | null>(null);
  const [wakeProblem, setWakeProblem] = useState<string | null>(null);
  const toggleWakes = useCallback(
    (next: boolean) => {
      setWantedWakes(next);
      setWakeProblem(null);
      actions
        .setWakesPaused(!next)
        .catch((failure: unknown) => {
          const label = next ? "Turn Wake agents on" : "Turn Wake agents off";
          if (mounted.current) setWakeProblem(failureText(label, failure));
        })
        .finally(() => {
          if (mounted.current) setWantedWakes(null);
        });
    },
    [actions],
  );
  const stored = storedValues(settings);
  const revision =
    settings.status === "ready" || settings.status === "invalid" ? settings.revision : null;
  const { save, saveError } = settings;
  // The setting the last save changed: its failure shows by its control.
  const [lastChange, setLastChange] = useState<HostSetting>("Agent tools");
  const change = useCallback(
    (setting: HostSetting, patch: Partial<HostValues>): Promise<boolean> => {
      if (stored === null || revision === null) return Promise.resolve(false);
      setLastChange(setting);
      // Never rejects: a refused save leaves its reason in saveError.
      return save({ ...stored, ...patch }, revision);
    },
    [save, stored, revision],
  );
  const [wantedTools, setWantedTools] = useState<boolean | null>(null);
  const toggleTools = useCallback(
    (next: boolean) => {
      if (revision === null) return;
      setWantedTools(next);
      void change("Agent tools", { agentTools: next }).finally(() => {
        if (mounted.current) setWantedTools(null);
      });
    },
    [change, revision],
  );
  const saveFolder = useCallback(
    (next: string) => change("Notes folder", { notesFolder: next }),
    [change],
  );
  const saveTimeZone = useCallback(
    (next: string) => change("Time zone", { notesTimeZone: next }),
    [change],
  );
  const saveDays = useCallback(
    (next: number[]) => change(NOTES_DAYS_LABEL, { notesDays: next }),
    [change],
  );
  const saveMode = useCallback(
    (next: string) => change(NOTES_MODE_LABEL, { notesMode: next }),
    [change],
  );
  const savePlan = useCallback(
    (next: FloorPlanChoice) => change(FLOOR_PLAN_LABEL, { floorPlan: next }),
    [change],
  );
  const saveProblem = useCallback(
    (setting: HostSetting): string | null =>
      saveError !== null && lastChange === setting
        ? failureText(`Save the ${setting} setting`, saveError)
        : null,
    [saveError, lastChange],
  );
  // A refused save of the zone comes first: the schedule then still follows the earlier one.
  const timeZoneProblem =
    saveProblem("Time zone") ??
    (scheduleError === null ? null : failureText("Schedule the stand-up notes", scheduleError));
  const summary = wake === null ? null : wakeSummary(wake);
  const wakesOn = wake === null ? null : !wake.paused;
  const problems = [
    wakeProblem,
    settings.status === "error" ? failureText("Read the office settings", settings.error) : null,
    saveProblem("Agent tools"),
  ].filter((problem): problem is string => problem !== null);
  const teams = useMemo(
    () => (
      <TeamsSettings
        values={stored}
        revision={revision}
        change={change}
        problem={saveProblem(TEAMS_LABEL)}
        holders={rosterHolders ?? NO_HOLDERS}
        styles={styles}
      />
    ),
    [stored, revision, change, saveProblem, rosterHolders, styles],
  );
  return (
    <SettingsSections
      bounded={bounded}
      styles={styles}
      appearance={
        <>
          {children}
          <BrandFields values={stored} change={change} saveProblem={saveProblem} styles={styles} />
          <View style={styles.headerFields}>
            <FloorPlanRow
              value={storedPlan(stored)}
              onSave={savePlan}
              problem={saveProblem(FLOOR_PLAN_LABEL)}
              styles={styles}
            />
          </View>
          <View style={styles.headerFields}>{language}</View>
          <FloorSettings
            values={stored}
            change={change}
            saveProblem={saveProblem}
            styles={styles}
          />
          {deviceProblem && (
            <Text accessibilityRole="alert" style={styles.actionError}>
              {deviceProblem}
            </Text>
          )}
        </>
      }
      teams={teams}
      automation={
        <>
          <View style={settingsLayout.block}>
            <Text style={styles.sheetLabel}>Agents</Text>
            <View style={settingsLayout.strip}>
              <LabeledSwitch
                label="Wake agents"
                note={summary}
                value={wantedWakes ?? wakesOn}
                onChange={toggleWakes}
                styles={styles}
              />
              <LabeledSwitch
                label="Agent tools"
                value={wantedTools ?? stored?.agentTools ?? null}
                onChange={toggleTools}
                styles={styles}
              />
            </View>
          </View>
          <ArchiveSetting
            values={stored}
            change={change}
            saveProblem={saveProblem}
            styles={styles}
          />
          <PinnedNotes values={stored} change={change} saveProblem={saveProblem} styles={styles} />
          <Text style={styles.sheetLabel}>Stand-up schedule</Text>
          <View style={styles.headerFields}>
            <SettingField
              label="Notes folder"
              hint="Where the stand-up notes are written. Empty turns them off."
              value={stored?.notesFolder ?? null}
              onSave={saveFolder}
              problem={saveProblem("Notes folder")}
              styles={styles}
            />
            <SettingField
              label="Time zone"
              hint="For the 8:00 run. Empty uses this host's."
              value={stored?.notesTimeZone ?? null}
              onSave={saveTimeZone}
              problem={timeZoneProblem}
              styles={styles}
            />
            <NotesDays
              value={stored?.notesDays ?? null}
              onSave={saveDays}
              problem={saveProblem(NOTES_DAYS_LABEL)}
              styles={styles}
            />
            <NotesModeRow
              value={storedMode(stored)}
              onSave={saveMode}
              problem={saveProblem(NOTES_MODE_LABEL)}
              styles={styles}
            />
          </View>
          {problems.length > 0 ? (
            <View style={styles.headerProblems}>
              {problems.map((problem) => (
                <Text key={problem} accessibilityRole="alert" style={styles.actionError}>
                  {problem}
                </Text>
              ))}
            </View>
          ) : null}
        </>
      }
      services={
        <>
          <Text style={styles.sheetLabel}>Issue trackers</Text>
          <TrackerFields
            values={stored}
            incidents={incidents}
            change={change}
            saveProblem={saveProblem}
            styles={styles}
          />
          <Text style={styles.sheetLabel}>Notifications</Text>
          <NotifyFields values={stored} change={change} saveProblem={saveProblem} styles={styles} />
          <Text style={styles.sheetLabel}>Weather service</Text>
          <WeatherFields
            values={stored}
            weather={weather}
            change={change}
            saveProblem={saveProblem}
            styles={styles}
          />
        </>
      }
    />
  );
}

/** The stored writer mode; null while the settings are read or cannot be read. */
function storedMode(values: HostValues | null): string | null {
  return values === null ? null : values.notesMode;
}

type TrackerField =
  | "jiraProjects"
  | "jiraTypes"
  | "sentryOrg"
  | "sentryProjects"
  | "sentryUrl"
  | "awsProfile"
  | "awsRegion"
  | "awsLogGroups"
  | "awsLogPattern";

interface CloudWatchFieldsProps {
  values: HostValues | null;
  /** Why the last CloudWatch check failed, shown under the profile it signs in with. */
  problem: string | undefined;
  change(setting: HostSetting, patch: Partial<HostValues>): Promise<boolean>;
  saveProblem(setting: HostSetting): string | null;
  styles: OfficeStyles;
}

/**
 * CloudWatch, read through a profile of the host's own AWS CLI: the office keeps no AWS key. A
 * profile and a region turn it on.
 */
function CloudWatchFields({ values, problem, change, saveProblem, styles }: CloudWatchFieldsProps) {
  const saveProfile = useCallback(
    (next: string) => change("AWS profile", { awsProfile: next }),
    [change],
  );
  const saveRegion = useCallback(
    (next: string) => change("AWS region", { awsRegion: next }),
    [change],
  );
  const saveGroups = useCallback(
    (next: string) => change("CloudWatch log groups", { awsLogGroups: next }),
    [change],
  );
  const savePattern = useCallback(
    (next: string) => change("Error pattern", { awsLogPattern: next }),
    [change],
  );
  return (
    <>
      <SettingField
        label="AWS profile"
        hint="A profile of the aws CLI on the host. With a region, alarms in ALARM ring the incident alarm."
        value={storedText(values, "awsProfile")}
        onSave={saveProfile}
        problem={saveProblem("AWS profile") ?? problem ?? null}
        styles={styles}
      />
      <SettingField
        label="AWS region"
        hint="The region of the alarms and log groups, such as ap-southeast-1."
        value={storedText(values, "awsRegion")}
        onSave={saveRegion}
        problem={saveProblem("AWS region")}
        styles={styles}
      />
      <SettingField
        label="CloudWatch log groups"
        hint="Log group names, comma separated. Lines that match the pattern ring once an hour for each group."
        value={storedText(values, "awsLogGroups")}
        onSave={saveGroups}
        problem={saveProblem("CloudWatch log groups")}
        styles={styles}
      />
      <SettingField
        label="Error pattern"
        hint="A CloudWatch Logs filter pattern. ERROR by default."
        value={storedText(values, "awsLogPattern")}
        onSave={savePattern}
        problem={saveProblem("Error pattern")}
        styles={styles}
      />
    </>
  );
}

/** A tracker field's stored text; null while the settings are read or cannot be read. */
function storedText(values: HostValues | null, field: TrackerField): string | null {
  return values === null ? null : values[field];
}

interface TrackerFieldsProps {
  /** Null while the settings are read or cannot be read. */
  values: HostValues | null;
  incidents: TrackerState | undefined;
  change(setting: HostSetting, patch: Partial<HostValues>): Promise<boolean>;
  /** A refused save of the setting, if the last save was for it. */
  saveProblem(setting: HostSetting): string | null;
  styles: OfficeStyles;
}

/**
 * The trackers the incidents check reads, and its schedule's failure under them. A field set
 * while the host has no sign-in for the tracker says so; the token itself never comes back here.
 */
function TrackerFields({ values, incidents, change, saveProblem, styles }: TrackerFieldsProps) {
  const saveJiraProjects = useCallback(
    (next: string) => change("Jira projects", { jiraProjects: next }),
    [change],
  );
  const saveJiraTypes = useCallback(
    (next: string) => change("Jira issue types", { jiraTypes: next }),
    [change],
  );
  const saveSentryOrg = useCallback(
    (next: string) => change("Sentry organisation", { sentryOrg: next }),
    [change],
  );
  const saveSentryProjects = useCallback(
    (next: string) => change("Sentry projects", { sentryProjects: next }),
    [change],
  );
  const saveSentryUrl = useCallback(
    (next: string) => change("Sentry address", { sentryUrl: next }),
    [change],
  );
  const jiraProjects = storedText(values, "jiraProjects");
  const sentryOrg = storedText(values, "sentryOrg");
  const sentryProjects = storedText(values, "sentryProjects");
  const sentryUrl = storedText(values, "sentryUrl");
  // The address always has a value: only one other than the default was set by somebody.
  const sentryUrlSet = sentryUrl === DEFAULTS.sentryUrl ? null : sentryUrl;
  // Not known until the host has said: no line before then.
  const jiraMissing = incidents?.jiraReady === false ? JIRA_UNSET : null;
  const sentryMissing = incidents?.sentryReady === false ? SENTRY_UNSET : null;
  // A refused save comes first; while the host refuses nothing, the sign-in it lacks.
  const jiraProblem = saveProblem("Jira projects") ?? unsetLine(jiraProjects, jiraMissing);
  const sentryOrgProblem =
    saveProblem("Sentry organisation") ?? unsetLine(sentryOrg, sentryMissing);
  const sentryProjectsProblem =
    saveProblem("Sentry projects") ?? unsetLine(sentryProjects, sentryMissing);
  const sentryUrlProblem = saveProblem("Sentry address") ?? unsetLine(sentryUrlSet, sentryMissing);
  const scheduleError = incidents?.scheduleError ?? null;
  return (
    <>
      <View style={styles.headerFields}>
        <JiraConnection connection={incidents?.connections?.jira} styles={styles} />
        <SettingField
          label="Jira projects"
          hint="Project keys, comma separated. New issues in them ring the incident alarm."
          value={jiraProjects}
          onSave={saveJiraProjects}
          problem={jiraProblem}
          styles={styles}
        />
        <SettingField
          label="Jira issue types"
          hint="The issue types that ring, by name, comma separated. Bug when empty."
          value={storedText(values, "jiraTypes")}
          onSave={saveJiraTypes}
          problem={saveProblem("Jira issue types")}
          styles={styles}
        />
        <SentryConnection connection={incidents?.connections?.sentry} styles={styles} />
        <SettingField
          label="Sentry organisation"
          hint="The organisation's slug."
          value={sentryOrg}
          onSave={saveSentryOrg}
          problem={sentryOrgProblem}
          styles={styles}
        />
        <SettingField
          label="Sentry projects"
          hint="Project slugs, comma separated."
          value={sentryProjects}
          onSave={saveSentryProjects}
          problem={sentryProjectsProblem}
          styles={styles}
        />
        <SettingField
          label="Sentry address"
          hint="Where the Sentry token is sent. https, or http on the host itself."
          value={sentryUrl}
          onSave={saveSentryUrl}
          problem={sentryUrlProblem}
          styles={styles}
        />
        <CloudWatchFields
          values={values}
          problem={incidents?.problems?.cloudwatch}
          change={change}
          saveProblem={saveProblem}
          styles={styles}
        />
      </View>
      {scheduleError === null ? null : (
        <View style={styles.headerProblems}>
          <Text accessibilityRole="alert" style={styles.actionError}>
            {failureText("Schedule the incidents check", scheduleError)}
          </Text>
        </View>
      )}
    </>
  );
}

const CHAT_CULTURE_NAMES: Readonly<Record<ChatCulture, string>> = {
  international: "International",
  indonesian: "Indonesia",
  vietnamese: "Vietnam",
};

const CACHE_CLOCK_NAMES: Readonly<Record<CacheClock, string>> = {
  off: "No cup",
  "5m": "5 minutes",
  "1h": "1 hour",
};

/** The floor's own: what bubbles may name, and the owner's notes on the whiteboard. */
function FloorSettings({
  values: stored,
  change,
  saveProblem,
  styles,
}: Omit<TrackerFieldsProps, "incidents">) {
  const toggle = useCallback(
    (next: boolean) => void change("Streamer mode", { streamerMode: next }),
    [change],
  );
  const saveNotes = useCallback(
    (next: string) => change("Sticky notes", { stickyNotes: next }),
    [change],
  );
  const problem = saveProblem("Streamer mode");
  const toggleVault = useCallback(
    (next: boolean) => void change("History vault", { historyVault: next }),
    [change],
  );
  const vaultProblem = saveProblem("History vault");
  const toggleWatching = useCallback(
    (next: boolean) => void change("Keep watching", { keepWatching: next }),
    [change],
  );
  const watchingProblem = saveProblem("Keep watching");
  const toggleGuard = useCallback(
    (next: boolean) => void change("Stop repeated failing calls", { loopGuard: next }),
    [change],
  );
  const guardProblem = saveProblem("Stop repeated failing calls");
  const toggleUndo = useCallback(
    (next: boolean) => void change("Undo last turn", { undoTurn: next }),
    [change],
  );
  const undoProblem = saveProblem("Undo last turn");
  const saveCache = useCallback(
    (next: CacheClock) => void change("Cache clock", { cacheClock: next }),
    [change],
  );
  const cacheProblem = saveProblem("Cache clock");
  const saveCulture = useCallback(
    (next: ChatCulture) => void change("Team chat", { chatCulture: next }),
    [change],
  );
  const cultureProblem = saveProblem("Team chat");
  const toggleUiCards = useCallback(
    (next: boolean) => void change("Gen-UI cards", { uiCards: next }),
    [change],
  );
  const uiCardsProblem = saveProblem("Gen-UI cards");
  return (
    <View style={settingsLayout.block}>
      {stored && (
        <LabeledSwitch
          label="Streamer mode"
          value={stored.streamerMode}
          onChange={toggle}
          styles={styles}
        />
      )}
      <Text style={styles.fieldHint}>
        On by default: the 3D floor names no file, command or site. Off, the bubble over a person
        names the one they are at, to everyone who opens this office.
      </Text>
      {problem && (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {problem}
        </Text>
      )}
      {stored && (
        <LabeledSwitch
          label="History vault"
          value={stored.historyVault}
          onChange={toggleVault}
          styles={styles}
        />
      )}
      <Text style={styles.fieldHint}>
        Off by default. On, the office keeps the prompts and the replies of each conversation in a
        file on this host, readable by its owner only, so they can be searched from History after
        the agent is gone.
      </Text>
      {vaultProblem && (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {vaultProblem}
        </Text>
      )}
      {stored && (
        <LabeledSwitch
          label="Keep watching"
          value={stored.keepWatching}
          onChange={toggleWatching}
          styles={styles}
        />
      )}
      <Text style={styles.fieldHint}>
        Off by default: the office reads the agents only while it is open on some device. On, it
        goes on reading every 15 seconds with no office open, so the Timeline, This week, the
        History vault and what the office notices have no gaps. It also reads the plan limits every
        5 minutes and the memory of the host every minute, to tell the webhook.
      </Text>
      {watchingProblem && (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {watchingProblem}
        </Text>
      )}
      {stored && (
        <LabeledSwitch
          label="Stop repeated failing calls"
          value={stored.loopGuard}
          onChange={toggleGuard}
          styles={styles}
        />
      )}
      <Text style={styles.fieldHint}>
        Off by default. On, when an agent asks permission for the very command or file edit that
        just failed three times running, the office refuses it and tells the agent why. Where the
        agent asks nothing, the office sends it a hint, and stops its turn if the same call fails
        again, on a host that can stop a turn. It sees a loop within 5 seconds, or 15 with Keep
        watching and no office open.
      </Text>
      {guardProblem && (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {guardProblem}
        </Text>
      )}
      {stored && (
        <LabeledSwitch
          label="Undo last turn"
          value={stored.undoTurn}
          onChange={toggleUndo}
          styles={styles}
        />
      )}
      <Text style={styles.fieldHint}>
        Off by default. On, the office saves the state of the files of a repository when the turn of
        an agent starts, as objects in that repository (its index, branches and stash are not
        touched), so a session can undo the files that turn edited or wrote. A change a shell
        command made is not undone, and the last turn is the only one kept, until the host restarts.
      </Text>
      {undoProblem && (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {undoProblem}
        </Text>
      )}
      {stored && (
        <LabeledSwitch
          label="Gen-UI cards"
          value={stored.uiCards}
          onChange={toggleUiCards}
          styles={styles}
        />
      )}
      <Text style={styles.fieldHint}>
        Off by default. Turn it on when the Generative UI plugin is installed: where a reply holds
        one of its ui or app blocks, the chat of a session here shows a card with the title of the
        block, not its source. The live card is drawn in the workspace chat.
      </Text>
      {uiCardsProblem && (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {uiCardsProblem}
        </Text>
      )}
      <View style={styles.headerField}>
        <Text style={styles.sheetLabel}>Cache clock</Text>
        <View
          role="group"
          aria-label="Cache clock"
          style={stored ? styles.notesDays : styles.notesDaysDisabled}
        >
          {CACHE_CLOCKS.map((value) => (
            <SegmentPill
              key={value}
              value={value}
              name={CACHE_CLOCK_NAMES[value]}
              on={stored?.cacheClock === value}
              disabled={stored === null}
              onPress={saveCache}
              styles={styles}
            />
          ))}
        </View>
        <Text style={styles.fieldHint}>
          The cup on a resting desk of the 3D floor steams while the session&apos;s prompt cache is
          taken to be warm: this long after its last turn. An estimate; a subscription keeps the
          cache about an hour, an API key five minutes.
        </Text>
        {cacheProblem && (
          <Text accessibilityRole="alert" style={styles.actionError}>
            {cacheProblem}
          </Text>
        )}
      </View>
      <View style={styles.headerField}>
        <Text style={styles.sheetLabel}>Team chat</Text>
        <View
          role="group"
          aria-label="Team chat"
          style={stored ? styles.notesDays : styles.notesDaysDisabled}
        >
          {CHAT_CULTURES.map((value) => (
            <SegmentPill
              key={value}
              value={value}
              name={CHAT_CULTURE_NAMES[value]}
              on={stored?.chatCulture === value}
              disabled={stored === null}
              onPress={saveCulture}
              styles={styles}
            />
          ))}
        </View>
        <Text style={styles.fieldHint}>
          Whose lunch, prices and places the team chat&apos;s people write about. Indonesia also
          writes in Indonesian; the other two write in English. It changes what is written from now
          on, not the lines already in the chat.
        </Text>
        {cultureProblem && (
          <Text accessibilityRole="alert" style={styles.actionError}>
            {cultureProblem}
          </Text>
        )}
      </View>
      <SettingField
        label="Sticky notes"
        hint={`Your notes on the 3D whiteboard, with ; between them. Up to ${STICKY_NOTES_MAX}, ${STICKY_NOTE_MAX} characters each.`}
        value={stored?.stickyNotes ?? null}
        onSave={saveNotes}
        problem={saveProblem("Sticky notes")}
        styles={styles}
      />
    </View>
  );
}

function PinnedNotes({
  values: stored,
  change,
  saveProblem,
  styles,
}: Omit<TrackerFieldsProps, "incidents">) {
  const save = useCallback(
    (next: string) => change("Pinned notes", { pinnedNotes: next }),
    [change],
  );
  return (
    <View style={styles.headerFields}>
      <SettingField
        label="Pinned notes"
        hint="Said again to an agent whose conversation is compacted during a turn, so a rule you gave it is not lost. Empty says nothing."
        value={stored?.pinnedNotes ?? null}
        onSave={save}
        problem={saveProblem("Pinned notes")}
        styles={styles}
      />
    </View>
  );
}

function ArchiveSetting({
  values: stored,
  change,
  saveProblem,
  styles,
}: Omit<TrackerFieldsProps, "incidents">) {
  const toggle = useCallback(
    (next: boolean) => void change("Archive idle sessions", { archiveOnDeparture: next }),
    [change],
  );
  const problem = saveProblem("Archive idle sessions");
  return (
    <View style={settingsLayout.block}>
      {stored && (
        <LabeledSwitch
          label="Archive idle sessions"
          value={stored.archiveOnDeparture}
          onChange={toggle}
          styles={styles}
        />
      )}
      <Text style={styles.fieldHint}>
        Off by default. When a worker goes home for the night or after evening drinks, an open 3D
        floor can archive its idle session on this host. Sessions awaiting approval or a working
        subagent stay active. Archived sessions leave the active list and keep their history.
      </Text>
      {problem && (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {problem}
        </Text>
      )}
    </View>
  );
}

function BrandFields({
  values: stored,
  change,
  saveProblem,
  styles,
}: Omit<TrackerFieldsProps, "incidents">) {
  const brand = useOfficeBrand();
  const saveName = useCallback((v: string) => change("Office name", { brandName: v }), [change]);
  const saveLogo = useCallback((v: string) => change("Logo URL", { brandLogoUrl: v }), [change]);
  const saveColor = useCallback((v: string) => change("Brand color", { brandColor: v }), [change]);
  return (
    <View style={settingsLayout.block}>
      <Text style={styles.sheetLabel}>Branding</Text>
      <View style={settingsLayout.strip}>
        <OfficeMark brand={brand} fallbackColor={styles.brandIcon.color} />
        <Text numberOfLines={1} style={styles.brandText}>
          {brand.name ?? "Office 3D"}
        </Text>
      </View>
      <View style={styles.headerFields}>
        <SettingField
          label="Office name"
          value={stored ? (stored.brandName ?? "") : null}
          hint="Display name. Leave blank to use the host default."
          onSave={saveName}
          problem={saveProblem("Office name")}
          styles={styles}
        />
        <SettingField
          label="Brand color"
          value={stored ? (stored.brandColor ?? "") : null}
          hint="Hex color for the office mark, such as #e8865f."
          onSave={saveColor}
          problem={saveProblem("Brand color")}
          styles={styles}
        />
        <SettingField
          label="Logo URL"
          value={stored ? (stored.brandLogoUrl ?? "") : null}
          hint="HTTPS image URL. Allow cross-origin images for the 3D sign."
          onSave={saveLogo}
          problem={saveProblem("Logo URL")}
          styles={styles}
        />
      </View>
    </View>
  );
}
