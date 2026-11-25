import { useSettings } from "@getpaseo/plugin/client";
import { officeHostSettings } from "../shared/settings.js";

/** The host's "Gen-UI cards" setting; off until the host has said. */
export function useUiCards(): boolean {
  const settings = useSettings(officeHostSettings);
  return settings.status === "ready" && settings.values.uiCards;
}
