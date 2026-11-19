import { useCallback } from "react";
import { View, Text } from "react-native";
import type { WeatherState } from "../shared/contracts.js";
import { MANUAL_CHOICES, MANUAL_LABELS, WEATHER_ADDRESS_EXAMPLE } from "../shared/weather.js";
import type { HostValues } from "./host-switches.js";
import type { OfficeStyles } from "./styles.js";
import { ChoicePills } from "./choice-pills.js";
import { SettingField } from "./setting-field.js";
import { weatherStatus } from "./weather-text.js";
export type WeatherSetting = "Weather" | "Weather choice" | "Weather address";
const MODES = [
  { value: "off", label: "Off" },
  { value: "manual", label: "Manual" },
  { value: "service", label: "From a service" },
] as const;
const CHOICES = MANUAL_CHOICES.map((value) => ({ value, label: MANUAL_LABELS[value] }));
const MODE_HINT = "Rain, clouds and storms outside the 3D floor. Off draws none.";
const CHOICE_HINT =
  "Follow the season draws the season's weather: cloudy for Halloween, clear otherwise.";
const ADDRESS_HINT = `An address that answers in open-meteo's shape, for example ${WEATHER_ADDRESS_EXAMPLE}. https, or http on the host itself. The host reads it every 15 minutes while an office is open.`;

interface Props {
  values: HostValues | null;
  weather: WeatherState | undefined;
  change(setting: WeatherSetting, patch: Partial<HostValues>): Promise<boolean>;
  saveProblem(setting: WeatherSetting): string | null;
  styles: OfficeStyles;
}
export function WeatherFields({ values, weather, change, saveProblem, styles }: Props) {
  const saveweatherMode = useCallback(
    (weatherMode: HostValues["weatherMode"]) => change("Weather", { weatherMode }),
    [change],
  );
  const saveweatherManual = useCallback(
    (weatherManual: HostValues["weatherManual"]) => change("Weather choice", { weatherManual }),
    [change],
  );
  const saveweatherUrl = useCallback(
    (weatherUrl: HostValues["weatherUrl"]) => change("Weather address", { weatherUrl }),
    [change],
  );
  const mode = values?.weatherMode ?? null;
  const status = weatherStatus({
    mode: mode ?? "off",
    address: values?.weatherUrl ?? "",
    state: weather,
    now: Date.now(),
  });
  return (
    <View style={styles.headerFields}>
      <ChoicePills
        label="Weather"
        hint={MODE_HINT}
        options={MODES}
        value={mode}
        onSave={saveweatherMode}
        problem={saveProblem("Weather")}
        styles={styles}
      />
      {mode === "manual" && (
        <ChoicePills
          label="Weather choice"
          hint={CHOICE_HINT}
          options={CHOICES}
          value={values?.weatherManual ?? null}
          onSave={saveweatherManual}
          problem={saveProblem("Weather choice")}
          styles={styles}
        />
      )}
      {mode === "service" && (
        <SettingField
          label="Weather address"
          hint={ADDRESS_HINT}
          value={values?.weatherUrl ?? null}
          onSave={saveweatherUrl}
          problem={saveProblem("Weather address") ?? weather?.problem ?? null}
          styles={styles}
        />
      )}
      {status && <Text style={styles.fieldHint}>{status}</Text>}
    </View>
  );
}
