import { useCallback, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "./text.js";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
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
  /** A dialog's body that holds the sections: they fill it and scroll inside it. */
  body: { flex: 1, minHeight: 0, padding: 0, gap: 0 },
  /** A phone's tab: the icon over its name, so all four read alike at any width. */
  tabStacked: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 2,
    paddingVertical: 6,
    minHeight: 44,
    borderRadius: 8,
  },
  /** A phone's page: room under the last field, so it clears the home bar. */
  pagePhone: { padding: 18, paddingBottom: 32, gap: 20 },
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
  stacked,
  styles,
}: {
  section: Section;
  active: boolean;
  select(section: Section): void;
  stacked: boolean;
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
        stacked ? settingsLayout.tabStacked : settingsLayout.tab,
      )}
    >
      <Icon
        name={icons[section]}
        size={16}
        color={active ? styles.workspaceAccent : styles.iconColor}
      />
      <Text numberOfLines={1} style={styles.sidebarButtonText}>
        {section}
      </Text>
    </Pressable>
  );
}

export function SettingsSections({
  appearance,
  teams,
  automation,
  services,
  bounded = false,
  styles,
}: {
  /**
   * In a dialog, on a phone's sheet or a wide screen: the tabs stay and the chosen section
   * scrolls under them. The settings screen scrolls as a whole and leaves it false.
   */
  bounded?: boolean;
  appearance: ReactNode;
  teams: ReactNode;
  automation: ReactNode;
  services: ReactNode;
  styles: OfficeStyles;
}) {
  const [section, select] = useState<Section>("Appearance");
  // Four tabs with an icon beside each name do not fit a phone's width.
  const stacked = useWindowDimensions().width < 520;
  const pages = {
    Appearance: appearance,
    Teams: teams,
    Automation: automation,
    Services: services,
  };
  const contentStyle = bounded ? settingsLayout.fill : undefined;
  const pageStyle = stacked ? settingsLayout.pagePhone : settingsLayout.page;
  const content = sections.map((name) => (
    <View key={name} style={name !== section ? styles.hidden : contentStyle}>
      {bounded ? (
        <ScrollView
          style={settingsLayout.fill}
          contentContainerStyle={pageStyle}
          keyboardShouldPersistTaps="handled"
        >
          {pages[name]}
        </ScrollView>
      ) : (
        <View style={settingsLayout.page}>{pages[name]}</View>
      )}
    </View>
  ));
  return (
    <View style={bounded ? settingsLayout.fill : undefined}>
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
            stacked={stacked}
            styles={styles}
          />
        ))}
      </View>
      {content}
    </View>
  );
}
