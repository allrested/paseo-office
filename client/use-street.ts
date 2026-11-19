import { useDeviceSwitch } from "./use-device-switch.js";
export const UNSAVED_STREET =
  "Unable to save the street setting on this device. It holds until this screen is closed.";
interface StreetLayout {
  platform: string;
  compact: boolean;
}
export function streetDefault(layout: StreetLayout): boolean {
  return layout.platform === "web" && !layout.compact;
}
export function useStreetSwitch(layout: StreetLayout) {
  return useDeviceSwitch("street", streetDefault(layout));
}
