import { expect, test, vi } from "vitest";
import { createLogoReader } from "./brand-logo.js";

test("the offline scene receives the original image even without CORS headers", async () => {
  const read = vi.fn(
    async () =>
      new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
  );
  const load = createLogoReader(read);
  expect(
    await Promise.all([load("https://example.org/logo"), load("https://example.org/logo")]),
  ).toEqual(["data:image/png;base64,AQID", "data:image/png;base64,AQID"]);
  expect(read).toHaveBeenCalledTimes(1);
});

test("non-image and oversized answers fall back to the office mark", async () => {
  const load = createLogoReader(async (url) =>
    String(url).endsWith("html")
      ? new Response("<html>")
      : new Response(new Uint8Array(1024 * 1024 + 1), { headers: { "content-type": "image/png" } }),
  );
  expect(await load("https://example.org/html")).toBeNull();
  expect(await load("https://example.org/large")).toBeNull();
});
