import { useCallback } from "react";
import { View } from "react-native";
import { Text } from "./text.js";
import { useSettings } from "@getpaseo/plugin/client";
import { LANGUAGE_CHOICES, LANGUAGE_NAMES, type LanguageChoice } from "../shared/scene-language.js";
import { officeLanguageSettings } from "../shared/settings.js";
import { failureText } from "./action-button.js";
import { SegmentPill } from "./segment-pill.js";
import type { OfficeStyles } from "./styles.js";

export const LANGUAGE_LABEL = "3D office language";
const NAMES = { auto: "Automatic", ...LANGUAGE_NAMES };

export function LanguageSetting({ styles }: { styles: OfficeStyles }) {
  const settings = useSettings(officeLanguageSettings);
  const selected = settings.status === "ready" ? settings.values.choice : "auto";
  const revision =
    settings.status === "ready" || settings.status === "invalid" ? settings.revision : null;
  const { save, saving, saveError } = settings;
  const disabled = revision === null || saving;
  const choose = useCallback(
    (choice: LanguageChoice) => {
      if (revision !== null && !saving) void save({ choice }, revision);
    },
    [save, saving, revision],
  );
  return (
    <View style={styles.headerField}>
      <Text style={styles.sheetLabel}>{LANGUAGE_LABEL}</Text>
      <View
        role="group"
        aria-label={LANGUAGE_LABEL}
        style={disabled ? styles.notesDaysDisabled : styles.notesDays}
      >
        {LANGUAGE_CHOICES.map((choice) => (
          <SegmentPill
            key={choice}
            value={choice}
            name={NAMES[choice]}
            on={choice === selected}
            disabled={disabled}
            onPress={choose}
            styles={styles}
          />
        ))}
      </View>
      <Text style={styles.fieldHint}>
        The signs, labels and speech in the 3D office. The column, the cards and this page stay in
        English. Automatic follows the app&apos;s language where the office has it.
      </Text>
      {saveError === null ? null : (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {failureText("Save the 3D office language", saveError)}
        </Text>
      )}
    </View>
  );
}
