import { useCallback } from "react";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { OfficeSettings } from "./client/office-settings.js";
import { createOfficeSurface } from "./client/office-surface.js";
import { createSidebarLauncher } from "./client/sidebar-launcher.js";

const SCREEN_ID = "office";
const PANEL_ID = "office";
const ICON = "Building2";

// The sidebar item and the two Command Center items (the office, its settings) are the ways in;
// Settings > Sidebar can hide the sidebar item. The office's settings are a screen of the app's
// Settings.
export default function contribute(client: PluginClientContext) {
  const launcher = createSidebarLauncher();
  const Surface = createOfficeSurface(() => client.openSettings(SCREEN_ID), launcher);
  function OfficeItem({ currentScreen, layout, openScreen }: PluginSidebarItemProps) {
    const open = useCallback(() => {
      if (layout.platform !== "web") {
        openScreen({ screenId: SCREEN_ID });
      } else if (!launcher.open()) {
        openScreen({ screenId: SCREEN_ID, params: { layout: "fullscreen" } });
      }
    }, [layout.platform, openScreen]);
    return <SidebarRow icon={ICON} active={currentScreen?.screenId === SCREEN_ID} onPress={open} />;
  }
  const removers = [
    client.addScreen({ id: SCREEN_ID, title: "Office 3D", Component: Surface }),
    client.addSettingsScreen({
      id: SCREEN_ID,
      title: "Office 3D",
      icon: ICON,
      Component: OfficeSettings,
    }),
    client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Office 3D", Component: OfficeItem }),
    client.addWorkspacePanel({
      id: PANEL_ID,
      title: "Office 3D",
      icon: ICON,
      Component: Surface,
    }),
    client.addCommandCenterItem({
      id: "open-office",
      title: "Open office",
      icon: ICON,
      context: "workspace",
      onSelect({ openPanel }) {
        openPanel(PANEL_ID);
      },
    }),
    client.addCommandCenterItem({
      id: "open-office-settings",
      title: "Office 3D settings",
      icon: ICON,
      keywords: ["office", "wake", "notes", "incidents", "view"],
      context: "global",
      onSelect({ openSettings: open }) {
        open(SCREEN_ID);
      },
    }),
  ];
  return () => {
    for (const remove of removers) void remove();
  };
}
