import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
  type ScrollView as NativeScrollView,
} from "react-native";
import { Markdown, ScrollView } from "@getpaseo/plugin/client/ui";
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
    <View style={styles.sheetActions}>
      <Text accessibilityRole="header" style={styles.standupHeading}>
        {monthTitle(month.month)}
      </Text>
      <View style={styles.actions}>
        <ActionButton
          label="Previous month"
          pendingLabel="Previous month"
          onPress={showPrevious}
          disabled={previous === null}
          styles={styles}
        />
        <ActionButton
          label="Next month"
          pendingLabel="Next month"
          onPress={showNext}
          disabled={next === null}
          styles={styles}
        />
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

interface SectionProps {
  section: NotesSection;
  index: number;
  onPlaced(index: number, y: number): void;
  onJump(anchor: string): void;
  styles: OfficeStyles;
}

/** An entry, or the text before the first: Markdown, and its links to other entries. */
function Section({ section, index, onPlaced, onJump, styles }: SectionProps) {
  const placed = useCallback(
    (event: LayoutChangeEvent) => onPlaced(index, event.nativeEvent.layout.y),
    [index, onPlaced],
  );
  return (
    <View onLayout={placed}>
      {section.pieces.map((piece, at) => (
        // A section's pieces are its text in order and never move, so their place is their key.
        // oxlint-disable-next-line react/no-array-index-key
        <Piece key={at} piece={piece} onJump={onJump} styles={styles} />
      ))}
    </View>
  );
}

interface NotesTextProps {
  /** The read the text came from: each read is brought to its newest entry once. */
  load: NotesMonth;
  text: string;
  styles: OfficeStyles;
}

/** The month's file as Markdown, scrolled to its newest entry; a Contents link scrolls to its entry. */
function NotesText({ load, text, styles }: NotesTextProps) {
  const sections = useMemo(() => splitSections(text), [text]);
  const scroller = useRef<NativeScrollView>(null);
  // Where each entry starts in the scroller, by its anchor, as last laid out.
  const tops = useRef(new Map<string, number>());
  // Once per read: a later layout leaves the reader where they scrolled.
  const scrolledFor = useRef<NotesMonth | null>(null);
  const placed = useCallback(
    (index: number, y: number) => {
      const anchor = sections[index]?.anchor ?? null;
      if (anchor !== null) tops.current.set(anchor, y);
      if (index !== sections.length - 1 || scrolledFor.current === load) return;
      scrolledFor.current = load;
      scroller.current?.scrollTo({ y, animated: false });
    },
    [sections, load],
  );
  const jump = useCallback((anchor: string) => {
    const y = tops.current.get(anchor);
    if (y !== undefined) scroller.current?.scrollTo({ y, animated: true });
  }, []);
  return (
    <ScrollView ref={scroller} style={styles.notesScroll}>
      {sections.map((section, index) => (
        <Section
          // The sections are the text in order and never move, so their place is their key.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          section={section}
          index={index}
          onPlaced={placed}
          onJump={jump}
          styles={styles}
        />
      ))}
    </ScrollView>
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
  return <NotesText key={month.month} load={month} text={month.text} styles={styles} />;
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
