import { expect, test } from "vitest";
import {
  REPLY_FILE_BYTES,
  canSendReply,
  fileRefusal,
  filesAfterSend,
  imagesAfterSend,
  readTextFile,
  replySend,
  sizeLabel,
  type ReplyFile,
} from "./reply-send.js";

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

const file = (id: number, text = "line one\nline two", size = text.length): ReplyFile => ({
  id,
  name: `f${id}.log`,
  size,
  text,
});
const bytes = (...values: number[]) => new Uint8Array(values);

test("a text file's text goes into the prompt under a header naming it, after what was typed", () => {
  const { prompt, options } = replySend("Why does it fail?", [], [file(1)]);
  expect(prompt).toBe(
    "Why does it fail?\n\n--- Attached file: f1.log ---\nline one\nline two\n--- End of f1.log ---",
  );
  expect(options).toEqual({ activeTurnBehavior: "steer" });
});

test("files alone are a reply, and several keep their order", () => {
  const { prompt } = replySend("  ", [], [file(1, "a"), file(2, "b")]);
  expect(prompt).toBe(
    "--- Attached file: f1.log ---\na\n--- End of f1.log ---\n\n--- Attached file: f2.log ---\nb\n--- End of f2.log ---",
  );
});

test("images and files together keep the images' count line when nothing was typed", () => {
  expect(replySend("", [image(1)], [file(1, "a")]).prompt).toBe(
    "1 image\n\n--- Attached file: f1.log ---\na\n--- End of f1.log ---",
  );
});

test("a file name cannot break the header across lines", () => {
  const odd: ReplyFile = { id: 1, name: "a\nb.txt", size: 1, text: "x" };
  expect(replySend("", [], [odd]).prompt).toBe(
    "--- Attached file: a b.txt ---\nx\n--- End of a b.txt ---",
  );
});

test("a reply can be sent with files alone, and not while a file is being read", () => {
  expect(canSendReply("", [], false, [file(1)])).toBe(true);
  expect(canSendReply("", [], true, [file(1)])).toBe(false);
  expect(canSendReply("", [], false, [])).toBe(false);
});

test("a send removes the files it sent and keeps those attached while it was away", () => {
  const sent = [file(1), file(2)];
  const later = file(3);
  expect(filesAfterSend([...sent, later], sent)).toEqual([later]);
});

test("text is read as UTF-8, and a byte-order mark is dropped", () => {
  expect(readTextFile(new TextEncoder().encode("héllo\nwörld"))).toBe("héllo\nwörld");
  expect(readTextFile(bytes(0xef, 0xbb, 0xbf, 0x61))).toBe("a");
  expect(readTextFile(bytes())).toBe("");
});

test("binary content is refused: a NUL byte, or bytes that are not UTF-8", () => {
  expect(readTextFile(bytes(0x25, 0x50, 0x44, 0x46, 0x00, 0x01))).toBeNull();
  expect(readTextFile(bytes(0xff, 0xfe, 0x41, 0x00))).toBeNull();
  expect(readTextFile(bytes(0x61, 0xc3, 0x28))).toBeNull();
});

test("files are limited to four, and to 100 KB of text together", () => {
  expect(REPLY_FILE_BYTES).toBe(100 * 1024);
  expect(fileRefusal([], [{ size: 10 }])).toBeNull();
  expect(fileRefusal([file(1), file(2), file(3)], [{ size: 1 }, { size: 1 }])).toBe(
    "Choose up to four text files.",
  );
  expect(fileRefusal([file(1, "x", REPLY_FILE_BYTES - 5)], [{ size: 6 }])).toBe(
    "The attached files may add up to 100 KB of text.",
  );
  expect(fileRefusal([file(1, "x", REPLY_FILE_BYTES - 5)], [{ size: 5 }])).toBeNull();
});

test("a size reads in bytes, KB or MB", () => {
  expect(sizeLabel(512)).toBe("512 B");
  expect(sizeLabel(2048)).toBe("2 KB");
  expect(sizeLabel(1536)).toBe("1.5 KB");
  expect(sizeLabel(3 * 1024 * 1024)).toBe("3 MB");
});
