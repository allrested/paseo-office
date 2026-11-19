import type { Appearance } from "../shared/appearance.js";
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

function MemberDisc({
  id,
  name,
  appearance,
  styles,
}: {
  appearance?: Appearance;
  id: string;
  name: string;
  styles: OfficeStyles;
}) {
  const avatar = memberAvatar(id, name, appearance);
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

export interface ChatMember extends MentionOption {
  status: string;
}
function MemberRow({
  member,
  open,
  styles,
}: {
  member: ChatMember;
  open(id: string): void;
  styles: OfficeStyles;
}) {
  const show = useCallback(() => open(member.id), [open, member.id]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${member.name}, ${member.status}, ${member.room}`}
      onPress={show}
      style={styles.messenger.choice}
    >
      <MemberDisc
        id={member.id}
        appearance={member.appearance}
        name={member.name}
        styles={styles}
      />
      <View style={styles.rowBody}>
        <Text numberOfLines={1} style={styles.chatName}>
          {member.name}
        </Text>
        <Text numberOfLines={1} style={styles.chatMeta}>
          {member.status} · {member.room}
        </Text>
      </View>
      <Icon name="ArrowUpRight" size={15} color={styles.iconColor} />
    </Pressable>
  );
}
export function ChatHeader({
  members,
  onOpenSession,
  searching,
  onSearch,
  onClose,
  styles,
}: {
  members: readonly ChatMember[];
  onOpenSession(id: string): void;
  searching: boolean;
  onSearch(): void;
  onClose?(): void;
  styles: OfficeStyles;
}) {
  const count = members.length + 1;
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const open = useCallback(
    (id: string) => {
      setExpanded(false);
      onOpenSession(id);
    },
    [onOpenSession],
  );
  return (
    <>
      <View style={styles.messenger.header}>
        <View style={styles.messenger.group} aria-hidden>
          <MemberDisc id="me" name="You" styles={styles} />
          {members.slice(0, 3).map((member) => (
            <MemberDisc
              key={member.id}
              id={member.id}
              appearance={member.appearance}
              name={member.name}
              styles={styles}
            />
          ))}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Team members"
          aria-expanded={expanded}
          onPress={toggle}
          style={styles.rowBody}
        >
          <Text accessibilityRole="header" style={styles.messenger.title}>
            Office team
          </Text>
          <Text style={styles.messenger.subtitle}>
            {count === 1 ? "1 member" : `${count} members`}
          </Text>
        </Pressable>
        <ChatIcon
          name="Search"
          label="Search chat"
          active={searching}
          onPress={onSearch}
          styles={styles}
        />
        {onClose && <ChatIcon name="X" label="Close team chat" onPress={onClose} styles={styles} />}
      </View>
      {expanded && (
        <ScrollView style={styles.messenger.memberList} keyboardShouldPersistTaps="handled">
          <View style={styles.messenger.choice}>
            <MemberDisc id="me" name="You" styles={styles} />
            <Text style={styles.chatName}>You</Text>
          </View>
          {members.map((member) => (
            <MemberRow key={member.id} member={member} open={open} styles={styles} />
          ))}
        </ScrollView>
      )}
    </>
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
  const hint = member?.room ?? "Ask an available session";
  return (
    <Pressable
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityLabel={`${label}, ${hint}`}
      onPress={choose}
      style={styles.messenger.choice}
    >
      {member ? (
        <MemberDisc
          id={member.id}
          appearance={member.appearance}
          name={member.name}
          styles={styles}
        />
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
  openSession,
  members,
  value,
  onPick,
  styles,
}: {
  members: readonly MentionOption[];
  openSession(id: string): void;
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
  const showSession = useCallback(() => {
    if (value !== null) openSession(value);
  }, [value, openSession]);
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
        <View style={styles.messenger.quickRow}>
          <View style={styles.rowBody}>
            <Text style={styles.chatMeta}>The session receives your message and replies here.</Text>
          </View>
          {members.some((m) => m.id === value) && (
            <ChatIcon
              name="ExternalLink"
              label="Open recipient session"
              onPress={showSession}
              styles={styles}
            />
          )}
        </View>
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
