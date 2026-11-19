import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { streetRpc } from "../../shared/contracts.js";
import { createWorldLoader } from "./world-loader.js";
const loader = createWorldLoader();
type StreetKit = { status: "off" | "loading" | "failed" } | { status: "ready"; kit: string };
export function useStreetKit(on: boolean | null): StreetKit {
  const load = useRpc(streetRpc);
  const fetchKit = useRef(load);
  useEffect(() => {
    fetchKit.current = load;
  }, [load]);
  const state = useSyncExternalStore(loader.subscribe, loader.state, loader.state);
  useEffect(() => {
    if (on === true) void loader.load(() => fetchKit.current({}));
  }, [on]);
  if (!on) return { status: "off" };
  if (state.status === "ready") return { status: "ready", kit: state.script };
  return { status: state.status === "failed" ? "failed" : "loading" };
}

export function useStreetStart(on: boolean | null) {
  const kit = useStreetKit(on);
  const text = kit.status === "ready" ? kit.kit : null;
  const enabled = kit.status === "ready" || kit.status === "failed";
  const street = useMemo(() => (enabled ? { kit: text } : null), [enabled, text]);
  return { street, loading: on === null || kit.status === "loading" };
}
