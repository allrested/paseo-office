import { expect, test } from "vitest";
import { canSendReply, imagesAfterSend, replySend } from "./reply-send.js";

const image = (id: number) => ({
  id,
  name: `p${id}.jpg`,
  mimeType: "image/jpeg" as const,
  data: "/9j/AA==",
});

test("a reply with no images is the trimmed text, joining the running turn", () => {
  expect(replySend("  Add tests  ", [])).toEqual({
    prompt: "Add tests",
    options: { activeTurnBehavior: "steer" },
  });
});

test("images go with the reply as the chat sends them, and carry nothing of the draft's own", () => {
  const { prompt, options } = replySend("Look at this", [image(1), image(2)]);
  expect(prompt).toBe("Look at this");
  expect(options).toEqual({
    activeTurnBehavior: "steer",
    images: [
      { data: "/9j/AA==", mimeType: "image/jpeg" },
      { data: "/9j/AA==", mimeType: "image/jpeg" },
    ],
  });
});

test("images alone are a reply that says how many, as the chat's are", () => {
  expect(replySend("  ", [image(1)]).prompt).toBe("1 image");
  expect(replySend("", [image(1), image(2), image(3)]).prompt).toBe("3 images");
});

test("a reply can be sent with text or images, and not while an image is being read", () => {
  expect(canSendReply("", [], false)).toBe(false);
  expect(canSendReply("  ", [], false)).toBe(false);
  expect(canSendReply("hi", [], false)).toBe(true);
  expect(canSendReply("", [image(1)], false)).toBe(true);
  expect(canSendReply("hi", [image(1)], true)).toBe(false);
});

test("a send removes the images it sent and keeps those attached while it was away", () => {
  const sent = [image(1), image(2)];
  const later = image(3);
  expect(imagesAfterSend([...sent, later], sent)).toEqual([later]);
  expect(imagesAfterSend(sent, sent)).toEqual([]);
});
