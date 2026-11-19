import { expect, test } from "vitest";
import { workspaceOverlayUrl } from "./workspace-overlay-route.web.js";

const office = new URL(
  "https://paseo.example/h/old/plugin/office/surface/office?token=secret#chip",
);

test("the workspace and selected session open on the surface's host at the app's own origin", () => {
  const url = workspaceOverlayUrl(office, "server:two", "wks_a", "agent/1?");
  expect(url).toBe(
    "https://paseo.example/h/server%3Atwo/workspace/wks_a?open=agent%3Aagent%2F1%3F",
  );
  expect(workspaceOverlayUrl(office, "s", "wks_a", null)).toBe(
    "https://paseo.example/h/s/workspace/wks_a",
  );
  expect(workspaceOverlayUrl(office, "s", null, "agent/1")).toBe(
    "https://paseo.example/h/s/agent/agent%2F1",
  );
});

test("legacy workspace paths use the app's UTF-8 base64url format", () => {
  const path = "/src/café";
  const id = "b64_" + Buffer.from(path).toString("base64url");
  expect(workspaceOverlayUrl(office, "s", path, null)).toBe(
    "https://paseo.example/h/s/workspace/" + id,
  );
});

test("desktop, prefixed and hash-based app routes retain their origin and mount", () => {
  expect(workspaceOverlayUrl(new URL("paseo://app/h/old/plugin/office"), "s", "w", null)).toBe(
    "paseo://app/h/s/workspace/w",
  );
  expect(
    workspaceOverlayUrl(new URL("https://example.test/ui/h/s/plugin/office"), "s", "w", null),
  ).toBe("https://example.test/ui/h/s/workspace/w");
  expect(
    workspaceOverlayUrl(
      new URL("https://example.test/ui/index.html?key=private#/h/s/plugin/office"),
      "s",
      "w",
      "a",
    ),
  ).toBe("https://example.test/ui/index.html#/h/s/workspace/w?open=agent%3Aa");
  expect(
    new URL(
      workspaceOverlayUrl(
        new URL("https://example.test//other.site/h/s/plugin/office"),
        "//other.site",
        "w",
        null,
      )!,
    ).origin,
  ).toBe("https://example.test");
});

test("a missing destination or an unsupported app origin has no frame", () => {
  expect(workspaceOverlayUrl(office, "", "w", null)).toBeNull();
  expect(workspaceOverlayUrl(office, "s", null, null)).toBeNull();
  expect(workspaceOverlayUrl(office, "..", "w", null)).toBeNull();
  expect(workspaceOverlayUrl(new URL("file:///opt/paseo/index.html"), "s", "w", null)).toBeNull();
  expect(workspaceOverlayUrl(new URL("paseo://external/"), "s", "w", null)).toBeNull();
});
