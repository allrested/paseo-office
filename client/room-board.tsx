import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { Text } from "./text.js";
import type { Post } from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import { boardPreview, postMeta, todoPreview, type TeamNamer } from "./board-text.js";
import type { OfficeRoom } from "../shared/model.js";
import { SourceChip } from "./source-chip.js";
import type { OfficeStyles } from "./styles.js";
import { useProviderName } from "./use-plan-usage.js";

export interface PostRowProps {
  post: Post;
  name(author: string): string;
  teamName: TeamNamer;
  styles: OfficeStyles;
  /** In a room card: one line of who and what, two of text. The board sheet shows all of both. */
  brief?: boolean;
}

export function PostRow({ post, name, teamName, styles, brief = false }: PostRowProps) {
  const providerName = useProviderName();
  return (
    <View style={styles.post}>
      <View style={styles.standupMeta}>
        <Text style={styles.postMeta} numberOfLines={brief ? 1 : undefined}>
          {postMeta(post, name, teamName, providerName)}
        </Text>
        {post.source === undefined ? null : <SourceChip source={post.source} styles={styles} />}
      </View>
      <Text style={styles.postText} numberOfLines={brief ? 2 : undefined}>
        {post.text}
      </Text>
    </View>
  );
}

export interface RoomBoardProps {
  room: OfficeRoom;
  name(author: string): string;
  teamName: TeamNamer;
  styles: OfficeStyles;
  onOpenBoard(roomId: string): void;
  /** The duty board's editor: the lobby's card offers it beside its own board. */
  onOpenDuties?(): void;
}

/**
 * The room's board under its agents: the first open tasks, claimed tasks and notes, and how many
 * more the board holds. The lobby's shows its unfinished to-dos instead. An empty board is one
 * line, so a list of quiet rooms stays short.
 */
export function RoomBoard({
  room,
  name,
  teamName,
  styles,
  onOpenBoard,
  onOpenDuties,
}: RoomBoardProps) {
  const open = useCallback(() => onOpenBoard(room.id), [onOpenBoard, room.id]);
  const preview = useMemo(
    () => (room.lobby ? todoPreview(room.todos) : boardPreview(room.posts)),
    [room.lobby, room.todos, room.posts],
  );
  return (
    <View style={styles.boardSection}>
      <View style={styles.boardTitleRow}>
        <View style={styles.boardHeading}>
          <Text style={styles.boardTitle}>{room.lobby ? "To-do" : "Board"}</Text>
          {preview.shown.length === 0 ? (
            <Text style={styles.postMeta}>{room.lobby ? "No to-dos" : "No posts"}</Text>
          ) : null}
        </View>
        {room.lobby && onOpenDuties ? (
          <View style={styles.actions}>
            <ActionButton
              label="Open board"
              pendingLabel="Opening..."
              onPress={open}
              styles={styles}
            />
            <ActionButton
              label="Duty board"
              pendingLabel="Opening..."
              onPress={onOpenDuties}
              styles={styles}
            />
          </View>
        ) : (
          <ActionButton
            label="Open board"
            pendingLabel="Opening..."
            onPress={open}
            styles={styles}
          />
        )}
      </View>
      {preview.shown.map((post) => (
        <PostRow key={post.id} post={post} name={name} teamName={teamName} styles={styles} brief />
      ))}
      {preview.more > 0 ? <Text style={styles.postMeta}>{preview.more} more</Text> : null}
    </View>
  );
}
