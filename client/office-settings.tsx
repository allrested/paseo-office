import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { OfficeModal } from "./office-modal.js";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { HostSwitches } from "./host-switches.js";
import { LanguageSetting } from "./language-switch.js";
import { LabeledSwitch } from "./labeled-switch.js";
import { deviceProblemOf, hasTouchScreen, readPointer, useViewChoice } from "./office-surface.js";
import { useOfficeStyles, type OfficeStyles } from "./styles.js";
import { useBoardActions } from "./use-board-actions.js";
import { useOffice } from "./use-office.js";
import { useOfficeScene } from "./use-street.js";
import { useSoundSwitch } from "./use-sound.js";
import { SceneChoices } from "./scene-picker.js";
import { ViewSwitch } from "./view-switch.js";

export function OfficeSettings({ theme, layout }: PluginSurfaceProps) {
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
}

function OfficeSettingsFields({ office, styles, actions, view, street, sound }: FieldsProps) {
  // Frozen data says nothing of the wakes: the switch is then not usable.
  const live = office.subscription.status !== "error" && office.subscription.status !== "closed";
  return (
    <View style={styles.header}>
      <HostSwitches
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
          <ViewSwitch
            options={view.options}
            value={view.choice}
            onChange={view.choose}
            styles={styles}
          />
          <LabeledSwitch label="Sound" value={sound.on} onChange={sound.set} styles={styles} />
          <SceneChoices choice={street} styles={styles} />
        </>
      </HostSwitches>
      <LanguageSetting styles={styles} />
    </View>
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
    <OfficeModal title="Office settings" open={open} onOpenChange={onClose}>
      <OfficeModal.Content>
        <OfficeSettingsFields {...fields} />
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
