import { useCallback, useMemo } from "react";
import { Image, Pressable, StyleSheet, View, type PressableStateCallbackType } from "react-native";
import { Text } from "./text.js";
import { Icon } from "@getpaseo/plugin/client/ui";
import {
  BOARD_LAYOUTS,
  OFFICE_GRAPHICS,
  OFFICE_LIGHTING,
  OFFICE_SCENES,
} from "../shared/settings.js";
import type { OfficeStyles } from "./styles.js";
import type { useOfficeScene } from "./use-street.js";
import type { useBoardLayoutChoices } from "./use-board-layouts.js";
import { scenePreviews } from "./scene-previews.js";

const scenes = { plain: "Plain", city: "City", countryside: "Countryside", beach: "Beach" };
const lighting = { auto: "App theme", day: "Day", night: "Night" };
const graphics = { auto: "Auto", low: "Low", medium: "Medium", high: "High" };
const boardLayouts = { kanban: "Kanban", list: "List" };
const ROOM_ORDER = ["list", "kanban"] as const;
const lightIcons = { auto: "Monitor", day: "Sun", night: "Moon" };
const layout = StyleSheet.create({
  body: { gap: 20 },
  section: { gap: 9 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pair: { flexDirection: "row", flexBasis: 225, flexGrow: 1, gap: 8 },
  tile: {
    flex: 1,
    minWidth: 0,
    flexDirection: "column",
    paddingHorizontal: 0,
    alignItems: "stretch",
    gap: 0,
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
  },
  preview: { width: "100%", height: 80 },
  caption: {
    paddingHorizontal: 9,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  light: {
    flexGrow: 1,
    flexBasis: 75,
    paddingHorizontal: 3,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
});

function Choice<T extends string>({
  value,
  label,
  setting,
  styles,
  preview,
  icon,
}: {
  value: T;
  label: string;
  setting: { on: T | null; set(value: T): void };
  styles: OfficeStyles;
  preview?: string;
  icon?: string;
}) {
  const press = useCallback(() => setting.set(value), [setting, value]);
  const selected = setting.on === value;
  const color = selected ? styles.workspaceAccent : styles.iconColor;
  const image = useMemo(() => ({ uri: preview }), [preview]);
  const appearance = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      selected || pressed ? styles.sidebarButtonActive : styles.sidebarButton,
      preview ? layout.tile : layout.light,
      selected && { borderColor: styles.workspaceAccent },
    ],
    [selected, styles, preview],
  );
  const text = <Text style={styles.sidebarButtonText}>{label}</Text>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-pressed={selected}
      disabled={setting.on === null}
      onPress={press}
      style={appearance}
    >
      {preview ? (
        <>
          <Image accessible={false} source={image} resizeMode="cover" style={layout.preview} />
          <View style={layout.caption}>
            {text}
            {selected && <Icon name="CircleCheck" size={15} color={color} />}
          </View>
        </>
      ) : (
        <>
          {icon && <Icon name={icon} size={16} color={color} />}
          {text}
        </>
      )}
    </Pressable>
  );
}

export function SceneChoices({
  choice,
  styles,
}: {
  choice: ReturnType<typeof useOfficeScene>;
  styles: OfficeStyles;
}) {
  return (
    <View style={layout.body}>
      <View style={layout.section}>
        <Text style={styles.sheetLabel}>Outdoor scene</Text>
        <View role="group" aria-label="Outdoor scene" style={layout.row}>
          {[OFFICE_SCENES.slice(0, 2), OFFICE_SCENES.slice(2)].map((pair) => (
            <View key={pair[0]} style={layout.pair}>
              {pair.map((value) => (
                <Choice
                  key={value}
                  value={value}
                  label={scenes[value]}
                  setting={choice.scene}
                  styles={styles}
                  preview={scenePreviews[value]}
                />
              ))}
            </View>
          ))}
        </View>
      </View>
      <View style={layout.section}>
        <Text style={styles.sheetLabel}>Lighting</Text>
        <View role="group" aria-label="Lighting" style={layout.row}>
          {OFFICE_LIGHTING.map((value) => (
            <Choice
              key={value}
              value={value}
              label={lighting[value]}
              setting={choice.lighting}
              styles={styles}
              icon={lightIcons[value]}
            />
          ))}
        </View>
      </View>
      <View style={layout.section}>
        <Text style={styles.sheetLabel}>Graphics</Text>
        <View role="group" aria-label="Graphics" style={layout.row}>
          {OFFICE_GRAPHICS.map((value) => (
            <Choice
              key={value}
              value={value}
              label={graphics[value]}
              setting={choice.graphics}
              styles={styles}
            />
          ))}
        </View>
        <Text style={styles.fieldHint}>
          Auto picks for this device and steps down when frames come late. Low draws no shadows, at
          30 frames a second.
        </Text>
      </View>
    </View>
  );
}

export function BoardChoices({
  choice,
  styles,
}: {
  choice: ReturnType<typeof useBoardLayoutChoices>;
  styles: OfficeStyles;
}) {
  return (
    <View style={layout.body}>
      <Text style={styles.sheetLabel}>Boards</Text>
      {(
        [
          ["Lobby board", choice.lobby, BOARD_LAYOUTS],
          ["Room boards", choice.rooms, ROOM_ORDER],
        ] as const
      ).map(([name, setting, values]) => (
        <View key={name} style={layout.section}>
          <Text style={styles.fieldHint}>{name}</Text>
          <View role="group" aria-label={name} style={layout.row}>
            {values.map((value) => (
              <Choice
                key={value}
                value={value}
                label={boardLayouts[value]}
                setting={setting}
                styles={styles}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
