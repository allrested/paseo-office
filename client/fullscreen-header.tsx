import { OfficeMark } from "./office-mark.js";
import { useOfficeBrand } from "./office-brand-context.js";
import { useCallback, useState, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import { ColumnTabs, type ColumnBadges, type ColumnSession } from "./office-column.js";
import type { ColumnState } from "./use-column.js";
import type { OfficeStyles } from "./styles.js";

export interface SidebarControls {
  sessionsAvailable: boolean;
  sessionsOpen: boolean;
  column: ColumnState;
  hideSessions(hidden: boolean): void;
}

interface SidebarButtonProps {
  name: string;
  icon: string;
  expanded: boolean;
  toggle(): void;
  color: string;
  styles: OfficeStyles;
}

function SidebarButton({ name, icon, expanded, toggle, color, styles }: SidebarButtonProps) {
  const [hovered, setHovered] = useState(false);
  const enter = useCallback(() => setHovered(true), []);
  const leave = useCallback(() => setHovered(false), []);
  const buttonStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => {
      if (pressed || hovered) return styles.sidebarButtonHover;
      return expanded ? styles.sidebarButtonActive : styles.sidebarButton;
    },
    [styles, expanded, hovered],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${expanded ? "Hide" : "Show"} ${name.toLowerCase()} sidebar`}
      aria-expanded={expanded}
      onPress={toggle}
      onHoverIn={enter}
      onHoverOut={leave}
      style={buttonStyle}
    >
      <Icon name={icon} size={16} color={color} />
      <Text style={styles.sidebarButtonText}>{name}</Text>
    </Pressable>
  );
}

const NO_HEADER_SESSIONS: readonly ColumnSession[] = [];

interface FullscreenHeaderProps {
  badges: ColumnBadges;
  sidebars: SidebarControls;
  modes: ReactNode;
  onOffice(): void;
  children: ReactNode;
  color: string;
  styles: OfficeStyles;
}

/** Keep both sidebar toggles in the header, reachable even when the floor spans the window. */
export function FullscreenHeader({
  sidebars,
  badges,
  modes,
  onOffice,
  children,
  color,
  styles,
}: FullscreenHeaderProps) {
  const brand = useOfficeBrand();
  const { sessionsOpen, hideSessions, column } = sidebars;
  const { collapsed, setCollapsed } = column;
  const sessions = useCallback(() => hideSessions(sessionsOpen), [hideSessions, sessionsOpen]);
  const details = useCallback(() => setCollapsed(!collapsed), [setCollapsed, collapsed]);
  return (
    <View style={styles.fullscreenHeader}>
      <View style={styles.headerTools}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={brand.name ?? "Office 3D"}
          onPress={onOffice}
          style={styles.headerBrand}
        >
          <OfficeMark brand={brand} fallbackColor={styles.brandIcon.color} />
          <Text numberOfLines={1} style={styles.brandText}>
            {brand.name ?? "Office 3D"}
          </Text>
        </Pressable>
        {sidebars.sessionsAvailable && (
          <SidebarButton
            name="Sessions"
            icon={sessionsOpen ? "PanelLeftClose" : "PanelLeftOpen"}
            expanded={sessionsOpen}
            toggle={sessions}
            color={color}
            styles={styles}
          />
        )}
      </View>
      <View style={styles.headerTools}>
        <View style={styles.headerModes}>{modes}</View>
        {collapsed && (
          <ColumnTabs
            hideSessions
            view={null}
            badges={badges}
            sessions={NO_HEADER_SESSIONS}
            sessionTabs={false}
            touch={false}
            color={color}
            iconSize={16}
            labels={false}
            vertical={false}
            onPress={column.show}
            onSession={column.openSession}
            onClose={column.closeSession}
            styles={styles}
          />
        )}
        <SidebarButton
          name="Details"
          icon={collapsed ? "PanelRightOpen" : "PanelRightClose"}
          expanded={!collapsed}
          toggle={details}
          color={color}
          styles={styles}
        />
        <View style={styles.headerDivider} />
        {children}
      </View>
    </View>
  );
}
