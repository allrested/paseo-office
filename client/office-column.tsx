import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { PanResponder, Pressable, ScrollView, View, type LayoutChangeEvent } from "react-native";
import { Text } from "./text.js";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { DotTone } from "../shared/model.js";
import {
  COLUMN_TABS,
  clampColumn,
  countLabel,
  type ColumnTab,
  type ColumnView,
} from "./column-model.js";
import { useTabReveal } from "./tab-reveal.js";
import type { OfficeStyles } from "./styles.js";
import { useT } from "./ui-language.js";
import type { ColumnState } from "./use-column.js";

export interface ColumnBadges {
  /** The Attention tab's cards; null at none. */
  attention: string | null;
  /** The chat's messages since it was last open on this device; null at none. */
  chat: string | null;
}

/** An open session as the column's tab draws it. */
export interface ColumnSession {
  agentId: string;
  title: string;
  tone: DotTone;
}

interface TabProps {
  tab: ColumnTab;
  label: string;
  icon: string;
  selected: boolean;
  count: string | null;
  /** What the count counts: "new" for a badge, "open" for the sessions. */
  countNote: string;
  showLabel: boolean;
  color: string;
  iconSize: number;
  onPress(tab: ColumnTab): void;
  styles: OfficeStyles;
}

function Tab({
  tab,
  label,
  icon,
  selected,
  count,
  countNote,
  showLabel,
  color,
  iconSize,
  onPress,
  styles,
}: TabProps) {
  const press = useCallback(() => onPress(tab), [onPress, tab]);
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  let fill = null;
  if (selected) fill = styles.segmentFill;
  else if (hovered || pressed) fill = styles.segmentHoverFill;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={count ? `${label}, ${count} ${countNote}` : label}
      aria-selected={selected}
      onPress={press}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={styles.columnTab}
    >
      {fill === null ? null : <View style={fill} />}
      {/* The count sits on the icon's corner, inside the pill that clips. */}
      <View>
        <Icon name={icon} size={iconSize} color={color} />
        {count ? (
          <View style={styles.chatBadge}>
            <Text style={styles.chatBadgeText}>{count}</Text>
          </View>
        ) : null}
      </View>
      {showLabel ? (
        <Text style={selected ? styles.segmentTextSelected : styles.segmentText}>{label}</Text>
      ) : null}
    </Pressable>
  );
}

interface SessionTabProps {
  session: ColumnSession;
  selected: boolean;
  /** Touch has no hover: the close button is always there. */
  touch: boolean;
  color: string;
  iconSize: number;
  onSession(agentId: string): void;
  onClose(agentId: string): void;
  /** Where the tab sits in the strip, once it is drawn and when that changes. */
  onTabLayout(agentId: string, layout: { x: number; width: number }): void;
  styles: OfficeStyles;
}

/** An open session's tab: its status dot and title, and a button to close it beside them. */
function SessionTab({
  session,
  selected,
  touch,
  color,
  iconSize,
  onSession,
  onClose,
  onTabLayout,
  styles,
}: SessionTabProps) {
  const { agentId, title, tone } = session;
  const measure = useCallback(
    (event: LayoutChangeEvent) => onTabLayout(agentId, event.nativeEvent.layout),
    [onTabLayout, agentId],
  );
  const press = useCallback(() => onSession(agentId), [onSession, agentId]);
  const close = useCallback(() => onClose(agentId), [onClose, agentId]);
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  // A button the keyboard reaches is shown: opacity 0 does not take it out of the tab order.
  const [focused, setFocused] = useState(false);
  const focusIn = useCallback(() => setFocused(true), []);
  const focusOut = useCallback(() => setFocused(false), []);
  let closeStyle = styles.sessionTabClose;
  if (!touch && !selected && !hovered && !focused) closeStyle = styles.sessionTabCloseHidden;
  return (
    <View style={styles.sessionTab} onLayout={measure}>
      {selected ? <View style={styles.segmentFill} /> : null}
      <Pressable
        accessibilityRole="tab"
        accessibilityLabel={title}
        aria-selected={selected}
        onPress={press}
        onHoverIn={hoverIn}
        onHoverOut={hoverOut}
        style={styles.sessionTabMain}
      >
        <View style={styles.dot[tone]} />
        <Text numberOfLines={1} style={selected ? styles.segmentTextSelected : styles.segmentText}>
          {title}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Close ${title}`}
        onPress={close}
        onHoverIn={hoverIn}
        onHoverOut={hoverOut}
        onFocus={focusIn}
        onBlur={focusOut}
        style={closeStyle}
      >
        <Icon name="X" size={iconSize - 4} color={color} />
      </Pressable>
    </View>
  );
}

export interface ColumnTabsProps {
  /** Leaves out Attention and Activity too: the fullscreen header has them as icons. */
  hideFixed?: boolean;
  hideSessions?: boolean;
  /** What shows as chosen; null where none does (the rail, the phone's bar while closed). */
  view: ColumnView | null;
  badges: ColumnBadges;
  /** The open sessions: a tab each when `sessionTabs`, else a count on Sessions. */
  sessions: readonly ColumnSession[];
  sessionTabs: boolean;
  touch: boolean;
  color: string;
  iconSize: number;
  /** Icons alone on the rail and the phone's bar; with the chosen tab's label in the column. */
  labels: boolean;
  vertical: boolean;
  onPress(tab: ColumnTab): void;
  onSession(agentId: string): void;
  onClose(agentId: string): void;
  styles: OfficeStyles;
}

/** The column's tabs: a row in the open column, a stack on its rail. */
export function ColumnTabs({
  hideSessions = false,
  hideFixed = false,
  view,
  badges,
  sessions,
  sessionTabs,
  touch,
  color,
  iconSize,
  labels,
  vertical,
  onPress,
  onSession,
  onClose,
  styles,
}: ColumnTabsProps) {
  const t = useT();
  const tab = view?.kind === "tab" ? view.tab : null;
  const reveal = useTabReveal(view?.kind === "session" ? view.agentId : null);
  const list = (
    <View
      role="tablist"
      aria-label="Office column"
      style={vertical ? styles.columnTabsVertical : styles.columnTabs}
    >
      {COLUMN_TABS.map((each) => {
        // In the desktop fullscreen layout Sessions has its own rail and Team chat its own toolbar button.
        if (hideSessions && (each.tab === "sessions" || each.tab === "chat")) return null;
        // There the header has Attention and Activity as its own icons: the column lists sessions only.
        if (hideFixed) return null;
        let count: string | null = null;
        let countNote = "new";
        if (each.tab === "attention") count = badges.attention;
        if (each.tab === "chat") count = badges.chat;
        if (each.tab === "sessions" && !sessionTabs) {
          count = countLabel(sessions.length);
          countNote = "open";
        }
        return (
          <Tab
            key={each.tab}
            tab={each.tab}
            label={t(each.label)}
            icon={each.icon}
            selected={each.tab === tab}
            count={count}
            countNote={countNote}
            // Four labels do not fit a narrow column: the chosen tab alone says its name.
            showLabel={labels && each.tab === tab}
            color={color}
            iconSize={iconSize}
            onPress={onPress}
            styles={styles}
          />
        );
      })}
      {sessionTabs
        ? sessions.map((each) => (
            <SessionTab
              key={each.agentId}
              session={each}
              selected={view?.kind === "session" && view.agentId === each.agentId}
              touch={touch}
              color={color}
              iconSize={iconSize}
              onSession={onSession}
              onClose={onClose}
              onTabLayout={reveal.onTabLayout}
              styles={styles}
            />
          ))
        : null}
    </View>
  );
  if (!sessionTabs) return list;
  // Many sessions scroll sideways rather than wrap. A mouse reaches the ones past the edge by the
  // bar; a finger just drags.
  return (
    <ScrollView
      ref={reveal.scroller}
      horizontal
      showsHorizontalScrollIndicator={!touch}
      onLayout={reveal.onLayout}
      onScroll={reveal.onScroll}
      scrollEventThrottle={16}
      style={styles.columnTabsScroll}
    >
      {list}
    </ScrollView>
  );
}

interface IconButtonProps {
  label: string;
  icon: string;
  color: string;
  iconSize: number;
  onPress(): void;
  styles: OfficeStyles;
}

function IconButton({ label, icon, color, iconSize, onPress, styles }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.columnTab}
    >
      <Icon name={icon} size={iconSize} color={color} />
    </Pressable>
  );
}

export interface OfficeColumnProps {
  hideSessions?: boolean;
  column: ColumnState;
  /** The open sessions with their titles and status, in `column.sessions`' order. */
  sessions: readonly ColumnSession[];
  /** True on a touch screen, where a session tab's close button is always drawn. */
  touch: boolean;
  /** The surface's width, for the column's most; 0 until measured. */
  surfaceWidth: number;
  badges: ColumnBadges;
  /** The theme's foreground, which an icon-only control's glyph rests at. */
  color: string;
  iconSize: number;
  /**
   * True when a drag of the handle starts, false when it ends. The drag widens over the floor, and
   * a web floor's frame would take the pointer from the handle while it moves over it.
   */
  onDragging(dragging: boolean): void;
  styles: OfficeStyles;
  /** The chosen tab's or session's panel. */
  children: ReactNode;
}

/**
 * The office's column beside the floor: its tabs over the chosen panel, a handle to drag its
 * width, and a rail of the tabs' icons when it is collapsed. The office draws it itself, so it is
 * there in an app with no side area of its own.
 */
export function OfficeColumn({
  hideSessions = false,
  column,
  sessions,
  touch,
  surfaceWidth,
  badges,
  color,
  iconSize,
  onDragging,
  styles,
  children,
}: OfficeColumnProps) {
  const { view, collapsed, show, openSession, closeSession, setCollapsed, setWidth } = column;
  const width = clampColumn(column.width, surfaceWidth);
  // The width while the handle is dragged; the device is told once, on release.
  const [dragged, setDragged] = useState<number | null>(null);
  const start = useRef(width);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = width;
          setDragged(width);
          onDragging(true);
        },
        // The handle is on the column's left: a drag to the left widens it.
        onPanResponderMove: (_event, gesture) =>
          setDragged(clampColumn(start.current - gesture.dx, surfaceWidth)),
        onPanResponderRelease: (_event, gesture) => {
          setDragged(null);
          onDragging(false);
          setWidth(clampColumn(start.current - gesture.dx, surfaceWidth));
        },
        onPanResponderTerminate: () => {
          setDragged(null);
          onDragging(false);
        },
      }),
    [width, surfaceWidth, setWidth, onDragging],
  );
  const collapse = useCallback(() => setCollapsed(true), [setCollapsed]);
  const sized = useMemo(
    () => ({ ...styles.column, width: dragged ?? width }),
    [styles.column, dragged, width],
  );
  if (collapsed) {
    return (
      <View style={styles.columnRail}>
        <ColumnTabs
          hideSessions={hideSessions}
          view={null}
          badges={badges}
          sessions={sessions}
          sessionTabs={false}
          touch={touch}
          color={color}
          iconSize={iconSize}
          labels={false}
          vertical
          onPress={show}
          onSession={openSession}
          onClose={closeSession}
          styles={styles}
        />
      </View>
    );
  }
  return (
    <>
      <View
        accessibilityLabel="Drag to resize the column"
        style={dragged === null ? styles.columnHandle : styles.columnHandleLit}
        {...pan.panHandlers}
      />
      <View style={sized}>
        <View style={styles.columnHead}>
          <ColumnTabs
            hideSessions={hideSessions}
            hideFixed={hideSessions}
            view={view}
            badges={badges}
            sessions={sessions}
            sessionTabs
            touch={touch}
            color={color}
            iconSize={iconSize}
            labels
            vertical={false}
            onPress={show}
            onSession={openSession}
            onClose={closeSession}
            styles={styles}
          />
          {hideSessions ? null : (
            <IconButton
              label="Collapse the column"
              icon="PanelRightClose"
              color={color}
              iconSize={iconSize}
              onPress={collapse}
              styles={styles}
            />
          )}
        </View>
        <View style={styles.columnBody}>{children}</View>
      </View>
    </>
  );
}
