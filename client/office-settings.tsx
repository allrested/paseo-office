import { OfficeBrandContext } from "./office-brand-context.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Text } from "./text.js";
import { OfficeModal } from "./office-modal.js";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { HostSwitches } from "./host-switches.js";
import { settingsLayout } from "./settings-sections.js";
import { LanguageSetting } from "./language-switch.js";
import { LabeledSwitch } from "./labeled-switch.js";
import { deviceProblemOf, hasTouchScreen, readPointer, useViewChoice } from "./office-surface.js";
import { useOfficeStyles, type OfficeStyles } from "./styles.js";
import { useBoardActions } from "./use-board-actions.js";
import { useOffice } from "./use-office.js";
import { useOfficeScene } from "./use-street.js";
import { useSoundSwitch } from "./use-sound.js";
import { SceneChoices } from "./scene-picker.js";
import { holdersOf } from "./teams-text.js";
import { ViewSwitch } from "./view-switch.js";
import { UiLanguage } from "./ui-language.js";

export function OfficeSettings(props: PluginSurfaceProps) {
  return (
    <UiLanguage>
      <SettingsPage {...props} />
    </UiLanguage>
  );
}

function SettingsPage({ theme, layout }: PluginSurfaceProps) {
  const touchScreen = useMemo(
    () => hasTouchScreen(layout.platform, layout.platform === "web" ? readPointer() : null),
    [layout.platform],
  );
  const styles = useOfficeStyles(theme, layout.compact, touchScreen);
  const office = useOffice();
  const actions = useBoardActions();
  const view = useViewChoice(layout.platform);
  const street = useOfficeScene(layout);
  const sound = useSoundSwitch();
  return (
    <OfficeSettingsFields
      office={office}
      styles={styles}
      actions={actions}
      view={view}
      street={street}
      sound={sound}
    />
  );
}

interface FieldsProps {
  office: ReturnType<typeof useOffice>;
  styles: OfficeStyles;
  actions: ReturnType<typeof useBoardActions>;
  view: ReturnType<typeof useViewChoice>;
  street: ReturnType<typeof useOfficeScene>;
  sound: ReturnType<typeof useSoundSwitch>;
  /** In a dialog: the sections scroll inside its body. */
  bounded?: boolean;
}

function OfficeSettingsFields({
  office,
  styles,
  actions,
  view,
  street,
  sound,
  bounded,
}: FieldsProps) {
  const language = useMemo(() => <LanguageSetting styles={styles} />, [styles]);
  // Frozen data says nothing of the wakes: the switch is then not usable.
  const live = office.subscription.status !== "error" && office.subscription.status !== "closed";
  const rosterHolders = useMemo(() => holdersOf(office.state.agents), [office.state.agents]);
  return (
    <OfficeBrandContext.Provider value={office.state.brand}>
      <HostSwitches
        bounded={bounded}
        rosterHolders={rosterHolders}
        language={language}
        wake={office.loaded && live ? office.state.wake : null}
        actions={actions}
        styles={styles}
        deviceProblem={
          deviceProblemOf(view.unsaved, sound.unsaved) ??
          (street.unsaved ? "Unable to save the scene on this device." : null)
        }
        scheduleError={office.state.notes?.scheduleError ?? null}
        weather={office.state.weather}
        incidents={office.state.incidents}
      >
        <>
          <SceneChoices choice={street} styles={styles} />
          <View style={settingsLayout.strip}>
            <Text style={styles.sheetLabel}>Office view</Text>
            <ViewSwitch
              options={view.options}
              value={view.choice}
              onChange={view.choose}
              styles={styles}
            />
            <LabeledSwitch label="Sound" value={sound.on} onChange={sound.set} styles={styles} />
          </View>
        </>
      </HostSwitches>
    </OfficeBrandContext.Provider>
  );
}

export function FullscreenSettings({
  open,
  onClose,
  ...fields
}: FieldsProps & {
  open: boolean;
  onClose(): void;
}) {
  return (
    <OfficeModal title="Office settings" size="settings" open={open} onOpenChange={onClose}>
      <OfficeModal.Content scrollable={false} contentContainerStyle={settingsLayout.body}>
        <OfficeSettingsFields {...fields} bounded />
      </OfficeModal.Content>
    </OfficeModal>
  );
}

export function useOfficeSettingsDialog(fullscreen: boolean, nativeSettings?: () => void) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!fullscreen) close();
  }, [fullscreen, close]);
  return { open: fullscreen && open, show: fullscreen ? show : nativeSettings, close };
}
