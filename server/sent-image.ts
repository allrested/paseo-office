import { open, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The largest image the session's chat loads; a larger one stays in the workspace chat. */
export const SENT_IMAGE_BYTES = 8 * 1024 * 1024;

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};
// What the daemon writes for a sent image: a folder of its own under the temp folder, and the
// image's SHA-256 as the file's name.
const FOLDER = /^paseo-attachments-[A-Za-z0-9_-]+$/;
const NAME = /^[0-9a-f]{64}\.(png|jpe?g|gif|webp)$/;

/**
 * The daemon's copy of an image sent with a message, as a data URL. Only such a copy is read: any
 * other path, a link out of the folder, or a file over the limit gives null.
 */
export async function readSentImage(url: string, temp = tmpdir()): Promise<string | null> {
  try {
    if (!url.startsWith("file://")) return null;
    const file = fileURLToPath(url);
    const folder = path.dirname(file);
    const name = path.basename(file);
    if (!NAME.test(name) || !FOLDER.test(path.basename(folder))) return null;
    const root = await realpath(temp);
    const real = await realpath(file);
    if (real !== path.join(root, path.basename(folder), name)) return null;
    const handle = await open(real, "r");
    try {
      const { size } = await handle.stat();
      if (size === 0 || size > SENT_IMAGE_BYTES) return null;
      const bytes = await handle.readFile();
      const type = TYPES[name.slice(name.lastIndexOf(".") + 1)];
      return `data:${type};base64,${bytes.toString("base64")}`;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}
