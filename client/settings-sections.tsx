import { useCallback, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import { useFullscreenDialog } from "./office-modal.js";
import type { OfficeStyles } from "./styles.js";

const sections = ["Appearance", "Teams", "Automation", "Services"] as const;
type Section = (typeof sections)[number];
const icons = {
  Appearance: "Palette",
  Teams: "UsersRound",
  Automation: "CalendarClock",
  Services: "Plug",
};
export const settingsLayout = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  flush: { padding: 0, gap: 0 },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    alignContent: "center",
    gap: 5,
    paddingHorizontal: 2,
    minHeight: 44,
    borderRadius: 8,
  },
  page: { padding: 18, gap: 20 },
  block: { gap: 10 },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
});

function SectionButton({
  section,
  active,
  select,
  styles,
}: {
  section: Section;
  active: boolean;
  select(section: Section): void;
  styles: OfficeStyles;
}) {
  const press = useCallback(() => select(section), [select, section]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={section}
      aria-pressed={active}
      onPress={press}
      style={StyleSheet.compose(
        active ? styles.sidebarButtonActive : styles.workspaceAction,
        settingsLayout.tab,
      )}
    >
      <Icon
        name={icons[section]}
        size={16}
        color={active ? styles.workspaceAccent : styles.iconColor}
      />
      <Text style={styles.sidebarButtonText}>{section}</Text>
    </Pressable>
  );
}

export function SettingsSections({
  appearance,
  teams,
  automation,
  services,
  styles,
}: {
  appearance: ReactNode;
  teams: ReactNode;
  automation: ReactNode;
  services: ReactNode;
  styles: OfficeStyles;
}) {
  const [section, select] = useState<Section>("Appearance");
  const fullscreen = useFullscreenDialog();
  const pages = {
    Appearance: appearance,
    Teams: teams,
    Automation: automation,
    Services: services,
  };
  const contentStyle = fullscreen ? settingsLayout.fill : undefined;
  const content = sections.map((name) => (
    <View key={name} style={name !== section ? styles.hidden : contentStyle}>
      {fullscreen ? (
        <ScrollView style={settingsLayout.fill} contentContainerStyle={settingsLayout.page}>
          {pages[name]}
        </ScrollView>
      ) : (
        <View style={settingsLayout.page}>{pages[name]}</View>
      )}
    </View>
  ));
  return (
    <View style={fullscreen ? settingsLayout.fill : undefined}>
      <View
        role="group"
        aria-label="Settings sections"
        style={StyleSheet.compose(settingsLayout.nav, {
          borderBottomColor: styles.sidebarButton.borderColor,
        })}
      >
        {sections.map((name) => (
          <SectionButton
            key={name}
            section={name}
            active={section === name}
            select={select}
            styles={styles}
          />
        ))}
      </View>
      {content}
    </View>
  );
}
