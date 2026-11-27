import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Text } from "./text.js";
import { CHAT_TEXT_MAX } from "../shared/contracts.js";
import { coach, numberTasks, type PromptHint } from "../shared/upstream/prompt-coach.js";
import type { ChatDraft } from "./office-link.js";
import type { OfficeStyles } from "./styles.js";
import { ActionButton } from "./action-button.js";

interface Suggestion {
  note: string;
  action: string;
  text: string;
}

function suggestion(hint: PromptHint, draft: string): Suggestion {
  const text = draft.trimEnd();
  switch (hint.id) {
    case "photoBare":
      return {
        note: "What should the session look for in the image?",
        action: "Describe the goal",
        text: `${text}\nIn the image, look for `.trimStart(),
      };
    case "dangling":
      return {
        note: `Where can the session find “${hint.phrase}”?`,
        action: "Add a reference",
        text: `${text}\nFile or section: `,
      };
    case "vague":
      return {
        note: `What would “${hint.phrase}” look like when it’s done?`,
        action: "Add criteria",
        text: `${text}\nDone when: `,
      };
    case "multi":
      return {
        note: `This message has ${hint.n} tasks.`,
        action: "Number the tasks",
        text: numberTasks(text),
      };
    case "tooShort":
      return {
        note: "What result would you like the session to produce?",
        action: "Add the result",
        text: `${text}\nExpected result: `,
      };
  }
}

interface DraftInput {
  text: string;
  photos: number;
  quoted: boolean;
}

interface Edit {
  before: string;
  after: string;
}

function DraftCoach({
  text,
  photos,
  quoted,
  setText,
  styles,
}: DraftInput & Pick<ChatDraft, "setText"> & { styles: OfficeStyles }) {
  const [settled, setSettled] = useState<DraftInput | null>(null);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const [edit, setEdit] = useState<Edit | null>(null);
  // A suggestion appears after a pause. New input always takes precedence over an earlier one.
  useEffect(() => {
    const timer = setTimeout(() => setSettled({ text, photos, quoted }), 400);
    return () => clearTimeout(timer);
  }, [text, photos, quoted]);
  useEffect(() => {
    if (edit && edit.after !== text) setEdit(null);
  }, [edit, text]);
  const ready = settled?.text === text && settled.photos === photos && settled.quoted === quoted;
  const hint = useMemo(
    () => (ready && settled ? coach(settled).find((item) => !dismissed.has(item.id)) : undefined),
    [ready, settled, dismissed],
  );
  const next = hint ? suggestion(hint, text) : null;
  const dismiss = useCallback(() => {
    if (hint) setDismissed((seen) => new Set(seen).add(hint.id));
  }, [hint]);
  const apply = useCallback(() => {
    if (!next) return;
    dismiss();
    setEdit({ before: text, after: next.text });
    setText((current) => (current === text ? next.text : current));
  }, [dismiss, next, text, setText]);
  const undo = useCallback(() => {
    if (edit) setText((current) => (current === edit.after ? edit.before : current));
    setEdit(null);
  }, [edit, setText]);
  if (edit?.after === text)
    return (
      <View style={styles.actions}>
        <ActionButton
          label="Undo suggestion"
          pendingLabel="Undoing…"
          onPress={undo}
          styles={styles}
        />
      </View>
    );
  if (!next || next.text.length > CHAT_TEXT_MAX) return null;
  return (
    <View style={styles.sheetField}>
      <Text style={styles.fieldHint}>{next.note}</Text>
      <View style={styles.actions}>
        <ActionButton
          label={next.action}
          pendingLabel="Applying…"
          onPress={apply}
          styles={styles}
        />
        <ActionButton
          label="Dismiss tip"
          pendingLabel="Dismissing…"
          onPress={dismiss}
          styles={styles}
        />
      </View>
    </View>
  );
}

/** Analyze only a directed draft on this device. The composer remains usable while a tip is visible. */
export function PromptCoach({
  draft,
  styles,
}: {
  draft: Pick<ChatDraft, "text" | "recipient" | "replyTo" | "images" | "setText">;
  styles: OfficeStyles;
}) {
  const photos = draft.images.length;
  if (!draft.recipient || (!draft.text.trim() && !photos)) return null;
  return (
    <DraftCoach
      key={draft.recipient}
      text={draft.text}
      photos={photos}
      quoted={draft.replyTo !== null}
      setText={draft.setText}
      styles={styles}
    />
  );
}
