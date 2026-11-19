import { useCallback } from "react";
import { useSubscription } from "@getpaseo/plugin/client";
import { streetSubscription, type StreetEvent } from "../../shared/contracts.js";
import type { WorldApi } from "./world-api.js";

const INPUT = {};
/** Subscribe only after the scene has started so releases can be delivered immediately. */
export function StreetEvents({ api }: { api: WorldApi }) {
  const receive = useCallback(
    (event: StreetEvent) => {
      if (event.type === "release") api.photoRelease?.(event.tag);
      else api.setClaudeVersion?.(event.reading);
    },
    [api],
  );
  useSubscription(streetSubscription, INPUT, receive);
  return null;
}
