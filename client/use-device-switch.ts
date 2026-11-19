import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import { officeDeviceSettings } from "../shared/settings.js";

export interface DeviceSwitch {
  /** The switch as the person left it (a tap shows at once); null while the device's setting is read or unreadable. */
  on: boolean | null;
  /** The device refused to store the last tap: the switch holds it until the screen closes. */
  unsaved: boolean;
  set(next: boolean): void;
}

/** A save of the tap against a revision, and whether the store took it. */
interface Tried {
  value: boolean;
  revision: string;
  stored: boolean;
}

/**
 * A device switch. A tap shows at once and is saved into the `office-device` document
 * whole (its other fields are kept), one save at a time. A save that lost to another writer is
 * tried again on the revision a reload shows; a refusal that moved nothing is not, and the switch
 * then holds the tap until the next tap or the surface closes (`unsaved`).
 */
export function useDeviceSwitch(
  field: "street" | "sound" | "sessionsHidden",
  fallback: boolean,
): DeviceSwitch {
  const settings = useSettings(officeDeviceSettings);
  const stored = settings.status === "ready" ? settings : null;
  const [wanted, setWanted] = useState<boolean | null>(null);
  const [tried, setTried] = useState<Tried | null>(null);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { save, reload } = settings;
  useEffect(() => {
    if (wanted === null || stored === null || saving) return;
    if (stored.values[field] === wanted) {
      setWanted(null);
      setTried(null);
      return;
    }
    const { values, revision } = stored;
    // Waiting for the store to show a save it took, or given up on a refusal: not saved again.
    if (tried?.value === wanted && tried.revision === revision) return;
    setSaving(true);
    async function keep(value: boolean): Promise<void> {
      const ok = await save({ ...values, [field]: value }, revision);
      if (!ok) await reload().catch(() => undefined);
      if (!mounted.current) return;
      setTried({ value, revision, stored: ok });
      setSaving(false);
    }
    void keep(wanted);
  }, [wanted, stored, saving, tried, save, reload, field]);
  const set = useCallback((next: boolean) => {
    setTried(null);
    setWanted(next);
  }, []);
  const unsaved =
    wanted !== null &&
    tried !== null &&
    !tried.stored &&
    tried.value === wanted &&
    tried.revision === stored?.revision;
  // The floor waits for the street choice before starting. A finished, unreadable
  // document falls back to the layout default and can still be overridden for this visit.
  const streetUnreadable =
    field === "street" && (settings.status === "error" || settings.status === "invalid");
  const on = wanted ?? stored?.values[field] ?? (stored || streetUnreadable ? fallback : null);
  return { on, unsaved: unsaved || (wanted !== null && streetUnreadable), set };
}
