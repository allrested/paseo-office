import { useCallback } from "react";
import { View } from "react-native";
import { Text } from "./text.js";
import { useRpc } from "@getpaseo/plugin/client";
import { intakeRunRpc, type IntakeState } from "../shared/contracts.js";
import { JQL_MAX } from "../shared/settings.js";
import { ActionButton } from "./action-button.js";
import { ChoicePills } from "./choice-pills.js";
import type { HostValues } from "./host-switches.js";
import { LabeledSwitch } from "./labeled-switch.js";
import { SettingField } from "./setting-field.js";
import type { OfficeStyles } from "./styles.js";

export type IntakeSetting =
  | "Jira tickets to bring in (JQL)"
  | "Imported tasks go to"
  | "Let the gate start imported tasks"
  | "Comment the result on the ticket";

const LANDS: readonly { value: HostValues["intakeLands"]; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "To do" },
];

const JQL_HINT =
  "Tickets this matches become lobby tasks, each once. Leave imported tickets out of it, for example by a label.";
const START_HINT =
  "A ticket's text reaches an agent without you reading it first. Leave it off unless only people you trust can write tickets.";
const COMMENT_HINT =
  "The comment is the result as the agent wrote it, readable by everyone who can read the ticket.";

/** A run's time: the clock on this device, 24-hour. */
function clock(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Where the last run stands, as lines; none before the office has said. */
function lastRunLine(jira: IntakeState["jira"]): string {
  if (!jira.configured) return "Not set up: needs a JQL and the Jira connection.";
  if (jira.lastRun === null) return "Not read yet.";
  const when = `Last read ${clock(jira.lastRun)}`;
  return jira.imported === 0 ? `${when}: nothing new` : `${when}: ${jira.imported} imported`;
}

interface Props {
  values: HostValues | null;
  /** Absent until the office's server has read the settings. */
  intake: IntakeState | undefined;
  change(setting: IntakeSetting, patch: Partial<HostValues>): Promise<boolean>;
  saveProblem(setting: IntakeSetting): string | null;
  styles: OfficeStyles;
}

/**
 * The intake: the owner's JQL, where its tickets land, whether the gate may start them and
 * whether the result is commented back, and where its last run stands. The Jira connection is the
 * one above, so no token is asked for here.
 */
export function IntakeSettings({ values, intake, change, saveProblem, styles }: Props) {
  const callRun = useRpc(intakeRunRpc);
  const saveJql = useCallback(
    (next: string) => change("Jira tickets to bring in (JQL)", { jiraIntakeJql: next }),
    [change],
  );
  const saveLands = useCallback(
    (next: HostValues["intakeLands"]) => change("Imported tasks go to", { intakeLands: next }),
    [change],
  );
  const toggleStart = useCallback(
    (next: boolean) => void change("Let the gate start imported tasks", { intakeAutoStart: next }),
    [change],
  );
  const toggleComment = useCallback(
    (next: boolean) => void change("Comment the result on the ticket", { intakeWriteBack: next }),
    [change],
  );
  const run = useCallback(async () => {
    await callRun({});
  }, [callRun]);
  const startProblem = saveProblem("Let the gate start imported tasks");
  const commentProblem = saveProblem("Comment the result on the ticket");
  const jira = intake?.jira;
  return (
    <View style={styles.headerFields}>
      <SettingField
        label="Jira tickets to bring in (JQL)"
        hint={JQL_HINT}
        value={values?.jiraIntakeJql ?? null}
        onSave={saveJql}
        problem={saveProblem("Jira tickets to bring in (JQL)")}
        lines={3}
        maxLength={JQL_MAX}
        styles={styles}
      />
      <ChoicePills
        label="Imported tasks go to"
        hint="Backlog holds a ticket until you start it."
        options={LANDS}
        value={values?.intakeLands ?? null}
        onSave={saveLands}
        problem={saveProblem("Imported tasks go to")}
        styles={styles}
      />
      <View style={styles.headerField}>
        <LabeledSwitch
          label="Let the gate start imported tasks"
          value={values?.intakeAutoStart ?? null}
          onChange={toggleStart}
          styles={styles}
        />
        <Text style={styles.fieldHint}>{START_HINT}</Text>
        {startProblem && (
          <Text accessibilityRole="alert" style={styles.actionError}>
            {startProblem}
          </Text>
        )}
      </View>
      <View style={styles.headerField}>
        <LabeledSwitch
          label="Comment the result on the ticket"
          value={values?.intakeWriteBack ?? null}
          onChange={toggleComment}
          styles={styles}
        />
        <Text style={styles.fieldHint}>{COMMENT_HINT}</Text>
        {commentProblem && (
          <Text accessibilityRole="alert" style={styles.actionError}>
            {commentProblem}
          </Text>
        )}
      </View>
      <View style={styles.headerField}>
        {jira === undefined ? null : (
          <View testID="intake-status">
            <Text style={styles.fieldHint}>{lastRunLine(jira)}</Text>
            {jira.configured && jira.problem !== null ? (
              <Text style={styles.standupBlocker}>{jira.problem}</Text>
            ) : null}
            {intake?.waiting ? (
              <Text style={styles.fieldHint}>Waiting: 50 imported tasks are open.</Text>
            ) : null}
          </View>
        )}
        <View style={styles.actions}>
          <ActionButton
            label="Read now"
            pendingLabel="Reading..."
            onPress={run}
            disabled={jira?.configured !== true}
            styles={styles}
          />
        </View>
      </View>
    </View>
  );
}
