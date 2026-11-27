import type { ChatDraft } from "./office-link.js";
import type { SendOptions } from "./use-agent-actions.js";

/** The images attached to a reply: the chat's own, so the picker and its limits are shared. */
export type ReplyImages = ChatDraft["images"];

/** One array for every reply with nothing attached, so a draw sees no change. */
export const NO_REPLY_IMAGES: ReplyImages = [];

/** Whether the reply box has something to send: text, or images, and no image still being read. */
export function canSendReply(text: string, images: ReplyImages, reading: boolean): boolean {
  return !reading && (images.length > 0 || text.trim() !== "");
}

/**
 * What a reply sends. It joins the running turn, images included: the chat sends its images the
 * same way. Images alone say how many, as the chat's do.
 */
export function replySend(
  text: string,
  images: ReplyImages,
): { prompt: string; options: SendOptions } {
  const count = images.length;
  const label = count === 1 ? "1 image" : `${count} images`;
  return {
    prompt: text.trim() || (count ? label : ""),
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
