/**
 * @vitest-environment jsdom
 */
// Telegram's settings, mounted: the token is typed, sent once and never shown again; the chat, the
// user ids, the switches and the landing choice save as host settings; the status line says where
// the bridge stands. The host's settings hook and the RPCs are stand-ins.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { TelegramState } from "../shared/contracts.js";
import { officeHostSettings } from "../shared/settings.js";
import type { HostValues } from "./host-switches.js";
import { useOfficeStyles } from "./styles.js";
import { TelegramSettings, type TelegramSetting } from "./telegram-settings.js";

let sent: { name: string; input: unknown }[];
let answers: Record<string, unknown>;
let refusal: Error | null;
let saved: Partial<HostValues>[];

vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (contract: { name: string }) => async (input: unknown) => {
    sent.push({ name: contract.name, input });
    if (refusal) throw refusal;
    return answers[contract.name];
  },
}));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { TextInput } = await import("react-native");
  return { TextInput, Icon: () => null };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const VALUES: HostValues = officeHostSettings.schema.parse({});
const SAVE = "office.telegram.save.request";
const TEST = "office.telegram.test.request";
const SECRET = "123456:ABC-secret-token-value";
const HINT_USERS =
  "Only these Telegram user ids are heard. A message that reaches an agent can make it run commands, so list yourself and people you trust.";
const OFF: TelegramState = { on: false, source: null, problem: null, dropped: 0 };
const READY: TelegramState = { on: true, source: "saved", problem: null, dropped: 0 };

async function change(_setting: TelegramSetting, patch: Partial<HostValues>): Promise<boolean> {
  saved.push(patch);
  return true;
}
const noProblem = () => null;

function Harness({
  telegram,
  values,
}: {
  telegram: TelegramState | undefined;
  values: HostValues;
}) {
  const styles = useOfficeStyles(THEME, false, false);
  return (
    <TelegramSettings
      values={values}
      telegram={telegram}
      change={change}
      saveProblem={noProblem}
      styles={styles}
    />
  );
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  sent = [];
  saved = [];
  refusal = null;
  answers = { [SAVE]: READY, [TEST]: { ok: true, bot: "office_bot" } };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = (telegram: TelegramState | undefined = READY, values: HostValues = VALUES) =>
  act(async () => root.render(<Harness telegram={telegram} values={values} />));

const button = (name: string) =>
  container.querySelector<HTMLElement>(`[role="button"][aria-label="${name}"]`);
const switchNamed = (name: string) =>
  container.querySelector<HTMLElement>(`[role="switch"][aria-label="${name}"]`);
const tokenField = () =>
  container.querySelector<HTMLInputElement>('input[aria-label="Telegram bot token"]');
const chat = () => container.querySelector<HTMLInputElement>('input[aria-label="Chat id"]');
const users = () =>
  container.querySelector<HTMLTextAreaElement>('textarea[aria-label="User ids that are heard"]');
const alerts = () =>
  [...container.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent);
const status = () => container.querySelector('[data-testid="telegram-status"]')?.textContent;
const sourceLine = () => container.querySelector('[data-testid="telegram-source"]')?.textContent;

async function type(field: HTMLTextAreaElement | HTMLInputElement | null, text: string) {
  if (!field) throw new Error("No field");
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  await act(async () => {
    field.focus();
    Object.getOwnPropertyDescriptor(prototype.prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function typeAndLeave(field: HTMLTextAreaElement | HTMLInputElement | null, text: string) {
  await type(field, text);
  await act(async () => field?.blur());
}

test("the token field is masked, empty, and nothing is claimed before the host has said", async () => {
  await mount();
  expect(tokenField()?.getAttribute("type")).toBe("password");
  expect(tokenField()?.value).toBe("");
  await act(async () => root.render(<Harness telegram={undefined} values={VALUES} />));
  expect(sourceLine()).toBeUndefined();
  expect(status()).toBeUndefined();
});

test("the line under the token says where it comes from, never the token", async () => {
  await mount({ ...OFF, source: "saved" });
  expect(sourceLine()).toBe("Saved");
  expect(tokenField()?.value).toBe("");
  await mount({ ...OFF, source: "env" });
  expect(sourceLine()).toBe("From the host's environment (TELEGRAM_BOT_TOKEN)");
  await mount(OFF);
  expect(sourceLine()).toBe("No token yet");
});

test("Save sends the typed token once, clears the field, and the token is not in the output", async () => {
  await mount(OFF);
  await type(tokenField(), SECRET);
  expect(tokenField()?.value).toBe(SECRET);
  await act(async () => button("Save Telegram token")?.click());
  expect(sent).toEqual([{ name: SAVE, input: { token: SECRET } }]);
  expect(tokenField()?.value).toBe("");
  expect(container.innerHTML).not.toContain(SECRET);
});

test("Save is off while no token is typed, so an empty field cannot remove the saved one", async () => {
  await mount(READY);
  expect(button("Save Telegram token")?.getAttribute("aria-disabled")).toBe("true");
  await act(async () => button("Save Telegram token")?.click());
  expect(sent).toEqual([]);
});

test("a failed save shows the failure, clears the field, and the failure holds no token", async () => {
  refusal = new Error("the host is busy");
  await mount(OFF);
  await type(tokenField(), SECRET);
  await act(async () => button("Save Telegram token")?.click());
  expect(alerts()).toEqual(["Unable to save: the host is busy"]);
  expect(tokenField()?.value).toBe("");
  expect(container.innerHTML).not.toContain(SECRET);
});

test("Remove is there only for a saved token, asks once, then sends an empty token", async () => {
  await mount({ ...OFF, source: "env" });
  expect(button("Remove saved Telegram token")).toBeNull();
  await mount(READY);
  await act(async () => button("Remove saved Telegram token")?.click());
  expect(sent).toEqual([]);
  expect(container.textContent).toContain("Remove the saved token?");
  await act(async () => button("Confirm remove the saved Telegram token")?.click());
  expect(sent).toEqual([{ name: SAVE, input: { token: "" } }]);
  expect(container.textContent).not.toContain("Remove the saved token?");
});

test("Keep it drops the question without sending anything", async () => {
  await mount(READY);
  await act(async () => button("Remove saved Telegram token")?.click());
  await act(async () => button("Keep the saved Telegram token")?.click());
  expect(sent).toEqual([]);
  expect(container.textContent).not.toContain("Remove the saved token?");
});

test("Test reports the bot it reached", async () => {
  await mount(READY, { ...VALUES, telegramChat: "-100123" });
  await act(async () => button("Test Telegram")?.click());
  expect(sent).toEqual([{ name: TEST, input: {} }]);
  expect(container.textContent).toContain(
    "Connected as @office_bot. A message was sent to the chat.",
  );
});

test("Test shows the problem it was told", async () => {
  answers[TEST] = { ok: false, problem: "Telegram refused the token" };
  await mount(READY, { ...VALUES, telegramChat: "-100123" });
  await act(async () => button("Test Telegram")?.click());
  expect(alerts()).toEqual(["Unable to test: Telegram refused the token"]);
  expect(container.textContent).not.toContain("Connected as");
});

test("Test is off without a token source or without a chat", async () => {
  await mount(OFF, { ...VALUES, telegramChat: "-100123" });
  expect(button("Test Telegram")?.getAttribute("aria-disabled")).toBe("true");
  await mount(READY, { ...VALUES, telegramChat: "" });
  expect(button("Test Telegram")?.getAttribute("aria-disabled")).toBe("true");
  await mount({ ...OFF, source: "env" }, { ...VALUES, telegramChat: "5" });
  expect(button("Test Telegram")?.getAttribute("aria-disabled")).not.toBe("true");
});

test("the chat id saves trimmed, and a refused one is told and not sent", async () => {
  await mount();
  expect(container.textContent).toContain(
    "The group or private chat the office writes to. A group's id starts with -.",
  );
  await typeAndLeave(chat(), " -100123 ");
  expect(saved).toEqual([{ telegramChat: "-100123" }]);
  await typeAndLeave(chat(), "12ab");
  expect(alerts()).toEqual(["A chat id is digits, with a minus first for a group"]);
  expect(saved).toHaveLength(1);
});

test("the user ids are one per line, with the hint exactly, and save as a list", async () => {
  await mount(READY, { ...VALUES, telegramUsers: ["42", "77"] });
  expect(users()?.value).toBe("42\n77");
  expect(container.textContent).toContain(HINT_USERS);
  await typeAndLeave(users(), " 42 \n\n99\r\n");
  expect(saved).toEqual([{ telegramUsers: ["42", "99"] }]);
  expect(alerts()).toEqual([]);
});

test("a user id the schema would refuse is told by its line and is not saved", async () => {
  await mount();
  await typeAndLeave(users(), "42\n0123");
  expect(alerts()).toEqual(['Line 2: "0123" is not a Telegram user id']);
  await typeAndLeave(users(), "42\n@alice");
  expect(alerts()).toEqual(['Line 2: "@alice" is not a Telegram user id']);
  await typeAndLeave(users(), Array.from({ length: 21 }, (_, index) => `${index + 1}`).join("\n"));
  expect(alerts()).toEqual(["At most 20 user ids"]);
  expect(saved).toEqual([]);
  await typeAndLeave(users(), "42");
  expect(alerts()).toEqual([]);
  expect(saved).toEqual([{ telegramUsers: ["42"] }]);
});

test("the five switches show their settings in order and each saves its own", async () => {
  await mount();
  const names = [
    "A task needs you",
    "A claim stalled",
    "A task is done",
    "Incidents",
    "Plan warnings",
  ];
  expect(names.map((name) => switchNamed(name)?.getAttribute("aria-checked"))).toEqual([
    "true",
    "false",
    "true",
    "true",
    "true",
  ]);
  const text = container.textContent ?? "";
  expect(text).toContain("What is sent");
  const places = names.map((name) => text.indexOf(name));
  expect(places).toEqual([...places].sort((a, b) => a - b));
  for (const name of names) await act(async () => switchNamed(name)?.click());
  expect(saved).toEqual([
    { telegramNeeds: false },
    { telegramStalled: true },
    { telegramDone: false },
    { telegramIncidents: false },
    { telegramPlan: false },
  ]);
});

test("Tasks from Telegram go to Backlog or To do, the stored one pressed, and a press saves it", async () => {
  await mount();
  expect(container.textContent).toContain("Tasks from Telegram go to");
  expect(button("Backlog")?.getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("To do")?.click());
  expect(saved).toEqual([{ telegramLands: "todo" }]);
});

test("the status line: off says what is needed, on says on", async () => {
  await mount(OFF);
  expect(status()).toBe("Off: needs a token, a chat and at least one user id.");
  await mount(READY);
  expect(status()).toBe("On.");
});

test("a problem shows as plain text in the warning style, in place of the off line", async () => {
  const problem = "<b>Telegram refused the token</b>";
  await mount({ ...OFF, problem });
  expect(status()).toBe(problem);
  expect(container.querySelector('[data-testid="telegram-status"] b')).toBeNull();
});

test("others' messages that were ignored are counted, and none is not mentioned", async () => {
  await mount({ ...READY, dropped: 3 });
  expect(status()).toBe("On.Messages from others ignored: 3");
  await mount({ ...READY, dropped: 0 });
  expect(status()).toBe("On.");
});

test("a failed Remove is shown, and the question stays to try again", async () => {
  refusal = new Error("the host is busy");
  await mount(READY);
  await act(async () => button("Remove saved Telegram token")?.click());
  await act(async () => button("Confirm remove the saved Telegram token")?.click());
  expect(alerts()).toEqual(["Unable to remove: the host is busy"]);
});

test("a Remove that went through closes the question", async () => {
  await mount(READY);
  await act(async () => button("Remove saved Telegram token")?.click());
  await act(async () => button("Confirm remove the saved Telegram token")?.click());
  expect(alerts()).toEqual([]);
  expect(container.textContent).not.toContain("Remove the saved token?");
});

test("the token field is not offered to a password manager", async () => {
  await mount();
  expect(tokenField()?.getAttribute("autocomplete")).toBe("new-password");
});

test("the Connected note goes when the token, its source or the chat changes", async () => {
  const withChat = { ...VALUES, telegramChat: "-100123" };
  const note = "Connected as @office_bot. A message was sent to the chat.";
  await mount(READY, withChat);
  await act(async () => button("Test Telegram")?.click());
  expect(container.textContent).toContain(note);
  await mount(READY, { ...withChat, telegramChat: "-100456" });
  expect(container.textContent).not.toContain(note);
  await act(async () => button("Test Telegram")?.click());
  expect(container.textContent).toContain(note);
  await mount({ ...READY, source: "env" }, { ...withChat, telegramChat: "-100456" });
  expect(container.textContent).not.toContain(note);
  await act(async () => button("Test Telegram")?.click());
  await type(tokenField(), "1");
  expect(container.textContent).not.toContain(note);
});

test("a refused user list keeps what was typed, a saved one lets go of it", async () => {
  await mount(READY, { ...VALUES, telegramUsers: ["42"] });
  await typeAndLeave(users(), "42\n0123");
  expect(users()?.value).toBe("42\n0123");
  expect(alerts()).toEqual(['Line 2: "0123" is not a Telegram user id']);
  await typeAndLeave(users(), "42\n99");
  expect(saved).toEqual([{ telegramUsers: ["42", "99"] }]);
  expect(users()?.value).toBe("42");
});
