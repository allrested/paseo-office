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

/** Earlier devices saved only whether the city street was visible. */
export function useOfficeScene(layout: StreetLayout) {
  const legacy = useStreetSwitch(layout);
  const scene = useDeviceSwitch("scene", legacy.on ? "city" : "plain");
  const lighting = useDeviceSwitch("lighting", "auto");
  const graphics = useDeviceSwitch("graphics", "auto");
  return {
    scene,
    lighting,
    graphics,
    unsaved: scene.unsaved || lighting.unsaved || graphics.unsaved,
  };
}
