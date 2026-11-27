import type { ChatDraft } from "./office-link.js";
import type { SendOptions } from "./use-agent-actions.js";

/** The images attached to a reply: the chat's own, so the picker and its limits are shared. */
export type ReplyImages = ChatDraft["images"];

/** One array for every reply with nothing attached, so a draw sees no change. */
export const NO_REPLY_IMAGES: ReplyImages = [];

/** A text file attached to a reply: its text is added to the prompt, as the host has no file call. */
export interface ReplyFile {
  id: number;
  name: string;
  /** Its size in bytes, as the limit counts it. */
  size: number;
  text: string;
}
export type ReplyFiles = readonly ReplyFile[];

/** One array for every reply with no file, so a draw sees no change. */
export const NO_REPLY_FILES: ReplyFiles = [];

export const REPLY_FILE_LIMIT = 4;
/** What the files add to the prompt together: the text goes in the message, so it is kept small. */
export const REPLY_FILE_BYTES = 100 * 1024;

/** The file's text, or null when it is not text: invalid UTF-8, or a NUL byte. */
export function readTextFile(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Why these files cannot join the ones attached, or null when they fit. */
export function fileRefusal(
  current: ReplyFiles,
  incoming: readonly { size: number }[],
): string | null {
  if (current.length + incoming.length > REPLY_FILE_LIMIT) return "Choose up to four text files.";
  const total = [...current, ...incoming].reduce((sum, { size }) => sum + size, 0);
  return total > REPLY_FILE_BYTES ? "The attached files may add up to 100 KB of text." : null;
}

/** A file's size as its chip shows it. */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const round = (n: number) => String(Math.round(n * 10) / 10);
  return bytes < 1024 * 1024 ? `${round(bytes / 1024)} KB` : `${round(bytes / (1024 * 1024))} MB`;
}

const fileBlock = ({ name, text }: ReplyFile) => {
  const shown = name.replace(/\s+/g, " ");
  return `--- Attached file: ${shown} ---\n${text}\n--- End of ${shown} ---`;
};

/** Whether the reply box has something to send: text, images or files, and none still being read. */
export function canSendReply(
  text: string,
  images: ReplyImages,
  reading: boolean,
  files: ReplyFiles = NO_REPLY_FILES,
): boolean {
  return !reading && (images.length > 0 || files.length > 0 || text.trim() !== "");
}

/**
 * What a reply sends. It joins the running turn, images included: the chat sends its images the
 * same way. Images alone say how many, as the chat's do. Each file's text follows the message
 * under a header naming it.
 */
export function replySend(
  text: string,
  images: ReplyImages,
  files: ReplyFiles = NO_REPLY_FILES,
): { prompt: string; options: SendOptions } {
  const count = images.length;
  const label = count === 1 ? "1 image" : `${count} images`;
  return {
    prompt: [text.trim() || (count ? label : ""), ...files.map(fileBlock)]
      .filter(Boolean)
      .join("\n\n"),
    options: {
      activeTurnBehavior: "steer",
      ...(count ? { images: images.map(({ data, mimeType }) => ({ data, mimeType })) } : {}),
    },
  };
}

/** The images after a send: those sent are gone, and any attached while it was away stay. */
export function imagesAfterSend(current: ReplyImages, sent: ReplyImages): ReplyImages {
  return current.filter((image) => !sent.includes(image));
}

/** The files after a send: those sent are gone, and any attached while it was away stay. */
export function filesAfterSend(current: ReplyFiles, sent: ReplyFiles): ReplyFiles {
  return current.filter((file) => !sent.includes(file));
}
