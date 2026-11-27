import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "./text.js";
import { defineSettings } from "@getpaseo/plugin";
import { useSettings } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { TextInput } from "./text.js";
import { z } from "zod";
import { chatT } from "../shared/chat-words.js";
import { CHAT_TEXT_MAX } from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import { ChatIcon } from "./chat-chrome.js";
import type { OfficeStyles } from "./styles.js";

const Message = z.object({
  label: z.string().trim().min(1).max(24),
  prompt: z.string().trim().min(1).max(CHAT_TEXT_MAX),
});
type Quick = z.output<typeof Message>;
const defaults = ["test", "commit", "deploy", "today", "errors"].map((k) => ({
  label: chatT("chat.quick." + k),
  prompt: chatT("chat.quick." + k + "Prompt"),
}));
export const quickSettings = defineSettings({
  id: "office-quick-messages",
  scope: "device",
  version: 1,
  schema: z.object({ list: z.array(Message).max(12).default(defaults) }),
});

function QuickRow({
  item,
  onUse,
  onEdit,
  styles,
}: {
  item: Quick;
  onUse(s: string): void;
  onEdit(item: Quick): void;
  styles: OfficeStyles;
}) {
  const use = useCallback(() => onUse(item.prompt), [onUse, item]);
  const edit = useCallback(() => onEdit(item), [onEdit, item]);
  return (
    <View style={styles.messenger.quickRow}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.label}
        onPress={use}
        style={styles.rowBody}
      >
        <Text style={styles.chatName}>{item.label}</Text>
        <Text style={styles.chatMeta} numberOfLines={1}>
          {item.prompt}
        </Text>
      </Pressable>
      <ChatIcon name="Pencil" label={`Edit ${item.label}`} styles={styles} onPress={edit} />
    </View>
  );
}

/** This document belongs to the current device, separately from its view and theme preferences. */
export function QuickMessages({
  text,
  onUse,
  styles,
}: {
  text: string;
  onUse(prompt: string): void;
  styles: OfficeStyles;
}) {
  const settings = useSettings(quickSettings);
  const ready = settings.status === "ready" ? settings : null;
  const [editing, setEditing] = useState<Quick | "new" | null>(null);
  const [label, setLabel] = useState(""),
    [prompt, setPrompt] = useState("");
  const [removeConfirm, setRemoveConfirm] = useState(false);
  const cancel = useCallback(() => {
    setEditing(null);
    setRemoveConfirm(false);
  }, []);
  const edit = useCallback((item: Quick) => {
    setEditing(item);
    setLabel(item.label);
    setPrompt(item.prompt);
    setRemoveConfirm(false);
  }, []);
  const create = useCallback(() => {
    setEditing("new");
    setLabel(text.trim().slice(0, 24));
    setPrompt(text.trim());
    setRemoveConfirm(false);
  }, [text]);
  const keep = useCallback(
    async (remove: boolean) => {
      if (!ready || !editing) return;
      const items = ready.values.list;
      const replacement = { label: label.trim(), prompt: prompt.trim() };
      // A new revision can arrive while the editor is open. Locate the original by content.
      const index =
        editing === "new"
          ? -1
          : items.findIndex(
              (item) => item.prompt === editing.prompt && item.label === editing.label,
            );
      if (editing !== "new" && index === -1)
        throw new Error("This quick message changed. Reopen it to edit.");
      const next = [...items];
      if (!remove && next.some((item, i) => i !== index && item.label === replacement.label))
        throw new Error("Choose a different quick message name.");
      if (remove) next.splice(index, 1);
      else if (index === -1) next.push(replacement);
      else next[index] = replacement;
      if (!(await ready.save({ list: next }, ready.revision))) {
        await ready.reload();
        throw new Error("The quick messages changed or could not be saved. Try again.");
      }
      cancel();
    },
    [ready, editing, label, prompt, cancel],
  );
  const save = useCallback(() => keep(false), [keep]);
  const remove = useCallback(async () => {
    if (removeConfirm) await keep(true);
    else setRemoveConfirm(true);
  }, [removeConfirm, keep]);
  if (!ready)
    return (
      <Text style={styles.chatMeta}>
        {settings.status === "loading"
          ? "Loading quick messages…"
          : "Quick messages could not be loaded on this device."}
      </Text>
    );
  if (editing)
    return (
      <ScrollView
        style={styles.messenger.pollScroll}
        contentContainerStyle={styles.sheetField}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          accessibilityLabel="Quick message name"
          placeholder="Name"
          style={styles.fieldInput}
          maxLength={24}
          value={label}
          onChangeText={setLabel}
        />
        <TextInput
          accessibilityLabel="Saved message"
          placeholder="Message"
          style={styles.fieldInput}
          multiline
          maxLength={CHAT_TEXT_MAX}
          value={prompt}
          onChangeText={setPrompt}
        />
        <View style={styles.actions}>
          <ActionButton
            label="Save"
            pendingLabel="Saving…"
            onPress={save}
            disabled={!label.trim() || !prompt.trim()}
            primary
            styles={styles}
          />
          <ActionButton label="Cancel" pendingLabel="Cancel" onPress={cancel} styles={styles} />
          {editing !== "new" && (
            <ActionButton
              label={removeConfirm ? "Confirm delete" : "Delete"}
              pendingLabel="Deleting…"
              onPress={remove}
              styles={styles}
            />
          )}
        </View>
      </ScrollView>
    );
  return (
    <ScrollView style={styles.messenger.pollScroll} keyboardShouldPersistTaps="handled">
      <ActionButton
        label="Add quick message"
        pendingLabel="Add quick message"
        styles={styles}
        onPress={create}
        disabled={ready.values.list.length >= 12}
      />
      {ready.values.list.map((item) => (
        <QuickRow
          item={item}
          key={item.label + "\n" + item.prompt}
          onUse={onUse}
          onEdit={edit}
          styles={styles}
        />
      ))}
    </ScrollView>
  );
}
