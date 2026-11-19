import { useCallback, useEffect, type ReactNode } from "react";
import { KeyboardAvoidingView, Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import { COLUMN_TABS, type ColumnTab, type ColumnView } from "./column-model.js";
import { ColumnTabs, type ColumnBadges, type ColumnSession } from "./office-column.js";
import type { OfficeStyles } from "./styles.js";

export interface ColumnSheetProps {
  /** What the sheet shows; null while it is closed. */
  open: ColumnView | null;
  /** The open session's title, while the sheet shows a session. */
  sessionTitle: string | null;
  /** The theme's foreground, which an icon-only control's glyph rests at. */
  color: string;
  iconSize: number;
  /** "web" listens for Escape; "ios" lifts the sheet's body over the keyboard. */
  platform: "ios" | "android" | "web";
  onClose(): void;
  /** From a session back to Sessions; the session stays open. */
  onBack(): void;
  /** Closes the shown session's tab. */
  onCloseSession(): void;
  styles: OfficeStyles;
  /** The open tab's or session's panel. */
  children: ReactNode;
}

/**
 * The column on a phone, as a sheet over the floor: the scrim and the chosen tab's panel. The
 * surface draws it inside the floor's box, after the floor, so the sheet's bottom is the floor's
 * and the bar under the floor stays pressable while the sheet is open. The floor is the same view
 * in both layouts, so a flip between them does not draw the floor again.
 */
export function ColumnSheet({
  open,
  sessionTitle,
  color,
  iconSize,
  platform,
  onClose,
  onBack,
  onCloseSession,
  styles,
  children,
}: ColumnSheetProps) {
  useEffect(() => {
    if (platform !== "web" || open === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [platform, open, onClose]);
  if (open === null) return null;
  const session = open.kind === "session";
  const title = session
    ? (sessionTitle ?? "Session")
    : (COLUMN_TABS.find((each) => each.tab === open.tab)?.label ?? "");
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close the column"
        onPress={onClose}
        style={styles.sheetScrim}
      />
      <View testID="office-column-sheet" style={styles.columnSheet}>
        <View style={styles.columnSheetHead}>
          {session ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to Sessions"
              onPress={onBack}
              style={styles.segment}
            >
              <Icon name="ArrowLeft" size={iconSize} color={color} />
            </Pressable>
          ) : null}
          <Text accessibilityRole="header" numberOfLines={1} style={styles.columnSheetTitle}>
            {title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={session ? `Close ${title}` : "Close"}
            onPress={session ? onCloseSession : onClose}
            style={styles.segment}
          >
            <Icon name="X" size={iconSize} color={color} />
          </Pressable>
        </View>
        {/* The Chat box sits at the sheet's bottom: on iOS the keyboard would cover it. */}
        <KeyboardAvoidingView
          behavior={platform === "ios" ? "padding" : undefined}
          style={styles.columnBody}
        >
          {children}
        </KeyboardAvoidingView>
      </View>
    </>
  );
}

const ignore = (): void => undefined;

export interface ColumnBarProps {
  /** What the sheet shows; null while it is closed. */
  open: ColumnView | null;
  /** The open sessions: the Sessions tab carries their count. */
  sessions: readonly ColumnSession[];
  badges: ColumnBadges;
  color: string;
  iconSize: number;
  onOpen(tab: ColumnTab): void;
  onClose(): void;
  styles: OfficeStyles;
}

/** The phone's bar of the column's tabs, under the floor: a press opens that tab's sheet. */
export function ColumnBar({
  open,
  sessions,
  badges,
  color,
  iconSize,
  onOpen,
  onClose,
  styles,
}: ColumnBarProps) {
  // The open tab's own press closes the sheet, as a second press on a toggle does. A session's
  // sheet has no tab chosen: Sessions takes it back to the list.
  const press = useCallback(
    (tab: ColumnTab) => {
      if (open?.kind === "tab" && open.tab === tab) onClose();
      else onOpen(tab);
    },
    [open, onOpen, onClose],
  );
  return (
    <View style={styles.columnBar}>
      <ColumnTabs
        view={open}
        badges={badges}
        sessions={sessions}
        sessionTabs={false}
        touch
        color={color}
        iconSize={iconSize}
        labels={false}
        vertical={false}
        onPress={press}
        onSession={ignore}
        onClose={ignore}
        styles={styles}
      />
    </View>
  );
}
