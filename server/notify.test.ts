import { expect, test } from "vitest";
import { alertNotice, incidentNotice, testNotice, wanted } from "../shared/notify.js";
import { createNotifier } from "./notify.js";

const ADDRESS = "https://hooks.test/in/SECRET";

function setup(answer: () => Promise<Response> | Response, url = ADDRESS) {
  const calls: { url: string; init: RequestInit }[] = [];
  const logs: string[] = [];
  const notifier = createNotifier({
    url: () => url,
    fetchFn: (async (input: string, init: RequestInit) => {
      calls.push({ url: input, init });
      return answer();
    }) as unknown as typeof fetch,
    log: (line) => logs.push(line),
  });
  return { notifier, calls, logs };
}

test("a message is posted as JSON, without following a redirect", async () => {
  const { notifier, calls, logs } = setup(() => new Response("ok"));
  const notice = testNotice(5, "Acme Studio");
  expect(await notifier.send(notice)).toEqual({ ok: true });
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe(ADDRESS);
  expect(calls[0].init).toMatchObject({
    method: "POST",
    headers: { "content-type": "application/json" },
    redirect: "error",
  });
  expect(JSON.parse(calls[0].init.body as string)).toEqual(notice);
  expect(logs).toEqual([]);
});

test("a refusal and a failed request are said without the address", async () => {
  const refused = setup(() => new Response("no", { status: 403 }));
  expect(await refused.notifier.send(testNotice(0, "Office 3D"))).toEqual({
    ok: false,
    problem: "The webhook answered 403",
  });
  const down = setup(() => {
    throw Object.assign(new TypeError(`fetch failed: ${ADDRESS}`), {
      cause: { code: "ECONNREFUSED" },
    });
  });
  expect(await down.notifier.send(testNotice(0, "Office 3D"))).toEqual({
    ok: false,
    problem: "The webhook could not be reached: ECONNREFUSED",
  });
  const odd = setup(() => {
    throw new Error(`something about ${ADDRESS}`);
  });
  expect(await odd.notifier.send(testNotice(0, "Office 3D"))).toEqual({
    ok: false,
    problem: "The webhook could not be reached: the request failed",
  });
  for (const line of [...refused.logs, ...down.logs, ...odd.logs]) {
    expect(line).not.toContain("SECRET");
  }
  expect(down.logs).toEqual([
    "[office] notify (test): The webhook could not be reached: ECONNREFUSED",
  ]);
});

test("no address, or one that is not safe for a key, sends nothing", async () => {
  const none = setup(() => new Response("ok"), "  ");
  expect(await none.notifier.send(testNotice(0, "Office 3D"))).toMatchObject({ ok: false });
  const plain = setup(() => new Response("ok"), "http://hooks.test/in");
  expect(await plain.notifier.send(testNotice(0, "Office 3D"))).toMatchObject({ ok: false });
  const local = setup(() => new Response("ok"), "http://127.0.0.1:5678/webhook/office");
  expect(await local.notifier.send(testNotice(0, "Office 3D"))).toEqual({ ok: true });
  expect([none.calls.length, plain.calls.length, local.calls.length]).toEqual([0, 0, 1]);
});

test("an alert and an incident read as one line a chat can show, with what a receiver can sort by", () => {
  const alert = {
    id: "loop:a",
    kind: "loop" as const,
    at: 7,
    agentId: "a",
    title: "Checkout is stuck in a loop",
    detail: "Bash failed 3 times running",
  };
  expect(alertNotice(alert, "Checkout", "Acme Studio")).toEqual({
    source: "paseo-office",
    text: "Acme Studio: Checkout is stuck in a loop\nBash failed 3 times running",
    kind: "loop",
    severity: "danger",
    title: "Checkout is stuck in a loop",
    detail: "Bash failed 3 times running",
    agent: "Checkout",
    at: 7,
  });
  const warning = alertNotice({ ...alert, kind: "checks" }, null, "Office 3D");
  expect(warning).toMatchObject({ severity: "warning" });
  // Danger only, the default, leaves a warning out; a loop goes either way.
  expect(wanted(warning, "danger")).toBe(false);
  expect(wanted(warning, "warning")).toBe(true);
  expect(wanted(alertNotice(alert, "Checkout", "Office 3D"), "danger")).toBe(true);
  expect(
    incidentNotice(
      {
        id: "jira:SHOP-3",
        source: "jira",
        key: "SHOP-3",
        title: "Checkout fails",
        url: "https://example.atlassian.net/browse/SHOP-3",
        createdAt: 1,
        foundAt: 9,
      },
      "Office 3D",
    ),
  ).toEqual({
    source: "paseo-office",
    text: "Office 3D: Incident SHOP-3\nCheckout fails\nhttps://example.atlassian.net/browse/SHOP-3",
    kind: "incident",
    severity: "danger",
    title: "Incident SHOP-3",
    detail: "Checkout fails",
    url: "https://example.atlassian.net/browse/SHOP-3",
    at: 9,
  });
});
