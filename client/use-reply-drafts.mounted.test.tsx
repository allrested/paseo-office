/**
 * @vitest-environment jsdom
 */
// The reply drafts, through a hook host: what is attached to a reply follows the typed text.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useReplyDrafts, type ReplyDrafts } from "./use-reply-drafts.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const image = (id: number) => ({
  id,
  name: `p${id}.jpg`,
  mimeType: "image/jpeg" as const,
  data: "/9j/AA==",
});

let container: HTMLElement;
let root: Root;
let drafts: ReplyDrafts;

function Host({ open }: { open: string[] }) {
  drafts = useReplyDrafts(open);
  return null;
}
const show = (open: string[]) => act(async () => root.render(createElement(Host, { open })));

beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

test("images are kept by agent, as the typed text is", async () => {
  await show(["a1", "a2"]);
  await act(async () => drafts.setImages("a1", [image(1)]));
  expect(drafts.images.get("a1")).toEqual([image(1)]);
  expect(drafts.images.get("a2")).toBeUndefined();
  await act(async () => drafts.setImages("a1", (current) => [...current, image(2)]));
  expect(drafts.images.get("a1")).toEqual([image(1), image(2)]);
});

test("emptied images leave no entry", async () => {
  await show(["a1"]);
  await act(async () => drafts.setImages("a1", [image(1)]));
  await act(async () => drafts.setImages("a1", []));
  expect(drafts.images.has("a1")).toBe(false);
});

test("a session that is no longer open loses its images with its text", async () => {
  await show(["a1", "a2"]);
  await act(async () => {
    drafts.setText("a1", "half");
    drafts.setImages("a1", [image(1)]);
    drafts.setImages("a2", [image(2)]);
  });
  await show(["a2"]);
  expect(drafts.texts.has("a1")).toBe(false);
  expect(drafts.images.has("a1")).toBe(false);
  expect(drafts.images.get("a2")).toEqual([image(2)]);
});

test("text files are kept by agent, leave no entry when emptied, and go with a closed session", async () => {
  const file = (id: number) => ({ id, name: `f${id}.log`, size: 1, text: "x" });
  await show(["a1", "a2"]);
  await act(async () => {
    drafts.setFiles("a1", [file(1)]);
    drafts.setFiles("a2", [file(2)]);
  });
  expect(drafts.files.get("a1")).toEqual([file(1)]);
  await act(async () => drafts.setFiles("a2", []));
  expect(drafts.files.has("a2")).toBe(false);
  await show(["a2"]);
  expect(drafts.files.has("a1")).toBe(false);
});
