import { useCallback, useMemo, useRef, useState, type RefObject } from "react";
import { Pressable, View, type TextInput as NativeTextInput } from "react-native";
import { AFTER_MAX, type Post } from "../shared/contracts.js";
import type { OfficeStyles } from "./styles.js";
import { Text } from "./text.js";
import { useT } from "./ui-language.js";

export interface FollowUp {
  /** The tasks the next post waits on: the ones still on the boards, in the order they were added. */
  after: readonly string[];
  /** The form says a task waits on at most AFTER_MAX tasks: Follow-up was pressed at the limit. */
  full: boolean;
  /** For the form's field: Follow-up moves the focus to it. */
  field: RefObject<NativeTextInput | null>;
  /** Follow-up on a task: adds it, once, up to the limit, and focuses the field. */
  add(id: string): void;
  clear(): void;
}

/**
 * The form's pending `after`, which Follow-up on a card fills. A task that left the boards is not
 * in it (judged on read, as `keptChoice` does for a recipient who left), so the form never sends
 * an id nothing holds.
 */
export function useFollowUp(all: readonly Post[]): FollowUp {
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [full, setFull] = useState(false);
  const field = useRef<NativeTextInput>(null);
  const after = useMemo(
    () => picked.filter((id) => all.some((post) => post.id === id)),
    [picked, all],
  );
  const add = useCallback(
    (id: string) => {
      if (after.includes(id)) {
        field.current?.focus();
        return;
      }
      if (after.length >= AFTER_MAX) {
        setFull(true);
        return;
      }
      setPicked([...after, id]);
      setFull(false);
      field.current?.focus();
    },
    [after],
  );
  const clear = useCallback(() => {
    setPicked([]);
    setFull(false);
  }, []);
  return { after, full, field, add, clear };
}

interface AfterFieldProps {
  followUp: FollowUp;
  styles: OfficeStyles;
}

/** Under the form's field while it has an `after`: "After p12, p13" and Clear; and the limit. */
export function AfterField({ followUp, styles }: AfterFieldProps) {
  const { after, full, clear } = followUp;
  const t = useT();
  if (after.length === 0 && !full) return null;
  return (
    <View>
      {after.length === 0 ? null : (
        <View style={styles.taskReplyRow}>
          <View style={styles.rowBody}>
            <Text style={styles.postMeta}>{`After ${after.join(", ")}`}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Clear")}
            onPress={clear}
            style={styles.lobbyDelete}
          >
            <Text style={styles.lobbyDeleteText}>Clear</Text>
          </Pressable>
        </View>
      )}
      {full ? (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {`A task waits on at most ${AFTER_MAX} tasks`}
        </Text>
      ) : null}
    </View>
  );
}
