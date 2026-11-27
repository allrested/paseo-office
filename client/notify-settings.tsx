import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { notifyTestRpc } from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import { ChoicePills } from "./choice-pills.js";
import type { HostValues } from "./host-switches.js";
import { SettingField } from "./setting-field.js";
import type { OfficeStyles } from "./styles.js";

export type NotifySetting = "Webhook address" | "Notify for";

const LEVELS = [
  { value: "danger", label: "Danger only" },
  { value: "warning", label: "Warning and danger" },
] as const;
const LEVEL_HINT =
  "Danger is a loop and an incident. Warning adds a refused call, two agents in one file, a taken port and failing checks.";

const HINT =
  "The office posts a JSON message here when it raises an alert or opens an incident, so you hear of it with no office open. https, or http on the host itself. Anyone who can open these settings can read the address.";

interface Props {
  values: HostValues | null;
  change(setting: NotifySetting, patch: Partial<HostValues>): Promise<boolean>;
  saveProblem(setting: NotifySetting): string | null;
  styles: OfficeStyles;
}

/** The owner's webhook, and a button that posts one message to the address saved. */
export function NotifyFields({ values, change, saveProblem, styles }: Props) {
  const callTest = useRpc(notifyTestRpc);
  const [note, setNote] = useState<string | null>(null);
  const save = useCallback(
    (notifyUrl: string) => {
      setNote(null);
      return change("Webhook address", { notifyUrl });
    },
    [change],
  );
  const saveLevel = useCallback(
    (notifyLevel: HostValues["notifyLevel"]) => change("Notify for", { notifyLevel }),
    [change],
  );
  const test = useCallback(async () => {
    setNote(null);
    const result = await callTest({});
    if (!result.ok) throw new Error(result.problem);
    setNote("The webhook took the test message");
  }, [callTest]);
  return (
    <View style={styles.headerFields}>
      <SettingField
        label="Webhook address"
        hint={HINT}
        value={values?.notifyUrl ?? null}
        onSave={save}
        problem={saveProblem("Webhook address")}
        styles={styles}
      />
      <ChoicePills
        label="Notify for"
        hint={LEVEL_HINT}
        options={LEVELS}
        value={values?.notifyLevel ?? null}
        onSave={saveLevel}
        problem={saveProblem("Notify for")}
        styles={styles}
      />
      {values?.notifyUrl ? (
        <View style={styles.headerField}>
          {note === null ? null : <Text style={styles.fieldHint}>{note}</Text>}
          <View style={styles.actions}>
            <ActionButton
              label="Send a test"
              pendingLabel="Sending..."
              name="Send a test message to the webhook"
              onPress={test}
              styles={styles}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}
