import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { Pill } from "./activity-panel.js";
import { ActionButton } from "./action-button.js";
import { Row as ChoiceRow } from "./agent-picker.js";
import { newAgentProblem, workspaceGroups, type NewAgentChoice } from "./new-agent-model.js";
import type { OfficeStyles } from "./styles.js";
import { useNewAgent } from "./use-new-agent.js";

export interface NewAgentFormProps {
  /** What is chosen and typed: the Sessions tab's, so Back keeps it for the next time. */
  choice: NewAgentChoice;
  change(patch: Partial<NewAgentChoice>): void;
  onBack(): void;
  /** The agent exists: the tab closes the form and opens its session. */
  onCreated(agentId: string): void;
  styles: OfficeStyles;
}

interface WorkspacesProps {
  workspaces: ReturnType<typeof useNewAgent>["workspaces"];
  value: string | null;
  onChoose(id: string): void;
  styles: OfficeStyles;
}

function Workspaces({ workspaces, value, onChoose, styles }: WorkspacesProps) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => workspaceGroups(workspaces, query), [workspaces, query]);
  const emptyText =
    workspaces.length === 0 && query.trim() === ""
      ? "No workspaces on this host yet."
      : "No workspace matches.";
  return (
    <View style={styles.sheetField}>
      <Text style={styles.sheetLabel}>Workspace</Text>
      <TextInput
        accessibilityLabel="Search workspaces"
        placeholder="Search by workspace or project"
        placeholderTextColor={styles.placeholderColor}
        value={query}
        onChangeText={setQuery}
        style={styles.pickerSearch}
      />
      <ScrollView nestedScrollEnabled style={styles.newAgentWorkspaces}>
        <View accessibilityRole="radiogroup" accessibilityLabel="Workspace" style={styles.sheet}>
          {groups.map((group) => (
            <View key={group.projectId} style={styles.sheetField}>
              <Text style={styles.muted}>{group.projectName}</Text>
              <View style={styles.pickerRows}>
                {group.workspaces.map((workspace) => (
                  <ChoiceRow
                    key={workspace.id}
                    value={workspace.id}
                    title={workspace.name}
                    detail={workspace.directory}
                    tone={null}
                    selected={workspace.id === value}
                    takesFocus={false}
                    onChoose={onChoose}
                    styles={styles}
                  />
                ))}
              </View>
            </View>
          ))}
          {groups.length === 0 ? <Text style={styles.muted}>{emptyText}</Text> : null}
        </View>
      </ScrollView>
    </View>
  );
}

/** The Sessions tab's form for a new agent: workspace, provider, model and the first prompt. */
export function NewAgentForm({ choice, change, onBack, onCreated, styles }: NewAgentFormProps) {
  const agent = useNewAgent({ choice, change });
  const { create, chooseProvider } = agent;
  const chooseWorkspace = useCallback((workspaceId: string) => change({ workspaceId }), [change]);
  const chooseModel = useCallback((model: string) => change({ model }), [change]);
  const setPrompt = useCallback((prompt: string) => change({ prompt }), [change]);
  const submit = useCallback(async () => onCreated(await create()), [create, onCreated]);
  const problem = newAgentProblem(choice);
  const models = agent.providers.find((entry) => entry.id === choice.provider)?.models ?? [];
  let body = null;
  if (agent.status === "loading") body = <Text style={styles.sceneStatus}>Loading...</Text>;
  else if (agent.status === "error") {
    body = (
      <View style={styles.sheetField}>
        <Text accessibilityRole="alert" style={styles.bannerText}>
          {agent.error}
        </Text>
        <View style={styles.actions}>
          <ActionButton
            label="Try again"
            pendingLabel="Trying..."
            onPress={agent.retry}
            styles={styles}
          />
        </View>
      </View>
    );
  } else if (agent.providers.length === 0) {
    body = <Text style={styles.muted}>No provider is available.</Text>;
  } else {
    body = (
      <>
        <Workspaces
          workspaces={agent.workspaces}
          value={choice.workspaceId}
          onChoose={chooseWorkspace}
          styles={styles}
        />
        <View style={styles.sheetField}>
          <Text style={styles.sheetLabel}>Provider</Text>
          <View role="group" aria-label="Provider" style={styles.panelChips}>
            {agent.providers.map((entry) => (
              <Pill<string>
                key={entry.id}
                value={entry.id}
                label={entry.models.length === 0 ? `${entry.label} (No models)` : entry.label}
                disabled={entry.models.length === 0}
                on={entry.id === choice.provider}
                toggle={false}
                onPress={chooseProvider}
                styles={styles}
              />
            ))}
          </View>
        </View>
        <View style={styles.sheetField}>
          <Text style={styles.sheetLabel}>Model</Text>
          <View role="group" aria-label="Model" style={styles.panelChips}>
            {models.map((entry) => (
              <Pill<string>
                key={entry.id}
                value={entry.id}
                label={entry.label}
                on={entry.id === choice.model}
                toggle={false}
                onPress={chooseModel}
                styles={styles}
              />
            ))}
          </View>
        </View>
        <View style={styles.sheetField}>
          <Text style={styles.sheetLabel}>First prompt</Text>
          <TextInput
            accessibilityLabel="First prompt"
            placeholder="What should the agent do?"
            placeholderTextColor={styles.placeholderColor}
            value={choice.prompt}
            onChangeText={setPrompt}
            multiline
            style={styles.input}
          />
        </View>
        {problem === null ? null : <Text style={styles.muted}>{problem}</Text>}
        <View style={styles.actions}>
          <ActionButton
            label="Create"
            pendingLabel="Creating..."
            onPress={submit}
            disabled={problem !== null}
            primary
            styles={styles}
          />
        </View>
      </>
    );
  }
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.newAgentForm}>
        <View style={styles.actions}>
          <ActionButton label="Back" pendingLabel="Back" onPress={onBack} styles={styles} />
        </View>
        {body}
      </ScrollView>
    </View>
  );
}
