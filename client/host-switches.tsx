import { useOfficeBrand } from "./office-brand-context.js";
import { OfficeMark } from "./office-mark.js";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useSettings, type SettingsState } from "@getpaseo/plugin/client";
import { SettingsSections, settingsLayout } from "./settings-sections.js";
import { SettingField } from "./setting-field.js";
import { WeatherFields, type WeatherSetting } from "./weather-settings.js";
import type { IncidentsState, WakeState } from "../shared/contracts.js";
import { officeHostSettings, type FloorPlanChoice } from "../shared/settings.js";
import { failureText } from "./action-button.js";
import { wakeSummary } from "./board-text.js";
import { FLOOR_PLAN_LABEL, FloorPlanRow } from "./floor-plan-row.js";
import { LabeledSwitch } from "./labeled-switch.js";
import { NOTES_DAYS_LABEL, NotesDays } from "./notes-days.js";
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
  | "Notes folder"
  | "Time zone"
  | typeof NOTES_DAYS_LABEL
  | typeof FLOOR_PLAN_LABEL
  | "Jira projects"
  | "Sentry organisation"
  | "Sentry projects"
  | "Sentry address"
  | WeatherSetting;

/** What the incidents fields need to know from the host: never a token's value. */
type TrackerState = Pick<IncidentsState, "jiraReady" | "sentryReady" | "scheduleError">;

const JIRA_UNSET =
  "ATLASSIAN_BASE_URL, ATLASSIAN_EMAIL or ATLASSIAN_API_TOKEN is not set on this host";
const SENTRY_UNSET = "SENTRY_AUTH_TOKEN is not set on this host";

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
  language?: ReactNode;
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
  language,
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
  return (
    <SettingsSections
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
          {deviceProblem && (
            <Text accessibilityRole="alert" style={styles.actionError}>
              {deviceProblem}
            </Text>
          )}
        </>
      }
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

type TrackerField = "jiraProjects" | "sentryOrg" | "sentryProjects" | "sentryUrl";

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
 * while the host lacks the tracker's variables names them; the token itself never reaches here.
 */
function TrackerFields({ values, incidents, change, saveProblem, styles }: TrackerFieldsProps) {
  const saveJiraProjects = useCallback(
    (next: string) => change("Jira projects", { jiraProjects: next }),
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
  // A refused save comes first; while the host refuses nothing, the variables it lacks.
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
        <SettingField
          label="Jira projects"
          hint="Project keys, comma separated. Needs ATLASSIAN_BASE_URL, ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN on the host."
          value={jiraProjects}
          onSave={saveJiraProjects}
          problem={jiraProblem}
          styles={styles}
        />
        <SettingField
          label="Sentry organisation"
          hint="The organisation's slug. Needs SENTRY_AUTH_TOKEN on the host."
          value={sentryOrg}
          onSave={saveSentryOrg}
          problem={sentryOrgProblem}
          styles={styles}
        />
        <SettingField
          label="Sentry projects"
          hint="Project slugs, comma separated. Needs SENTRY_AUTH_TOKEN on the host."
          value={sentryProjects}
          onSave={saveSentryProjects}
          problem={sentryProjectsProblem}
          styles={styles}
        />
        <SettingField
          label="Sentry address"
          hint="Where SENTRY_AUTH_TOKEN is sent. https, or http on the host itself."
          value={sentryUrl}
          onSave={saveSentryUrl}
          problem={sentryUrlProblem}
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
