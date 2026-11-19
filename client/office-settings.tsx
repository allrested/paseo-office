import { useMemo } from "react";
import { View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { HostSwitches } from "./host-switches.js";
import { LabeledSwitch } from "./labeled-switch.js";
import { deviceProblemOf, hasTouchScreen, readPointer, useViewChoice } from "./office-surface.js";
import { useOfficeStyles } from "./styles.js";
import { useBoardActions } from "./use-board-actions.js";
import { useOffice } from "./use-office.js";
import { useSoundSwitch } from "./use-sound.js";
import { ViewSwitch } from "./view-switch.js";

/**
 * The office's settings, under the app's Settings: what the host holds (wakes, agent tools, the
 * stand-up notes, the incident trackers, the 3D floor's plan) and this device's view and Sound
 * switch. The office's page shows none of them, so a phone's floor is not covered. The screen
 * follows the office's state for the wakes and the schedules' failures, so the host does its "an
 * office surface is open" work while it is open.
 */
export function OfficeSettings({ theme, layout }: PluginSurfaceProps) {
  const touchScreen = useMemo(
    () => hasTouchScreen(layout.platform, layout.platform === "web" ? readPointer() : null),
    [layout.platform],
  );
  const styles = useOfficeStyles(theme, layout.compact, touchScreen);
  const office = useOffice();
  const actions = useBoardActions();
  const view = useViewChoice(layout.platform);
  const sound = useSoundSwitch();
  // Frozen data says nothing of the wakes: the switch is then not usable.
  const live = office.subscription.status !== "error" && office.subscription.status !== "closed";
  return (
    <View style={styles.header}>
      <HostSwitches
        wake={office.loaded && live ? office.state.wake : null}
        actions={actions}
        styles={styles}
        deviceProblem={deviceProblemOf(view.unsaved, sound.unsaved)}
        scheduleError={office.state.notes?.scheduleError ?? null}
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
        </>
      </HostSwitches>
    </View>
  );
}
