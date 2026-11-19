import type { PluginTheme } from "@getpaseo/plugin";
import { isDarkTheme } from "./world/adapter.js";

// The fullscreen shell uses the surfaces, ink and status colors of my-office's styles/base.css.
const night: PluginTheme = {
  colors: {
    surface0: "#131922",
    surface1: "#18202B",
    surface2: "#263040",
    border: "#323C4A",
    foreground: "#E8ECF4",
    foregroundMuted: "#A2AEC1",
    accent: "#EF8A5F",
    accentForeground: "#2A1307",
    statusSuccess: "#3DDC84",
    statusWarning: "#F2B544",
    statusDanger: "#FF7171",
  },
};
const day: PluginTheme = {
  colors: {
    surface0: "#F7F8FA",
    surface1: "#FFFFFF",
    surface2: "#E6EBF2",
    border: "#C8D0DC",
    foreground: "#152338",
    foregroundMuted: "#506176",
    accent: "#A9411E",
    accentForeground: "#FFFFFF",
    statusSuccess: "#147241",
    statusWarning: "#875900",
    statusDanger: "#B13236",
  },
};
export function fullscreenTheme(host: PluginTheme, integrated: boolean) {
  if (!integrated) return host;
  return isDarkTheme(host.colors) ? night : day;
}
