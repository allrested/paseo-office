import { useCallback, useMemo, useState } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import type { Post } from "../shared/contracts.js";
import { PostWithActions } from "./board-sheet.js";
import { repliesOf, type TeamNamer } from "./board-text.js";
import { kanbanColumns, kanbanWide, type KanbanColumn } from "./kanban-model.js";
import type { OfficeStyles } from "./styles.js";
import { ClearFinished, TaskCard } from "./task-card.js";
import { Text } from "./text.js";
import { useT } from "./ui-language.js";
import type { BoardActions } from "./use-board-actions.js";

export interface KanbanBoardProps {
  posts: readonly Post[];
  name(author: string): string;
  teamName: TeamNamer;
  actions: BoardActions;
  styles: OfficeStyles;
}

interface ColumnProps {
  column: KanbanColumn;
  /** The whole board, replies included: a task's card shows the ones under it. */
  board: readonly Post[];
  name(author: string): string;
  teamName: TeamNamer;
  actions: BoardActions;
  styles: OfficeStyles;
}

/** "To do · 3": the column's title and how many it holds. */
function headingOf(column: KanbanColumn): string {
  return `${column.title} · ${column.posts.length}`;
}

/** Done's "Clear finished". Done shows only while it holds a task, so there is one to clear. */
function ColumnClear({
  column,
  actions,
  styles,
}: Omit<ColumnProps, "name" | "teamName" | "board">) {
  const first = column.posts[0];
  if (column.id !== "done" || first === undefined) return null;
  return (
    <ClearFinished
      board={first.board}
      done={column.posts.length}
      actions={actions}
      styles={styles}
    />
  );
}

/** A task is a card with its box; a note keeps the buttons it has on the list. */
function ColumnCards({ column, board, name, teamName, actions, styles }: ColumnProps) {
  return (
    <View style={styles.kanbanCards}>
      {column.posts.map((post) =>
        post.kind === "note" ? (
          <View key={post.id} style={styles.kanbanNote}>
            <PostWithActions
              post={post}
              name={name}
              teamName={teamName}
              actions={actions}
              styles={styles}
            />
          </View>
        ) : (
          <TaskCard
            key={post.id}
            post={post}
            replies={repliesOf(post, board)}
            name={name}
            teamName={teamName}
            actions={actions}
            styles={styles}
          />
        ),
      )}
    </View>
  );
}

/** Wide: a column of its own width beside the others. */
function SideColumn({ column, board, name, teamName, actions, styles }: ColumnProps) {
  return (
    <View style={styles.kanbanColumn}>
      <View style={styles.kanbanHeading}>
        <Text accessibilityRole="header" style={styles.lobbyHeading}>
          {headingOf(column)}
        </Text>
        <ColumnClear column={column} actions={actions} styles={styles} />
      </View>
      <ColumnCards
        column={column}
        board={board}
        name={name}
        teamName={teamName}
        actions={actions}
        styles={styles}
      />
    </View>
  );
}

/** Narrow: a section whose heading folds it. Done starts folded: what is finished waits below. */
function StackedColumn({ column, board, name, teamName, actions, styles }: ColumnProps) {
  const [open, setOpen] = useState(column.id !== "done");
  const toggle = useCallback(() => setOpen((current) => !current), []);
  const t = useT();
  const heading = headingOf(column);
  return (
    <View style={styles.lobbySection}>
      <View style={styles.kanbanHeading}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(heading)}
          aria-expanded={open}
          onPress={toggle}
          style={styles.kanbanFold}
        >
          <Icon name={open ? "ChevronDown" : "ChevronRight"} size={16} color={styles.iconColor} />
          <Text style={styles.lobbyHeading}>{heading}</Text>
        </Pressable>
        <ColumnClear column={column} actions={actions} styles={styles} />
      </View>
      {open ? (
        <ColumnCards
          column={column}
          board={board}
          name={name}
          teamName={teamName}
          actions={actions}
          styles={styles}
        />
      ) : null}
    </View>
  );
}

/**
 * A board as columns, one per kind of post (kanban-model.ts). It measures its own width: from
 * 720 the columns sit side by side and scroll sideways when they do not fit; narrower, and until
 * the first measure, they stack. A card moves by its buttons, never a drag, which would fight the
 * scroll on a phone.
 */
export function KanbanBoard({ posts, name, teamName, actions, styles }: KanbanBoardProps) {
  const [width, setWidth] = useState(0);
  const measure = useCallback(
    (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width),
    [],
  );
  const columns = useMemo(() => kanbanColumns(posts), [posts]);
  const wide = kanbanWide(width);
  return (
    <View style={styles.kanban} onLayout={measure}>
      {wide ? (
        <ScrollView
          horizontal
          style={styles.kanbanScroll}
          contentContainerStyle={styles.kanbanColumns}
        >
          {columns.map((column) => (
            <SideColumn
              key={column.id}
              column={column}
              board={posts}
              name={name}
              teamName={teamName}
              actions={actions}
              styles={styles}
            />
          ))}
        </ScrollView>
      ) : (
        columns.map((column) => (
          <StackedColumn
            key={column.id}
            column={column}
            board={posts}
            name={name}
            teamName={teamName}
            actions={actions}
            styles={styles}
          />
        ))
      )}
    </View>
  );
}
