import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View, type TextStyle, type ViewStyle } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { ChatMessage, ChatSnapshot } from "../shared/contracts.js";
import { isYours, shows, STICKERS } from "./chat-text.js";

const card: ViewStyle = {
  position: "absolute",
  zIndex: 4,
  top: 58,
  right: 12,
  maxWidth: "92%",
  width: 318,
  minHeight: 56,
  flexDirection: "row",
  gap: 12,
  alignItems: "center",
  borderRadius: 12,
  paddingHorizontal: 14,
  paddingVertical: 9,
  backgroundColor: "#fff",
  borderWidth: 1,
  borderColor: "#cbd4df",
};
const badge: ViewStyle = {
  width: 34,
  height: 34,
  borderRadius: 17,
  backgroundColor: "#e5f1ff",
  alignItems: "center",
  justifyContent: "center",
};
const copy: ViewStyle = { flex: 1, minWidth: 0 };
const title: TextStyle = { color: "#102647", fontWeight: "700", fontSize: 14 };
const text: TextStyle = { color: "#526279", fontSize: 13 };

function previewText(message: ChatMessage): string {
  if (message.kind === "photo") return "Office photo";
  if (message.kind === "poll") return message.poll?.q ?? "Poll";
  if (message.kind === "remind") return message.remind?.title ?? "Reminder";
  if (message.kind === "sticker") return STICKERS[message.sticker ?? 0] ?? "Sticker";
  return message.text ?? "";
}

/** A newly arrived group message can open the messenger without changing the camera or rail. */
export function TeamChatPreview({ chat, onOpen }: { chat: ChatSnapshot | null; onOpen(): void }) {
  const newest = chat?.messages.at(-1);
  const id = newest?.id ?? "";
  const last = useRef<string | null>(null);
  const [visible, setVisible] = useState("");
  useEffect(() => {
    const previous = last.current;
    last.current = chat === null ? null : id;
    if (previous !== null && previous !== id) setVisible(id);
  }, [chat, id]);
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(""), 4200);
    return () => clearTimeout(timer);
  }, [visible]);
  if (
    !newest ||
    visible !== id ||
    newest.recalled ||
    isYours(newest) ||
    newest.kind === "sys" ||
    !shows(newest)
  )
    return null;
  const caption = [newest.name, previewText(newest)].filter(Boolean).join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open team chat: ${caption}`}
      onPress={onOpen}
      style={card}
    >
      <View style={badge}>
        <Icon name="MessagesSquare" size={18} color="#20599a" />
      </View>
      <View style={copy}>
        <Text style={title}>Office team</Text>
        <Text numberOfLines={1} style={text}>
          {caption}
        </Text>
      </View>
    </Pressable>
  );
}
