import { useCallback, useState } from "react";
import { View } from "react-native";
import { Text } from "./text.js";
import { useRpc } from "@getpaseo/plugin/client";
import { intakeRunRpc, type IntakeState } from "../shared/contracts.js";
import { GITHUB_REPO, GITHUB_REPOS_MAX, GITHUB_SEARCH_MAX, JQL_MAX } from "../shared/settings.js";
import { ActionButton } from "./action-button.js";
import { ChoicePills } from "./choice-pills.js";
import type { HostValues } from "./host-switches.js";
import { LabeledSwitch } from "./labeled-switch.js";
import { SettingField } from "./setting-field.js";
import type { OfficeStyles } from "./styles.js";

export type IntakeSetting =
  | "Jira tickets to bring in (JQL)"
  | "GitHub repositories to bring in from"
  | "GitHub search"
  | "Imported tasks go to"
  | "Let the gate start imported tasks"
  | "Comment the result on the ticket";

const LANDS: readonly { value: HostValues["intakeLands"]; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "To do" },
];

const JQL_HINT =
  "Tickets this matches become lobby tasks, each once. Leave imported tickets out of it, for example by a label.";
const GITHUB_HINT =
  "Read with the host's gh CLI and its sign-in. The office keeps no GitHub token.";
const SEARCH_HINT =
  "Issues this matches become lobby tasks, each once. Leave imported issues out of it, for example with -label:in-office.";
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

/** Where the last GitHub run stands, as one line; none is claimed before the office has said. */
function githubLine(github: IntakeState["github"]): string {
  if (!github.configured) return "GitHub: not set up. Add a repository.";
  if (github.lastRun === null) return "GitHub: not read yet.";
  const when = `GitHub: last read ${clock(github.lastRun)}`;
  return github.imported === 0 ? `${when}: nothing new` : `${when}: ${github.imported} imported`;
}

/** What is wrong with the lines typed, as the schema would refuse them, by line; null when none. */
function reposProblem(entries: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    if (!GITHUB_REPO.test(entry)) return `Line ${index + 1}: "${entry}" is not owner/repo`;
    if (seen.has(entry.toLowerCase())) return `Line ${index + 1}: "${entry}" is there twice`;
    seen.add(entry.toLowerCase());
  }
  return entries.length > GITHUB_REPOS_MAX ? `At most ${GITHUB_REPOS_MAX} repositories` : null;
}

interface Props {
  values: HostValues | null;
  /** Absent until the office's server has read the settings. */
  intake: IntakeState | undefined;
  change(setting: IntakeSetting, patch: Partial<HostValues>): Promise<boolean>;
  saveProblem(setting: IntakeSetting): string | null;
  styles: OfficeStyles;
}

/** The GitHub repositories and search. An entry the schema would refuse is told, and not sent. */
function GithubFields({
  values,
  change,
  saveProblem,
  styles,
}: Pick<Props, "values" | "change" | "saveProblem" | "styles">) {
  // What the lines typed were refused for, until a save of them goes through.
  const [reposRefused, setReposRefused] = useState<string | null>(null);
  const [searchRefused, setSearchRefused] = useState<string | null>(null);
  const saveRepos = useCallback(
    async (next: string) => {
      const entries = next
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "");
      const problem = reposProblem(entries);
      setReposRefused(problem);
      if (problem !== null) return false;
      return change("GitHub repositories to bring in from", { githubIntakeRepos: entries });
    },
    [change],
  );
  const saveSearch = useCallback(
    async (next: string) => {
      const refused = next.startsWith("-");
      setSearchRefused(refused ? "The search must not start with a dash" : null);
      if (refused) return false;
      return change("GitHub search", { githubIntakeSearch: next });
    },
    [change],
  );
  return (
    <>
      <SettingField
        label="GitHub repositories to bring in from"
        hint={GITHUB_HINT}
        value={values === null ? null : values.githubIntakeRepos.join("\n")}
        onSave={saveRepos}
        problem={reposRefused ?? saveProblem("GitHub repositories to bring in from")}
        lines={3}
        styles={styles}
      />
      <SettingField
        label="GitHub search"
        hint={SEARCH_HINT}
        value={values?.githubIntakeSearch ?? null}
        onSave={saveSearch}
        problem={searchRefused ?? saveProblem("GitHub search")}
        maxLength={GITHUB_SEARCH_MAX}
        styles={styles}
      />
    </>
  );
}

function JiraStatus({
  jira,
  waiting,
  styles,
}: {
  jira: IntakeState["jira"] | undefined;
  waiting: boolean;
  styles: OfficeStyles;
}) {
  if (jira === undefined) return null;
  return (
    <View testID="intake-status">
      <Text style={styles.fieldHint}>{lastRunLine(jira)}</Text>
      {jira.configured && jira.problem !== null ? (
        <Text style={styles.standupBlocker}>{jira.problem}</Text>
      ) : null}
      {waiting ? <Text style={styles.fieldHint}>Waiting: 50 imported tasks are open.</Text> : null}
    </View>
  );
}

function GithubStatus({
  github,
  styles,
}: {
  github: IntakeState["github"] | undefined;
  styles: OfficeStyles;
}) {
  if (github === undefined) return null;
  return (
    <View testID="intake-status-github">
      <Text style={styles.fieldHint}>{githubLine(github)}</Text>
      {github.configured && github.problem !== null ? (
        <Text style={styles.standupBlocker}>{github.problem}</Text>
      ) : null}
    </View>
  );
}

/**
 * The intake: the owner's JQL, the GitHub repositories and search, where its tickets land,
 * whether the gate may start them and whether the result is commented back, and where its last
 * run stands. The Jira connection is the one above, and GitHub is read with the host's own gh, so
 * no token is asked for here.
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
  const github = intake?.github;
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
      <GithubFields values={values} change={change} saveProblem={saveProblem} styles={styles} />
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
        <JiraStatus jira={jira} waiting={intake?.waiting === true} styles={styles} />
        <GithubStatus github={github} styles={styles} />
        <View style={styles.actions}>
          <ActionButton
            label="Read now"
            pendingLabel="Reading..."
            onPress={run}
            disabled={jira?.configured !== true && github?.configured !== true}
            styles={styles}
          />
        </View>
      </View>
    </View>
  );
}
