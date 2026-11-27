import { expect, test } from "vitest";
import { APP_FRAME_SANDBOX, appPage } from "./app-page.js";

test("the frame may run script and nothing else", () => {
  expect(APP_FRAME_SANDBOX).toBe("allow-scripts");
});

test("a page starts with a policy that blocks the network, then the agent's page", () => {
  const page = appPage("<title>Timer</title><script>1</script>");
  expect(page.startsWith("<!doctype html>")).toBe(true);
  const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(page);
  expect(policy?.[1]).toContain("default-src 'none'");
  expect(policy?.[1]).toContain("base-uri 'none'");
  expect(policy?.[1]).toContain("form-action 'none'");
  expect(policy?.[1]).not.toMatch(/connect-src|https?:/);
  // Nothing of the agent's page comes before the policy.
  expect(page.indexOf("Content-Security-Policy")).toBeLessThan(page.indexOf("<title>Timer"));
  expect(page.endsWith("<title>Timer</title><script>1</script>")).toBe(true);
});
