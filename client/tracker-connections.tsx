import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/ui";
import {
  trackersSaveRpc,
  trackersTestRpc,
  type IncidentsState,
  type TrackerSource,
  type TrackersResult,
} from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import type { OfficeStyles } from "./styles.js";

type Connections = NonNullable<IncidentsState["connections"]>;

/** Where the host's sign-in comes from, as the line under a connection says it. */
export function sourceLine(name: string, source: TrackerSource | undefined): string | null {
  switch (source) {
    case "saved":
      return `${name} connection saved on this host`;
    case "env":
      return `${name} connection from the host's environment; a saved one replaces it`;
    case "none":
      return `No ${name} connection on this host`;
    default:
      // Not known until the host has said: nothing is claimed before then.
      return null;
  }
}

/** The host's answer as a button takes it: a refusal becomes the button's error. */
function accept(result: TrackersResult): void {
  if (!result.ok) throw new Error(result.problem);
}

interface FieldProps {
  label: string;
  hint: string;
  value: string;
  onChangeText(next: string): void;
  secret?: boolean;
  styles: OfficeStyles;
}

/** Typed text that is kept until a button sends it, unlike a setting's field. */
function ConnectionField({ label, hint, value, onChangeText, secret, styles }: FieldProps) {
  return (
    <View style={styles.headerField}>
      <Text style={styles.sheetLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secret === true}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        style={styles.fieldInput}
      />
      <Text style={styles.fieldHint}>{hint}</Text>
    </View>
  );
}

interface ButtonsProps {
  name: string;
  source: TrackerSource | undefined;
  /** What the last test or save came to; null before one, and after a change it no longer fits. */
  note: string | null;
  test(): Promise<void>;
  save(): Promise<void>;
  clear(): Promise<void>;
  styles: OfficeStyles;
}

function ConnectionButtons({ name, source, note, test, save, clear, styles }: ButtonsProps) {
  const line = note ?? sourceLine(name, source);
  return (
    <View style={styles.headerField}>
      {line === null ? null : <Text style={styles.fieldHint}>{line}</Text>}
      <View style={styles.actions}>
        <ActionButton
          label="Test connection"
          pendingLabel="Testing..."
          name={`Test ${name} connection`}
          onPress={test}
          styles={styles}
        />
        <ActionButton
          label="Save connection"
          pendingLabel="Saving..."
          name={`Save ${name} connection`}
          onPress={save}
          primary
          styles={styles}
        />
        {source === "saved" ? (
          <ActionButton
            label="Remove"
            pendingLabel="Removing..."
            name={`Remove saved ${name} connection`}
            onPress={clear}
            styles={styles}
          />
        ) : null}
      </View>
    </View>
  );
}

interface JiraProps {
  /** Absent until the host has said where its sign-in comes from. */
  connection: Connections["jira"] | undefined;
  styles: OfficeStyles;
}

/**
 * Jira's address, email and API token, saved on the host in a file only the daemon's user can
 * read. The token goes to the host and never comes back: its field is empty for the one kept.
 */
export function JiraConnection({ connection, styles }: JiraProps) {
  const callTest = useRpc(trackersTestRpc);
  const callSave = useRpc(trackersSaveRpc);
  // What is typed; null shows what the host holds.
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const typed = useCallback(
    () => ({
      baseUrl: baseUrl ?? connection?.baseUrl ?? "",
      email: email ?? connection?.email ?? "",
      token,
    }),
    [baseUrl, email, token, connection],
  );
  const test = useCallback(async () => {
    setNote(null);
    accept(await callTest({ tracker: "jira", ...typed() }));
    setNote("Jira accepted the sign-in");
  }, [callTest, typed]);
  const save = useCallback(async () => {
    setNote(null);
    accept(await callSave({ action: "save-jira", ...typed() }));
    setBaseUrl(null);
    setEmail(null);
    setToken("");
  }, [callSave, typed]);
  const clear = useCallback(async () => {
    setNote(null);
    accept(await callSave({ action: "clear", tracker: "jira" }));
    setBaseUrl(null);
    setEmail(null);
    setToken("");
  }, [callSave]);
  const kept = connection?.source === "saved";
  return (
    <>
      <ConnectionField
        label="Jira address"
        hint="Your Jira site, such as https://your-site.atlassian.net."
        value={baseUrl ?? connection?.baseUrl ?? ""}
        onChangeText={setBaseUrl}
        styles={styles}
      />
      <ConnectionField
        label="Jira email"
        hint="The Atlassian account the API token belongs to."
        value={email ?? connection?.email ?? ""}
        onChangeText={setEmail}
        styles={styles}
      />
      <ConnectionField
        label="Jira API token"
        hint={
          kept
            ? "Leave empty to keep the saved token. Stored on the host for its user only; never shown again."
            : "Stored on the host for its user only; never shown again."
        }
        value={token}
        onChangeText={setToken}
        secret
        styles={styles}
      />
      <ConnectionButtons
        name="Jira"
        source={connection?.source}
        note={note}
        test={test}
        save={save}
        clear={clear}
        styles={styles}
      />
    </>
  );
}

interface SentryProps {
  connection: Connections["sentry"] | undefined;
  styles: OfficeStyles;
}

/** Sentry's auth token, kept as Jira's. A test asks the organisation and address set below. */
export function SentryConnection({ connection, styles }: SentryProps) {
  const callTest = useRpc(trackersTestRpc);
  const callSave = useRpc(trackersSaveRpc);
  const [token, setToken] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const test = useCallback(async () => {
    setNote(null);
    accept(await callTest({ tracker: "sentry", token }));
    setNote("Sentry accepted the token");
  }, [callTest, token]);
  const save = useCallback(async () => {
    setNote(null);
    accept(await callSave({ action: "save-sentry", token }));
    setToken("");
  }, [callSave, token]);
  const clear = useCallback(async () => {
    setNote(null);
    accept(await callSave({ action: "clear", tracker: "sentry" }));
    setToken("");
  }, [callSave]);
  const kept = connection?.source === "saved";
  return (
    <>
      <ConnectionField
        label="Sentry auth token"
        hint={
          kept
            ? "A token is saved; type a new one to replace it. Stored on the host for its user only; never shown again."
            : "Stored on the host for its user only; never shown again."
        }
        value={token}
        onChangeText={setToken}
        secret
        styles={styles}
      />
      <ConnectionButtons
        name="Sentry"
        source={connection?.source}
        note={note}
        test={test}
        save={save}
        clear={clear}
        styles={styles}
      />
    </>
  );
}
