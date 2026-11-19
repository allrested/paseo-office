import { useDeviceSwitch, type DeviceSwitch } from "./use-device-switch.js";
export type SoundSwitch = DeviceSwitch;
export const UNSAVED_SOUND =
  "Unable to save the Sound setting on this device. It holds until this screen is closed.";

export function useSoundSwitch(): SoundSwitch {
  return useDeviceSwitch("sound", false);
}
