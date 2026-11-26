/**
 * @vitest-environment jsdom
 */
// The images of a sent message in a session's chat, mounted: each is read from the host once and
// drawn as a picture; one the host no longer holds is said so in words.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SentImages } from "./sent-images.js";
import type { OfficeStyles } from "./styles.js";

const read = vi.hoisted(() =>
  vi.fn(async (_input: { url: string }) => ({ data: null as string | null })),
);
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => read }));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const STYLES = { transcript: new Proxy({}, { get: () => ({}) }) } as unknown as OfficeStyles;
const DATA = "data:image/png;base64,iVBORw0KGgo=";
const file = (name: string) => `file:///tmp/paseo-attachments-AbC123/${name.repeat(64)}.png`;

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  read.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mount(urls: string[]) {
  await act(async () => {
    root.render(createElement(SentImages, { urls, styles: STYLES }));
  });
}

test("each image is read from the host and drawn, and the same file twice is one picture", async () => {
  read.mockImplementation(async () => ({ data: DATA }));
  await mount([file("a"), file("b"), file("a")]);
  expect(read.mock.calls.map(([input]) => input)).toEqual([{ url: file("a") }, { url: file("b") }]);
  expect(host.querySelectorAll("img")).toHaveLength(2);
  expect(host.querySelector("[aria-label='Image 1 of 2, show larger']")).not.toBeNull();
  expect(host.textContent).toBe("");
});

test("a press shows the image larger, and the next one smaller again", async () => {
  read.mockImplementation(async () => ({ data: DATA }));
  await mount([file("c")]);
  const button = () => host.querySelector<HTMLElement>("[role='button']");
  expect(button()?.getAttribute("aria-label")).toBe("Image 1, show larger");
  await act(async () => button()?.click());
  expect(button()?.getAttribute("aria-label")).toBe("Image 1, show smaller");
});

test("an image the host no longer holds is named in words, and asked for again later", async () => {
  read.mockImplementation(async () => ({ data: null }));
  await mount([file("d")]);
  expect(host.querySelectorAll("img")).toHaveLength(0);
  expect(host.textContent).toBe("Image 1 is no longer on the host.");
  act(() => root.unmount());
  root = createRoot(host);
  read.mockImplementation(async () => ({ data: DATA }));
  await mount([file("d")]);
  expect(read).toHaveBeenCalledTimes(2);
  expect(host.querySelectorAll("img")).toHaveLength(1);
});

test("a read that fails is shown the same way as a missing image", async () => {
  read.mockImplementation(async () => {
    throw new Error("offline");
  });
  await mount([file("e")]);
  expect(host.textContent).toBe("Image 1 is no longer on the host.");
});
