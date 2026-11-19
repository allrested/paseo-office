import type { Appearance } from "../shared/appearance.js";
import { AppearanceFields } from "./agent-appearance.js";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
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

interface ErrorBodyProps {
  message: string | null;
  onRetry(): void;
  styles: OfficeStyles;
}

function ErrorBody({ message, onRetry, styles }: ErrorBodyProps) {
  return (
    <View style={styles.sheetField}>
      <Text accessibilityRole="alert" style={styles.bannerText}>
        {message}
      </Text>
      <View style={styles.actions}>
        <ActionButton
          label="Try again"
          pendingLabel="Trying..."
          onPress={onRetry}
          styles={styles}
        />
      </View>
    </View>
  );
}

/** Every provider is still loading: not an empty host, so the form waits and can read again. */
function StartingBody({ onRetry, styles }: Omit<ErrorBodyProps, "message">) {
  return (
    <View style={styles.sheetField}>
      <Text style={styles.muted}>Providers are still starting.</Text>
      <View style={styles.actions}>
        <ActionButton
          label="Try again"
          pendingLabel="Trying..."
          onPress={onRetry}
          styles={styles}
        />
      </View>
    </View>
  );
}

interface ReadyBodyProps {
  agent: ReturnType<typeof useNewAgent>;
  choice: NewAgentChoice;
  change(patch: Partial<NewAgentChoice>): void;
  onCreated(agentId: string): void;
  styles: OfficeStyles;
}

function OptionGroup({
  label,
  value,
  compact,
  open,
  toggle,
  styles,
  children,
}: {
  label: string;
  value?: string;
  compact: boolean;
  open: boolean;
  toggle(): void;
  styles: OfficeStyles;
  children: ReactNode;
}) {
  return (
    <View style={styles.sheetField}>
      <Text style={styles.sheetLabel}>{label}</Text>
      {compact && (
        <Pressable
          accessibilityRole="button"
          aria-expanded={open}
          accessibilityLabel={`Choose ${label.toLowerCase()}`}
          onPress={toggle}
          style={styles.newAgentSelector}
        >
          <Text numberOfLines={1} style={styles.sidebarButtonText}>
            {value ?? `Select ${label.toLowerCase()}`}
          </Text>
          <Icon name={open ? "ChevronUp" : "ChevronDown"} size={16} color={styles.iconColor} />
        </Pressable>
      )}
      {(!compact || open) && (
        <View role="group" aria-label={label} style={styles.panelChips}>
          {children}
        </View>
      )}
    </View>
  );
}

function ReadyBody({ agent, choice, change, onCreated, styles }: ReadyBodyProps) {
  const { create, chooseProvider } = agent;
  const customize = useCallback((appearance: Appearance) => change({ appearance }), [change]);
  const chooseWorkspace = useCallback((workspaceId: string) => change({ workspaceId }), [change]);
  const [menu, setMenu] = useState<"provider" | "model" | null>(null);
  const toggleProvider = useCallback(
    () => setMenu((current) => (current === "provider" ? null : "provider")),
    [],
  );
  const toggleModel = useCallback(
    () => setMenu((current) => (current === "model" ? null : "model")),
    [],
  );
  const selectProvider = useCallback(
    (provider: string) => {
      chooseProvider(provider);
      setMenu(null);
    },
    [chooseProvider],
  );
  const chooseModel = useCallback(
    (model: string) => {
      change({ model });
      setMenu(null);
    },
    [change],
  );
  const setPrompt = useCallback((prompt: string) => change({ prompt }), [change]);
  const submit = useCallback(async () => onCreated(await create()), [create, onCreated]);
  const problem = newAgentProblem(choice, agent.starting);
  const waiting = agent.starting.some((entry) => entry.id === choice.provider);
  const provider = agent.providers.find((entry) => entry.id === choice.provider);
  const models = provider?.models ?? [];
  return (
    <>
      <ScrollView
        style={styles.columnBody}
        contentContainerStyle={styles.newAgentForm}
        nestedScrollEnabled
      >
        <AppearanceFields
          draft={choice.appearance}
          change={customize}
          collapsible
          styles={styles}
        />
        <Workspaces
          workspaces={agent.workspaces}
          value={choice.workspaceId}
          onChoose={chooseWorkspace}
          styles={styles}
        />
        <OptionGroup
          label="Provider"
          value={provider?.label ?? choice.provider ?? undefined}
          compact={agent.providers.length + agent.starting.length > 3}
          open={menu === "provider"}
          toggle={toggleProvider}
          styles={styles}
        >
          {agent.providers.map((entry) => (
            <Pill<string>
              key={entry.id}
              value={entry.id}
              label={entry.models.length === 0 ? `${entry.label} (No models)` : entry.label}
              disabled={entry.models.length === 0}
              on={entry.id === choice.provider}
              toggle={false}
              onPress={selectProvider}
              styles={styles}
            />
          ))}
          {agent.starting.map((entry) => (
            <Pill<string>
              key={entry.id}
              value={entry.id}
              label={`${entry.label} (Starting)`}
              disabled
              on={entry.id === choice.provider}
              toggle={false}
              onPress={selectProvider}
              styles={styles}
            />
          ))}
        </OptionGroup>
        <OptionGroup
          label="Model"
          value={models.find((entry) => entry.id === choice.model)?.label}
          compact={models.length > 3}
          open={menu === "model"}
          toggle={toggleModel}
          styles={styles}
        >
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
        </OptionGroup>
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
      </ScrollView>
      <View style={styles.newAgentFooter}>
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
          {waiting ? (
            <ActionButton
              label="Try again"
              pendingLabel="Trying..."
              onPress={agent.retry}
              styles={styles}
            />
          ) : null}
        </View>
      </View>
    </>
  );
}

/** The form's body for what has been read: loading, the reason it failed, or the fields. */
function FormBody({ agent, choice, change, onCreated, styles }: ReadyBodyProps) {
  if (agent.status === "loading") return <Text style={styles.sceneStatus}>Loading...</Text>;
  if (agent.status === "error") {
    return <ErrorBody message={agent.error} onRetry={agent.retry} styles={styles} />;
  }
  if (agent.providers.length === 0) {
    if (agent.starting.length > 0) return <StartingBody onRetry={agent.retry} styles={styles} />;
    return <Text style={styles.muted}>No provider is available.</Text>;
  }
  return (
    <ReadyBody
      agent={agent}
      choice={choice}
      change={change}
      onCreated={onCreated}
      styles={styles}
    />
  );
}

/** The Sessions tab's form for a new agent: workspace, provider, model and the first prompt. */
export function NewAgentForm({ choice, change, onBack, onCreated, styles }: NewAgentFormProps) {
  const agent = useNewAgent({ choice, change });
  return (
    <View style={styles.screen}>
      <View style={styles.newAgentHeader}>
        <Text accessibilityRole="header" style={styles.panelHeading}>
          New agent
        </Text>
        <ActionButton label="Back" pendingLabel="Back" onPress={onBack} styles={styles} />
      </View>
      <FormBody
        agent={agent}
        choice={choice}
        change={change}
        onCreated={onCreated}
        styles={styles}
      />
    </View>
  );
}
