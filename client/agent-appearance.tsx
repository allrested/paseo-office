import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { usePaseo } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/ui";
import {
  APPEARANCE_KEY,
  AVATARS,
  GENDERS,
  COLORS,
  SHIRTS,
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
  const [name, setName] = useState(agent.appearance?.name ?? "");
  const [gender, setGender] = useState(agent.appearance?.gender);
  const [avatar, setAvatar] = useState(agent.appearance?.avatar);
  const [color, setColor] = useState(agent.appearance?.color);
  const modalChange = useCallback(
    (open: boolean) => {
      if (!open) close();
    },
    [close],
  );
  const save = useCallback(async () => {
    const appearance: Appearance = {};
    if (name.trim()) appearance.name = name.trim();
    if (gender) appearance.gender = gender;
    if (avatar) appearance.avatar = avatar;
    if (color) appearance.color = color;
    await paseo.agents
      .ref(agent.id)
      .setMetadata({ [APPEARANCE_KEY]: Object.keys(appearance).length ? appearance : null });
    close();
  }, [name, gender, avatar, color, paseo, agent.id, close]);
  return (
    <OfficeModal open title="Customize agent" onOpenChange={modalChange}>
      <OfficeModal.Content>
        <View style={styles.sheet}>
          <View style={styles.sheetField}>
            <Text style={styles.sheetLabel}>Office display name</Text>
            <TextInput
              accessibilityLabel="Office display name"
              maxLength={60}
              value={name}
              onChangeText={setName}
              placeholder="Use default name"
              style={styles.fieldInput}
            />
          </View>
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
              {avatarInitials(name.trim() || agentTitle(agent))}
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
