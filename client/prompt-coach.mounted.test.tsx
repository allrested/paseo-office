/** @vitest-environment jsdom */
import { act, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PromptCoach } from "./prompt-coach.js";
import { useOfficeStyles } from "./styles.js";
import type { ChatDraft } from "./office-link.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const theme = { colors: new Proxy({}, { get: () => "#888888" }) } as unknown as PluginTheme;
const image = { id: 1, name: "screen.png", data: "eA==", mimeType: "image/jpeg" as const };
let root: Root;
let container: HTMLDivElement;
let setDraft: ChatDraft["setText"];
function Harness({ recipient, photo }: { recipient: string | null; photo: boolean }) {
  const styles = useOfficeStyles(theme, false, false);
  const [text, setText] = useState("");
  setDraft = setText;
  const draft = useMemo(
    () => ({ text, setText, recipient, images: photo ? [image] : [], replyTo: null }),
    [text, recipient, photo],
  );
  return (
    <>
      <output>{text}</output>
      <PromptCoach draft={draft} styles={styles} />
    </>
  );
}
const render = (recipient: string | null, photo = false) =>
  act(async () => root.render(<Harness recipient={recipient} photo={photo} />));
const type = (text: string) => act(async () => setDraft(text));
const pause = () => act(async () => vi.advanceTimersByTime(450));
const button = (label: string) => container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
const press = (label: string) =>
  act(async () => {
    const match = button(label);
    expect(match).toBeTruthy();
    match?.click();
  });
const value = () => container.querySelector("output")?.textContent;
beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

test("only a directed draft gets a hint after a pause, and edits can be undone until more text is entered", async () => {
  await render(null);
  await type("make it better");
  await pause();
  expect(button("Add criteria")).toBeNull();
  await render("a");
  expect(button("Add criteria")).toBeNull();
  await pause();
  await press("Add criteria");
  expect(value()).toBe("make it better\nDone when: ");
  await press("Undo suggestion");
  expect(value()).toBe("make it better");
  await type("");
  await type("make it better");
  await pause();
  await press("Add criteria");
  await type("make it better\nDone when: buttons have labels.");
  expect(button("Undo suggestion")).toBeNull();
});

test("dismissal lasts for one draft and short approvals go through without suggestions", async () => {
  await render("a");
  await type("khác đi");
  await pause();
  await press("Dismiss tip");
  await type("khác đi nhé");
  await pause();
  expect(button("Add criteria")).toBeNull();
  await type("");
  await type("lgtm");
  await pause();
  expect(button("Dismiss tip")).toBeNull();
  await type("khác đi");
  await pause();
  expect(button("Add criteria")).toBeTruthy();
});

test("uses the selected session’s attachment count and never changes the text until asked", async () => {
  await render("a", true);
  await type("this");
  await pause();
  expect(button("Describe the goal")).toBeTruthy();
  expect(value()).toBe("this");
  await type(
    "Fix the sidebar spacing in the attached screenshot so all four filters fit in one row.",
  );
  await pause();
  expect(button("Describe the goal")).toBeNull();
  expect(button("Dismiss tip")).toBeNull();
});

test("numbers separate tasks in order and restores the original wording on Undo", async () => {
  const prompt = "Update the mobile menu then commit the change and deploy the site";
  await render("a");
  await type(prompt);
  await pause();
  await press("Number the tasks");
  expect(value()).toBe("1. Update the mobile menu\n2. Commit the change\n3. Deploy the site");
  await press("Undo suggestion");
  expect(value()).toBe(prompt);
});
