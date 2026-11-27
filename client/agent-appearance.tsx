import { useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "./text.js";
import { usePaseo } from "@getpaseo/plugin/client";
import { TextInput } from "./text.js";
import {
  APPEARANCE_KEY,
  savedAppearance,
  AVATARS,
  GENDERS,
  COLORS,
  SHIRTS,
  shirtColor,
  type Appearance,
} from "../shared/appearance.js";
import type { OfficeAgent } from "../shared/contracts.js";
import { agentTitle } from "../shared/model.js";
import { OfficeModal } from "./office-modal.js";
import { ActionButton } from "./action-button.js";
import { avatarInitials } from "./sessions-text.js";
import type { OfficeStyles } from "./styles.js";

export function AppearanceEditor({
  agent,
  styles,
  close,
}: {
  agent: OfficeAgent;
  styles: OfficeStyles;
  close(): void;
}) {
  const paseo = usePaseo();
  const [draft, setDraft] = useState<Appearance>(agent.appearance ?? {});
  const modalChange = useCallback(
    (open: boolean) => {
      if (!open) close();
    },
    [close],
  );
  const save = useCallback(async () => {
    await paseo.agents.ref(agent.id).setMetadata({ [APPEARANCE_KEY]: savedAppearance(draft) });
    close();
  }, [draft, paseo, agent.id, close]);
  return (
    <OfficeModal open title="Customize agent" onOpenChange={modalChange}>
      <OfficeModal.Content>
        <View style={styles.sheet}>
          <AppearanceFields
            draft={draft}
            change={setDraft}
            fallback={agentTitle(agent)}
            styles={styles}
          />
          <ActionButton
            label="Save appearance"
            pendingLabel="Saving…"
            primary
            onPress={save}
            styles={styles}
          />
        </View>
      </OfficeModal.Content>
    </OfficeModal>
  );
}

const emptyProfile: Appearance = {};

export function AppearanceFields({
  draft,
  change,
  fallback = "",
  styles,
  collapsible = false,
}: {
  draft?: Appearance;
  change(next: Appearance): void;
  fallback?: string;
  styles: OfficeStyles;
  collapsible?: boolean;
}) {
  const { name = "", gender, avatar, color } = draft ?? emptyProfile;
  const badgeColor = shirtColor(draft) ?? styles.placeholderColor;
  const badgeStyle = useMemo(
    () => [styles.sessions.identityAvatar, { borderWidth: 2, borderColor: badgeColor }],
    [styles.sessions.identityAvatar, badgeColor],
  );
  const character = [gender, avatar, color].filter(Boolean).join(" · ");
  const nameLabel = collapsible ? "Agent name" : "Office display name";
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);
  const setName = useCallback(
    (value: string) => change({ ...draft, name: value }),
    [change, draft],
  );
  const setGender = useCallback(
    (value: Appearance["gender"]) => change({ ...draft, gender: value }),
    [change, draft],
  );
  const setAvatar = useCallback(
    (value: Appearance["avatar"]) => change({ ...draft, avatar: value }),
    [change, draft],
  );
  const setColor = useCallback(
    (value: Appearance["color"]) => change({ ...draft, color: value }),
    [change, draft],
  );
  return (
    <>
      <View style={styles.sheetField}>
        <Text style={styles.sheetLabel}>{nameLabel}</Text>
        <TextInput
          accessibilityLabel={nameLabel}
          maxLength={60}
          value={name}
          onChangeText={setName}
          placeholder="Use default name"
          style={styles.fieldInput}
        />
      </View>
      {collapsible && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Customize character"
          aria-expanded={expanded}
          onPress={toggle}
          style={styles.newAgentSelector}
        >
          <View aria-hidden style={badgeStyle}>
            <Text style={styles.sessions.initials}>
              {avatar ? AVATARS[avatar] : avatarInitials(name || "Agent")}
            </Text>
          </View>
          <Text style={styles.sidebarButtonText}>
            {expanded ? "Hide character options" : character || "Customize character"}
          </Text>
        </Pressable>
      )}
      {(!collapsible || expanded) && (
        <>
          <Text style={styles.sheetLabel}>Character gender</Text>
          <View style={choiceRow}>
            {[undefined, ...GENDERS].map((option) => (
              <Choice<(typeof GENDERS)[number]>
                key={option ?? "auto"}
                label={option ?? "Automatic gender"}
                value={option}
                selected={gender === option}
                choose={setGender}
                styles={styles}
              >
                {option ?? "Auto"}
              </Choice>
            ))}
          </View>
          <Text style={styles.sheetLabel}>Avatar</Text>
          <View style={choiceRow}>
            <Choice<keyof typeof AVATARS>
              label="Initials"
              selected={!avatar}
              value={undefined}
              choose={setAvatar}
              styles={styles}
            >
              {avatarInitials(name.trim() || fallback)}
            </Choice>
            {Object.entries(AVATARS).map(([key, icon]) => (
              <Choice<keyof typeof AVATARS>
                key={key}
                label={key}
                selected={avatar === key}
                value={key as keyof typeof AVATARS}
                choose={setAvatar}
                styles={styles}
              >
                {icon}
              </Choice>
            ))}
          </View>
          <Text style={styles.sheetLabel}>Agent color</Text>
          <View style={choiceRow}>
            <Choice<(typeof COLORS)[number]>
              label="Automatic color"
              selected={!color}
              value={undefined}
              choose={setColor}
              styles={styles}
            >
              Auto
            </Choice>
            {COLORS.map((item, index) => (
              <Choice<(typeof COLORS)[number]>
                key={item}
                label={item}
                selected={item === color}
                value={item}
                choose={setColor}
                styles={styles}
              >
                <View style={swatches[index]} />
              </Choice>
            ))}
          </View>
        </>
      )}
    </>
  );
}

const choiceRow = { flexDirection: "row", flexWrap: "wrap", gap: 6 } as const;
const swatches = SHIRTS.map(({ shirt }) => ({
  width: 20,
  height: 20,
  borderRadius: 10,
  backgroundColor: shirt,
}));
function Choice<T extends string>({
  label,
  selected,
  value,
  choose,
  styles,
  children,
}: {
  label: string;
  selected: boolean;
  value: T | undefined;
  choose(value: T | undefined): void;
  styles: OfficeStyles;
  children: React.ReactNode;
}) {
  const press = useCallback(() => choose(value), [value, choose]);
  const state = useMemo(() => ({ selected }), [selected]);
  const style = useMemo(
    () => ({
      alignItems: "center" as const,
      justifyContent: "center" as const,
      minWidth: 44,
      minHeight: 44,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: selected ? styles.iconColor : "transparent",
      backgroundColor: styles.input.backgroundColor,
    }),
    [selected, styles],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={state}
      onPress={press}
      style={style}
    >
      {typeof children === "string" ? <Text style={styles.sheetText}>{children}</Text> : children}
    </Pressable>
  );
}
