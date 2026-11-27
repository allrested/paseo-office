import type { Machine } from "../shared/contracts.js";
import { memoryPercent, memoryTone } from "../shared/machine-text.js";

export interface HostAlert {
  observe(machine: Machine): void;
}

/**
 * Says once when memory reaches the Host card's danger threshold. The episode lasts until memory
 * is back under the card's warning threshold, so a reading that wavers at the line is one message.
 */
export function createHostAlert(raised: (percent: number) => void): HostAlert {
  let inEpisode = false;
  return {
    observe(machine) {
      const percent = memoryPercent(machine);
      if (percent === null) return;
      const tone = memoryTone(percent);
      if (tone === "danger" && !inEpisode) {
        inEpisode = true;
        raised(percent);
      } else if (tone === "muted") {
        inEpisode = false;
      }
    },
  };
}
