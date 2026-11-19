import type { PluginSurfaceProps } from "@getpaseo/plugin/client";

/** What some Paseo apps can show beside a plugin's screen; stock Paseo 0.16's app has no side area. */
export interface BesideTarget {
  readonly kind: "screen";
  readonly pluginId: string;
  readonly screenId: string;
  readonly params?: Record<string, string>;
  readonly serverId?: string;
}

type Navigation = PluginSurfaceProps["navigation"];

/** The app's `showBeside`, where it has one; the published types do not declare it. */
export function showBesideOf(navigation: Navigation): ((target: BesideTarget) => boolean) | null {
  const call: unknown = (navigation as Record<string, unknown> | undefined)?.showBeside;
  return typeof call === "function" ? (call as (target: BesideTarget) => boolean) : null;
}

// Another plugin's screen, the host's resources, shown beside the floor when a host has both a
// side area and that plugin.
const RESOURCES: BesideTarget = {
  kind: "screen",
  pluginId: "resource-manager",
  screenId: "resources",
};

/**
 * What the server room's wall screen opens: Resources beside the floor, or the Host card when
 * the side area cannot show it. Undefined on an app without a side area, where the scene keeps
 * the wall screen on the Host card.
 */
export function resourcesOpener(
  navigation: Navigation,
  openMachine: () => void,
): (() => void) | undefined {
  const showBeside = showBesideOf(navigation);
  if (showBeside === null) return undefined;
  return () => {
    if (!showBeside(RESOURCES)) openMachine();
  };
}
