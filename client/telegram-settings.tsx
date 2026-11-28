import { useCallback, useState } from "react";
import { View } from "react-native";
import { Text } from "./text.js";
import { TextInput } from "./text.js";
import { useRpc } from "@getpaseo/plugin/client";
import { telegramSaveRpc, telegramTestRpc, type TelegramState } from "../shared/contracts.js";
import { TELEGRAM_CHAT, TELEGRAM_USER, TELEGRAM_USERS_MAX } from "../shared/settings.js";
import { ActionButton } from "./action-button.js";
import { ChoicePills } from "./choice-pills.js";
import type { HostValues } from "./host-switches.js";
import { LabeledSwitch } from "./labeled-switch.js";
import { SettingField } from "./setting-field.js";
import type { OfficeStyles } from "./styles.js";

export type TelegramSetting =
  | "Chat id"
  | "User ids that are heard"
  | "A task needs you"
  | "A claim stalled"
  | "A task is done"
  | "Incidents"
  | "Plan warnings"
  | "Tasks from Telegram go to";

const LANDS: readonly { value: HostValues["telegramLands"]; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "To do" },
];

const TOKEN_HINT = "Stored on the host for its user only; never shown again.";
const CHAT_HINT = "The group or private chat the office writes to. A group's id starts with -.";
const USERS_HINT =
  "Only these Telegram user ids are heard. A message that reaches an agent can make it run commands, so list yourself and people you trust.";

const SWITCHES: readonly {
  label:
    | Extract<TelegramSetting, "A task needs you" | "A claim stalled" | "A task is done">
    | "Incidents"
    | "Plan warnings";
  key: "telegramNeeds" | "telegramStalled" | "telegramDone" | "telegramIncidents" | "telegramPlan";
}[] = [
  { label: "A task needs you", key: "telegramNeeds" },
  { label: "A claim stalled", key: "telegramStalled" },
  { label: "A task is done", key: "telegramDone" },
  { label: "Incidents", key: "telegramIncidents" },
  { label: "Plan warnings", key: "telegramPlan" },
];

/** Where the token comes from, as the line under its field says it; none before the host has said. */
function sourceText(telegram: TelegramState | undefined): string | null {
  if (telegram === undefined) return null;
  if (telegram.source === "saved") return "Saved";
  if (telegram.source === "env") return "From the host's environment (TELEGRAM_BOT_TOKEN)";
  return "No token yet";
}

/** What is wrong with the lines typed, as the schema would refuse them, by line; null when none. */
function usersProblem(entries: readonly string[]): string | null {
  for (const [index, entry] of entries.entries()) {
    if (!TELEGRAM_USER.test(entry)) {
      return `Line ${index + 1}: "${entry}" is not a Telegram user id`;
    }
  }
  return entries.length > TELEGRAM_USERS_MAX ? `At most ${TELEGRAM_USERS_MAX} user ids` : null;
}

interface TokenProps {
  telegram: TelegramState | undefined;
  /** The chat set: the test writes to it. */
  chat: string;
  styles: OfficeStyles;
}

/**
 * The bot's token, typed here and sent to the host once. It lives in this field only until Save
 * (or Remove) has answered, success or failure, and is never shown again: the line under the
 * field says where the host's one comes from. No text built here holds it.
 */
function TelegramToken({ telegram, chat, styles }: TokenProps) {
  const callSave = useRpc(telegramSaveRpc);
  const callTest = useRpc(telegramTestRpc);
  const [token, setToken] = useState("");
  const [asking, setAsking] = useState(false);
  // What the last test came to, with the token source and chat it was made for.
  const [tested, setTested] = useState<{ text: string; basis: string } | null>(null);
  const basis = `${telegram?.source ?? ""}|${chat}`;
  const note = tested !== null && tested.basis === basis ? tested.text : null;
  const type = useCallback((next: string) => {
    setToken(next);
    setTested(null);
  }, []);
  const save = useCallback(async () => {
    const typed = token.trim();
    setTested(null);
    try {
      await callSave({ token: typed });
    } finally {
      // Gone whether the host took it or not: a failed one is typed again, not kept.
      setToken("");
    }
  }, [callSave, token]);
  const ask = useCallback(() => setAsking(true), []);
  const keep = useCallback(() => setAsking(false), []);
  const remove = useCallback(async () => {
    setTested(null);
    setToken("");
    // The question stays until the host has answered, so a refusal shows on its button.
    await callSave({ token: "" });
    setAsking(false);
  }, [callSave]);
  const test = useCallback(async () => {
    setTested(null);
    const result = await callTest({});
    // The host's own safe reason becomes the button's error.
    if (!result.ok) throw new Error(result.problem);
    setTested({ text: `Connected as @${result.bot}. A message was sent to the chat.`, basis });
  }, [callTest, basis]);
  const source = sourceText(telegram);
  return (
    <View style={styles.headerField}>
      <Text style={styles.sheetLabel}>Telegram bot token</Text>
      <TextInput
        accessibilityLabel="Telegram bot token"
        accessibilityHint={TOKEN_HINT}
        value={token}
        onChangeText={type}
        autoComplete="new-password"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        style={styles.fieldInput}
      />
      <Text style={styles.fieldHint}>{TOKEN_HINT}</Text>
      {source === null ? null : (
        <Text testID="telegram-source" style={styles.fieldHint}>
          {source}
        </Text>
      )}
      {note === null ? null : <Text style={styles.fieldHint}>{note}</Text>}
      {asking ? <Text style={styles.fieldHint}>Remove the saved token?</Text> : null}
      <View style={styles.actions}>
        <ActionButton
          label="Test"
          pendingLabel="Testing..."
          name="Test Telegram"
          onPress={test}
          disabled={telegram?.source == null || chat === ""}
          styles={styles}
        />
        <ActionButton
          label="Save"
          pendingLabel="Saving..."
          name="Save Telegram token"
          onPress={save}
          disabled={token.trim() === ""}
          primary
          styles={styles}
        />
        {telegram?.source === "saved" && !asking ? (
          <ActionButton
            label="Remove"
            pendingLabel="Removing..."
            name="Remove saved Telegram token"
            onPress={ask}
            styles={styles}
          />
        ) : null}
        {asking ? (
          <>
            <ActionButton
              label="Remove"
              pendingLabel="Removing..."
              name="Confirm remove the saved Telegram token"
              onPress={remove}
              styles={styles}
            />
            <ActionButton
              label="Keep it"
              pendingLabel="Keeping..."
              name="Keep the saved Telegram token"
              onPress={keep}
              styles={styles}
            />
          </>
        ) : null}
      </View>
    </View>
  );
}

function TelegramStatus({
  telegram,
  styles,
}: {
  telegram: TelegramState | undefined;
  styles: OfficeStyles;
}) {
  if (telegram === undefined) return null;
  return (
    <View testID="telegram-status">
      {telegram.on ? <Text style={styles.fieldHint}>On.</Text> : null}
      {!telegram.on && telegram.problem === null ? (
        <Text style={styles.fieldHint}>Off: needs a token, a chat and at least one user id.</Text>
      ) : null}
      {telegram.problem === null ? null : (
        <Text style={styles.standupBlocker}>{telegram.problem}</Text>
      )}
      {telegram.dropped > 0 ? (
        <Text style={styles.fieldHint}>{`Messages from others ignored: ${telegram.dropped}`}</Text>
      ) : null}
    </View>
  );
}

interface Props {
  values: HostValues | null;
  /** Absent until the office's server has read the bridge. */
  telegram: TelegramState | undefined;
  change(setting: TelegramSetting, patch: Partial<HostValues>): Promise<boolean>;
  saveProblem(setting: TelegramSetting): string | null;
  styles: OfficeStyles;
}

/**
 * The Telegram bridge: the bot's token, the chat, the user ids that are heard, what is sent, where
 * a task from Telegram lands, and where the bridge stands. An entry the schema would refuse is
 * told, and not sent.
 */
export function TelegramSettings({ values, telegram, change, saveProblem, styles }: Props) {
  const saveChat = useCallback(
    async (next: string) => {
      const refused =
        next !== "" && !TELEGRAM_CHAT.test(next)
          ? "A chat id is digits, with a minus first for a group"
          : null;
      if (refused !== null) return { refused };
      return change("Chat id", { telegramChat: next });
    },
    [change],
  );
  const saveUsers = useCallback(
    async (next: string) => {
      const entries = next
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "");
      const problem = usersProblem(entries);
      if (problem !== null) return { refused: problem };
      return change("User ids that are heard", { telegramUsers: entries });
    },
    [change],
  );
  const saveLands = useCallback(
    (next: HostValues["telegramLands"]) =>
      change("Tasks from Telegram go to", { telegramLands: next }),
    [change],
  );
  return (
    <View style={styles.headerFields}>
      <TelegramToken telegram={telegram} chat={values?.telegramChat ?? ""} styles={styles} />
      <SettingField
        label="Chat id"
        hint={CHAT_HINT}
        value={values?.telegramChat ?? null}
        onSave={saveChat}
        problem={saveProblem("Chat id")}
        styles={styles}
      />
      <SettingField
        label="User ids that are heard"
        hint={USERS_HINT}
        value={values === null ? null : values.telegramUsers.join("\n")}
        onSave={saveUsers}
        problem={saveProblem("User ids that are heard")}
        lines={3}
        styles={styles}
      />
      <Text style={styles.sheetLabel}>What is sent</Text>
      {SWITCHES.map(({ label, key }) => (
        <TelegramSwitch
          key={key}
          label={label}
          field={key}
          value={values?.[key] ?? null}
          problem={saveProblem(label)}
          change={change}
          styles={styles}
        />
      ))}
      <ChoicePills
        label="Tasks from Telegram go to"
        hint="Backlog holds a task until you start it."
        options={LANDS}
        value={values?.telegramLands ?? null}
        onSave={saveLands}
        problem={saveProblem("Tasks from Telegram go to")}
        styles={styles}
      />
      <TelegramStatus telegram={telegram} styles={styles} />
    </View>
  );
}

function TelegramSwitch({
  label,
  field,
  value,
  problem,
  change,
  styles,
}: {
  label: TelegramSetting;
  field: (typeof SWITCHES)[number]["key"];
  value: boolean | null;
  problem: string | null;
  change: Props["change"];
  styles: OfficeStyles;
}) {
  const toggle = useCallback(
    (next: boolean) => void change(label, { [field]: next }),
    [change, label, field],
  );
  return (
    <View style={styles.headerField}>
      <LabeledSwitch label={label} value={value} onChange={toggle} styles={styles} />
      {problem === null ? null : (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {problem}
        </Text>
      )}
    </View>
  );
}
