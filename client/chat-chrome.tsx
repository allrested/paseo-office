import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { memberAvatar, type MentionOption } from "./chat-text.js";
import type { OfficeStyles } from "./styles.js";

export function ChatIcon({
  name,
  label,
  active,
  onPress,
  styles,
}: {
  name: string;
  label: string;
  active?: boolean;
  onPress(): void;
  styles: OfficeStyles;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-pressed={active}
      onPress={onPress}
      style={styles.messenger.icon}
    >
      <Icon name={name} size={19} color={styles.iconColor} />
    </Pressable>
  );
}

function MemberDisc({ id, name, styles }: { id: string; name: string; styles: OfficeStyles }) {
  const avatar = memberAvatar(id, name);
  const style = useMemo(
    () => [styles.messenger.memberAvatar, { backgroundColor: avatar.color }],
    [styles, avatar.color],
  );
  return (
    <View style={style}>
      <Text style={styles.messenger.memberInitial}>{avatar.initials}</Text>
    </View>
  );
}

export function ChatHeader({
  members,
  searching,
  onSearch,
  onClose,
  styles,
}: {
  members: readonly MentionOption[];
  searching: boolean;
  onSearch(): void;
  onClose?(): void;
  styles: OfficeStyles;
}) {
  const count = members.length + 1;
  return (
    <View style={styles.messenger.header}>
      <View style={styles.messenger.group} aria-hidden>
        <MemberDisc id="me" name="You" styles={styles} />
        {members.slice(0, 3).map((member) => (
          <MemberDisc key={member.id} id={member.id} name={member.name} styles={styles} />
        ))}
      </View>
      <View style={styles.rowBody}>
        <Text accessibilityRole="header" style={styles.messenger.title}>
          Office team
        </Text>
        <Text style={styles.messenger.subtitle}>
          {count === 1 ? "1 member" : `${count} members`}
        </Text>
      </View>
      <ChatIcon
        name="Search"
        label="Search chat"
        active={searching}
        onPress={onSearch}
        styles={styles}
      />
      {onClose && <ChatIcon name="X" label="Close team chat" onPress={onClose} styles={styles} />}
    </View>
  );
}

function RecipientRow({
  member,
  selected,
  onPick,
  styles,
}: {
  member: MentionOption | null;
  selected: boolean;
  onPick(id: string | null): void;
  styles: OfficeStyles;
}) {
  const choose = useCallback(() => onPick(member?.id ?? null), [onPick, member]);
  const label = member?.name ?? "Whole group";
  const hint = member?.room ?? "Send to the group chat";
  return (
    <Pressable
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityLabel={`${label}, ${hint}`}
      onPress={choose}
      style={styles.messenger.choice}
    >
      {member ? (
        <MemberDisc id={member.id} name={member.name} styles={styles} />
      ) : (
        <Icon name="UsersRound" size={18} color={styles.iconColor} />
      )}
      <View style={styles.rowBody}>
        <Text numberOfLines={1} style={styles.chatName}>
          {label}
        </Text>
        <Text numberOfLines={1} style={styles.chatMeta}>
          {hint}
        </Text>
      </View>
      {selected && <Icon name="Check" size={16} color={styles.iconColor} />}
    </Pressable>
  );
}

export function ToField({
  members,
  value,
  onPick,
  styles,
}: {
  members: readonly MentionOption[];
  value: string | null;
  onPick(id: string | null): void;
  styles: OfficeStyles;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const toggle = useCallback(() => {
    setOpen((v) => !v);
    setQuery("");
  }, []);
  const pick = useCallback(
    (id: string | null) => {
      onPick(id);
      setOpen(false);
      setQuery("");
    },
    [onPick],
  );
  const name =
    value === null
      ? "Whole group"
      : (members.find((m) => m.id === value)?.name ?? "Session unavailable");
  const needle = query.trim().toLowerCase();
  const visible = members.filter(
    (m) => m.name.toLowerCase().includes(needle) || m.room.toLowerCase().includes(needle),
  );
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        aria-expanded={open}
        accessibilityLabel={`To: ${name}`}
        onPress={toggle}
        style={styles.messenger.to}
      >
        <Text style={styles.chatMeta}>To</Text>
        <Text numberOfLines={1} style={styles.messenger.chosenName}>
          {name}
        </Text>
        <Icon name="ChevronDown" size={14} color={styles.iconColor} />
      </Pressable>
      {value !== null && !open && (
        <Text style={styles.chatMeta}>The session receives your message and replies here.</Text>
      )}
      {open && (
        <View style={styles.messenger.picker}>
          {members.length > 8 && (
            <TextInput
              accessibilityLabel="Find a session"
              placeholder="Find a session"
              placeholderTextColor={styles.placeholderColor}
              value={query}
              onChangeText={setQuery}
              style={styles.fieldInput}
            />
          )}
          <ScrollView keyboardShouldPersistTaps="handled">
            <View accessibilityRole="radiogroup" accessibilityLabel="Message recipient">
              <RecipientRow member={null} selected={value === null} onPick={pick} styles={styles} />
              {visible.map((m) => (
                <RecipientRow
                  key={m.id}
                  member={m}
                  selected={value === m.id}
                  onPick={pick}
                  styles={styles}
                />
              ))}
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
}
