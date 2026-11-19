import { WORLD_SCRIPT } from "./world.generated.js";

import { STREET_KIT } from "./street-kit.generated.js";

export interface WorldScript {
  readStreet(): Promise<string>;
  /** The script of the page that draws the 3D office. */
  read(): Promise<string>;
}

/**
 * The scene's script as the plugin carries it: built from `vendor/my-office` by
 * `scripts/build-world.mjs` and embedded, so no host has to bundle it and the plugin need not
 * know its own folder.
 */
export function embeddedWorldScript(): WorldScript {
  return { read: async () => WORLD_SCRIPT, readStreet: async () => STREET_KIT };
}
