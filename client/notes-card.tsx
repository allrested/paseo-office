import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View, type ViewStyle } from "react-native";
import { Icon, Markdown, ScrollView } from "@getpaseo/plugin/client/ui";
import { OfficeModal as Modal } from "./office-modal.js";
import type { z } from "zod";
import type { NotesState, notesReadRpc } from "../shared/contracts.js";
import { ActionButton, failureText } from "./action-button.js";
import {
  monthTitle,
  notesLine,
  splitSections,
  type NotesLink,
  type NotesPiece,
  type NotesSection,
} from "./notes-text.js";
import type { OfficeStyles } from "./styles.js";

/** A month of the stand-up notes, as the office's server reads it. */
export type NotesMonth = z.output<typeof notesReadRpc.output>;

export interface WriterLineProps {
  notes: NotesState | undefined;
  /** "Today" is this moment's day: when the card opened. */
  now: number;
  timeZone: string;
  /** Undefined on a host that cannot open an agent from here. */
  onOpenAgent: ((agentId: string) => void) | undefined;
  styles: OfficeStyles;
}

/** The writer's line and, when the writer stopped, a way to it. Nothing with no folder. */
export function WriterLine({ notes, now, timeZone, onOpenAgent, styles }: WriterLineProps) {
  const line = notesLine(notes, now, timeZone);
  const failedAgentId = notes?.failedAgentId ?? null;
  const openWriter = useCallback(() => {
    if (failedAgentId !== null) onOpenAgent?.(failedAgentId);
  }, [failedAgentId, onOpenAgent]);
  if (line === null) return null;
  return (
    <View style={styles.sheetActions}>
      <Text style={styles.muted}>{line}</Text>
      {failedAgentId === null || onOpenAgent === undefined ? null : (
        <View style={styles.actions}>
          <ActionButton
            label="Open the writer"
            pendingLabel="Opening..."
            onPress={openWriter}
            styles={styles}
          />
        </View>
      )}
    </View>
  );
}

interface MonthBarProps {
  month: NotesMonth;
  onAsk(month: string): void;
  styles: OfficeStyles;
}

/** The month shown, and the nearest months before and after it that have a file. */
function MonthBar({ month, onAsk, styles }: MonthBarProps) {
  const { previous, next } = month;
  const showPrevious = useCallback(() => {
    if (previous !== null) onAsk(previous);
  }, [previous, onAsk]);
  const showNext = useCallback(() => {
    if (next !== null) onAsk(next);
  }, [next, onAsk]);
  return (
    <View style={styles.notesMonthBar}>
      <Text accessibilityRole="header" style={styles.panelHeading}>
        {monthTitle(month.month)}
      </Text>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          disabled={!previous}
          aria-disabled={!previous}
          onPress={showPrevious}
          style={styles.sidebarButton}
        >
          <Icon
            name="ChevronLeft"
            size={18}
            color={previous ? styles.iconColor : styles.placeholderColor}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          disabled={!next}
          aria-disabled={!next}
          onPress={showNext}
          style={styles.sidebarButton}
        >
          <Icon
            name="ChevronRight"
            size={18}
            color={next ? styles.iconColor : styles.placeholderColor}
          />
        </Pressable>
      </View>
    </View>
  );
}

interface LinkRowProps {
  link: NotesLink;
  onJump(anchor: string): void;
  styles: OfficeStyles;
}

function LinkRow({ link, onJump, styles }: LinkRowProps) {
  const jump = useCallback(() => onJump(link.anchor), [link.anchor, onJump]);
  return (
    <Pressable accessibilityRole="link" onPress={jump} style={styles.notesLinkRow}>
      <Text style={styles.notesLink}>{link.label}</Text>
    </Pressable>
  );
}

interface PieceProps {
  piece: NotesPiece;
  onJump(anchor: string): void;
  styles: OfficeStyles;
}

function Piece({ piece, onJump, styles }: PieceProps) {
  if (piece.kind === "markdown") return <Markdown>{piece.text}</Markdown>;
  return (
    <View style={styles.notesLinks}>
      {piece.links.map((link, row) => (
        // The Contents may list an entry twice, so a link's place is its key.
        // oxlint-disable-next-line react/no-array-index-key
        <LinkRow key={row} link={link} onJump={onJump} styles={styles} />
      ))}
    </View>
  );
}

function sectionTitle(section: NotesSection) {
  const first = section.pieces[0];
  return (
    (first?.kind === "markdown" && first.text.match(/^## ([^\n]+)/)?.[1]?.trim()) || "Overview"
  );
}

function EntryTab({
  section,
  selected,
  onSelect,
  styles,
}: {
  section: NotesSection;
  selected: boolean;
  onSelect(section: NotesSection): void;
  styles: OfficeStyles;
}) {
  const title = sectionTitle(section);
  const select = useCallback(() => onSelect(section), [section, onSelect]);
  const state = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={title}
      accessibilityState={state}
      aria-selected={selected}
      onPress={select}
      style={selected ? styles.sidebarButtonActive : styles.workspaceAction}
    >
      <Text style={styles.sidebarButtonText}>
        {title.replace(/^(\d{1,2}) ([A-Za-z]{3})[a-z]* \d{4}$/, "$1 $2")}
      </Text>
    </Pressable>
  );
}

const strip: ViewStyle = { flexGrow: 0, flexShrink: 0 };
function NotesText({ text, styles }: { text: string; styles: OfficeStyles }) {
  const sections = useMemo(() => splitSections(text), [text]);
  // Undefined follows the newest entry when the writer finishes. A chosen entry stays selected.
  const [choice, setChoice] = useState<number>();
  const current = sections[choice ?? sections.length - 1] ?? sections[sections.length - 1];
  const select = useCallback(
    (section: NotesSection) => setChoice(sections.indexOf(section)),
    [sections],
  );
  const jump = useCallback(
    (anchor: string) => setChoice(sections.findIndex((section) => section.anchor === anchor)),
    [sections],
  );
  if (!current) return null;
  return (
    <>
      {sections.length > 1 && (
        <ScrollView
          horizontal
          style={strip}
          contentContainerStyle={styles.notesDateStrip}
          accessibilityLabel="Note entries"
          accessibilityRole="tablist"
          showsHorizontalScrollIndicator
        >
          {Array.from({ length: sections.length }, (_, offset) => {
            const index = sections.length - 1 - offset;
            const section = sections[index]!;
            return (
              <EntryTab
                key={`${index}-${section.anchor ?? "intro"}`}
                section={section}
                selected={section === current}
                onSelect={select}
                styles={styles}
              />
            );
          })}
        </ScrollView>
      )}
      <ScrollView key={current.anchor ?? "preamble"} style={styles.notesScroll}>
        <View style={styles.notesPaper}>
          {current.pieces.map((piece, index) => (
            // A section's Markdown and link runs keep their order.
            // oxlint-disable-next-line react/no-array-index-key
            <Piece key={index} piece={piece} onJump={jump} styles={styles} />
          ))}
        </View>
      </ScrollView>
    </>
  );
}

const NO_FOLDER = "Set a notes folder in the office's settings to see the stand-up notes.";

/** What the card has for the month it asked for: the notes, or why they could not be read. */
type Shown = { status: "read"; month: NotesMonth } | { status: "failed"; text: string };

interface NotesBodyProps {
  /** Null until the first read of this opening is back. */
  shown: Shown | null;
  styles: OfficeStyles;
}

function NotesBody({ shown, styles }: NotesBodyProps) {
  if (shown === null) return <Text style={styles.muted}>Reading the notes...</Text>;
  if (shown.status === "failed") {
    return (
      <Text accessibilityRole="alert" style={styles.actionError}>
        {shown.text}
      </Text>
    );
  }
  const { month } = shown;
  if (!month.folderSet) return <Text style={styles.muted}>{NO_FOLDER}</Text>;
  if (month.text === null) {
    return <Text style={styles.muted}>No notes for {monthTitle(month.month)}.</Text>;
  }
  return <NotesText key={month.month} text={month.text} styles={styles} />;
}

export interface NotesCardProps {
  open: boolean;
  /** The writer's state in the office's snapshot: a writer that ends reads the month again. */
  notes: NotesState | undefined;
  /** When the card opened: the line's "today". */
  now: number;
  /** The zone the line's "today" is judged in. */
  timeZone: string;
  /** A month of the notes; this month, in the notes time zone, when none is named. */
  read(input: { month?: string }): Promise<NotesMonth>;
  /** Undefined on a host that cannot open an agent from here. */
  onOpenAgent: ((agentId: string) => void) | undefined;
  styles: OfficeStyles;
  onClose(): void;
}

/**
 * The stand-up notes, read only: a month's file as Markdown at its newest entry, the months
 * around it that have a file, and the writer's line.
 */
export function NotesCard({
  open,
  notes,
  now,
  timeZone,
  read,
  onOpenAgent,
  styles,
  onClose,
}: NotesCardProps) {
  const change = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  // The month asked for; null for this month, which the server works out.
  const [asked, setAsked] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  // Every opening starts at this month.
  useEffect(() => {
    if (open) return;
    setAsked(null);
    setShown(null);
  }, [open]);
  // A writer that ends reads the month again, however it ends: with a new writtenAt, or stopped
  // (`writing` turns off), as it may have written part of the entry. This month is asked for as
  // this month again, so an entry that started a new month shows.
  const writtenAt = notes?.writtenAt ?? null;
  const writing = notes?.writing ?? false;
  useEffect(() => {
    if (!open) return;
    let current = true;
    async function load(month: string | null): Promise<void> {
      try {
        const result = await read(month === null ? {} : { month });
        if (current) setShown({ status: "read", month: result });
      } catch (error) {
        if (current) {
          setShown({ status: "failed", text: failureText("Read the stand-up notes", error) });
        }
      }
    }
    void load(asked);
    return () => {
      current = false;
    };
  }, [open, asked, writtenAt, writing, read]);
  const month = shown?.status === "read" && shown.month.folderSet ? shown.month : null;
  return (
    <Modal title="Stand-up notes" open={open} onOpenChange={change}>
      {/* Not scrollable itself: the notes scroll under the month's buttons. */}
      <Modal.Content scrollable={false}>
        {month === null ? null : <MonthBar month={month} onAsk={setAsked} styles={styles} />}
        <WriterLine
          notes={notes}
          now={now}
          timeZone={timeZone}
          onOpenAgent={onOpenAgent}
          styles={styles}
        />
        <NotesBody shown={shown} styles={styles} />
      </Modal.Content>
    </Modal>
  );
}
