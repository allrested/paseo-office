import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { View } from "react-native";
import { Text } from "./text.js";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { TextInput } from "./text.js";
import { CHAT_IMAGE_CHARS, CHAT_IMAGE_LIMIT, type ChatRequest } from "../shared/contracts.js";
import type { ChatDraft } from "./office-link.js";
import type { OfficeStyles } from "./styles.js";
import { ActionButton, failureText } from "./action-button.js";
import type { MentionOption } from "./chat-text.js";
import { ChatMore, type ChatShortcuts } from "./chat-more.js";
import { ChatIcon, ToField } from "./chat-chrome.js";

function PollForm({
  run,
  onClose,
  styles,
}: {
  run(request: ChatRequest): Promise<boolean>;
  onClose(): void;
  styles: OfficeStyles;
}) {
  const [question, setQuestion] = useState(""),
    [choices, setChoices] = useState("");
  const options = choices
    .split("\n")
    .map((option) => option.trim())
    .filter(Boolean);
  const valid =
    question.trim() !== "" &&
    options.length >= 2 &&
    options.length <= 6 &&
    options.every((o) => o.length <= 60);
  const create = useCallback(async () => {
    if (
      await run({
        op: "poll",
        question: question.trim(),
        options: choices
          .split("\n")
          .map((option) => option.trim())
          .filter(Boolean),
      })
    )
      onClose();
  }, [run, question, choices, onClose]);
  return (
    <ScrollView
      style={styles.messenger.pollScroll}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.sheetField}
    >
      <Text accessibilityRole="header" style={styles.chatName}>
        New poll
      </Text>
      <TextInput
        accessibilityLabel="Poll question"
        placeholder="Ask a question"
        placeholderTextColor={styles.placeholderColor}
        value={question}
        onChangeText={setQuestion}
        maxLength={120}
        style={styles.fieldInput}
      />
      <TextInput
        accessibilityLabel="Poll choices"
        placeholder="2–6 options, one per line"
        placeholderTextColor={styles.placeholderColor}
        multiline
        value={choices}
        onChangeText={setChoices}
        maxLength={365}
        style={styles.fieldInput}
      />
      <View style={styles.actions}>
        <ActionButton
          label="Post poll"
          pendingLabel="Posting…"
          onPress={create}
          disabled={!valid}
          primary
          styles={styles}
        />
        <ActionButton
          label="Cancel poll"
          pendingLabel="Cancel poll"
          onPress={onClose}
          styles={styles}
        />
      </View>
    </ScrollView>
  );
}

/** Resize photos before sending. Only the selected session receives the image bytes. */
let imageId = 0;
async function readImage(file: File): Promise<ChatDraft["images"][number]> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("The browser could not read this image.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let url = canvas.toDataURL("image/jpeg", 0.82);
    if (url.length > 480000) url = canvas.toDataURL("image/jpeg", 0.6);
    const data = url.slice(url.indexOf(",") + 1);
    if (!url.startsWith("data:image/jpeg;base64,") || data.length > CHAT_IMAGE_CHARS)
      throw new Error("The image is too large. Choose a smaller image.");
    return { id: ++imageId, name: file.name, mimeType: "image/jpeg", data };
  } finally {
    bitmap.close();
  }
}

function ImagePicker({
  draft,
  styles,
  onReading,
}: {
  draft: ChatDraft;
  styles: OfficeStyles;
  onReading(value: boolean): void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const loading = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      onReading(false);
    };
  }, [onReading]);
  const [error, setError] = useState<string | null>(null);
  const open = useCallback(() => ref.current?.click(), []);
  const { images, setImages } = draft;
  const pick = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.currentTarget.files ?? []);
      event.currentTarget.value = "";
      if (files.length > CHAT_IMAGE_LIMIT - images.length) {
        setError("Choose up to four images.");
        return;
      }
      if (loading.current) return;
      loading.current = true;
      onReading(true);
      try {
        const additions = await Promise.all(files.map(readImage));
        if (!mounted.current) return;
        setImages((previous) => [...previous, ...additions].slice(0, CHAT_IMAGE_LIMIT));
        setError(null);
      } catch (caught) {
        if (mounted.current) setError(failureText("Attach image", caught));
      } finally {
        loading.current = false;
        if (mounted.current) onReading(false);
      }
    },
    [images.length, setImages, onReading],
  );
  return (
    <>
      <input
        type="file"
        ref={ref}
        multiple
        accept="image/*"
        hidden
        onChange={pick}
        aria-label="Choose images"
      />
      <ChatIcon name="ImagePlus" label="Attach images" onPress={open} styles={styles} />
      {error && (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {error}
        </Text>
      )}
    </>
  );
}

function ImageDrafts({ draft, styles }: { draft: ChatDraft; styles: OfficeStyles }) {
  return (
    <View style={styles.chatReactions}>
      {draft.images.map((image) => (
        <ImagePreview key={image.id} image={image} setImages={draft.setImages} styles={styles} />
      ))}
    </View>
  );
}
function ImagePreview({
  image,
  setImages,
  styles,
}: {
  image: ChatDraft["images"][number];
  setImages: ChatDraft["setImages"];
  styles: OfficeStyles;
}) {
  const remove = useCallback(
    () => setImages((items) => items.filter((item) => item !== image)),
    [setImages, image],
  );
  return (
    <View style={styles.messenger.preview}>
      <img
        alt={image.name}
        width={40}
        height={40}
        src={`data:image/jpeg;base64,${image.data}`}
        style={previewStyle}
      />
      <ChatIcon name="X" label={`Remove ${image.name}`} onPress={remove} styles={styles} />
    </View>
  );
}
const previewStyle = { objectFit: "cover", borderRadius: 6 } as const;

export function ComposeTools({
  draft,
  members,
  web,
  run,
  styles,
  setReading,
  insertMention,
  stickersOpen,
  toggleStickers,
  onUse,
  openSession,
  onBoard,
  onDuties,
  onNewAgent,
  onGroupPhoto,
}: ChatShortcuts & {
  onUse(message: string): void;
  openSession(id: string): void;
  draft: ChatDraft;
  members: readonly MentionOption[];
  web: boolean;
  run(request: ChatRequest): Promise<boolean>;
  styles: OfficeStyles;
  setReading(value: boolean): void;
  insertMention(): void;
  stickersOpen: boolean;
  toggleStickers(): void;
}) {
  const { recipient, setRecipient } = draft;
  const [panel, setPanel] = useState<"more" | "poll" | null>(null);
  const pollOpen = panel === "poll";
  const togglePoll = useCallback(() => setPanel((p) => (p === "poll" ? null : "poll")), []);
  const toggleMore = useCallback(() => setPanel((p) => (p === "more" ? null : "more")), []);
  const close = useCallback(() => setPanel(null), []);
  return (
    <>
      <ToField
        openSession={openSession}
        members={members}
        value={recipient}
        onPick={setRecipient}
        styles={styles}
      />
      <View style={styles.messenger.toolbar}>
        <ChatIcon
          name="Smile"
          label="Stickers"
          active={stickersOpen}
          onPress={toggleStickers}
          styles={styles}
        />
        <ChatIcon
          name="ChartNoAxesColumnIncreasing"
          label="Create poll"
          active={pollOpen}
          onPress={togglePoll}
          styles={styles}
        />
        <ChatIcon name="AtSign" label="Mention someone" onPress={insertMention} styles={styles} />
        {web && recipient && (
          <ImagePicker key={recipient} draft={draft} styles={styles} onReading={setReading} />
        )}
        <ChatIcon
          name="Ellipsis"
          label="More chat actions"
          active={panel === "more"}
          onPress={toggleMore}
          styles={styles}
        />
      </View>
      {panel === "more" && (
        <ChatMore
          draft={draft}
          web={web}
          onUse={onUse}
          onClose={close}
          styles={styles}
          onBoard={onBoard}
          onDuties={onDuties}
          onNewAgent={onNewAgent}
          onGroupPhoto={onGroupPhoto}
        />
      )}
      {pollOpen && <PollForm run={run} onClose={close} styles={styles} />}
      {draft.images.length > 0 && <ImageDrafts draft={draft} styles={styles} />}
      {draft.images.length > 0 && !recipient && (
        <Text style={styles.chatMeta}>Choose a session for the attached images.</Text>
      )}
    </>
  );
}
