/**
 * @vitest-environment jsdom
 */
// A reply's `ui` block, drawn by the vendored Generative UI renderer: the real renderer, with the
// plugin SDK's few components as plain stand-ins. The specs are the plugin's own gallery examples
// (vendor/genui is bundled from https://github.com/anh-chu/paseo-plugin-genui).
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { loadGenuiKit } from "./genui-kit.js";
import { GenuiSessionContext } from "./genui-card.js";
import { SessionTranscript } from "./session-transcript.js";
import { useOfficeStyles } from "./styles.js";

vi.mock("@getpaseo/plugin/client", () => ({ openExternalUrl: vi.fn(async () => undefined) }));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const Plain = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
  const { TextInput } = await import("react-native");
  return {
    Icon: () => null,
    Markdown: ({ children }: { children: string }) =>
      createElement("div", { "data-markdown": "" }, children),
    ExternalLink: Plain,
    Modal: Object.assign(Plain, { Content: Plain }),
    ScrollView: Plain,
    TextInput,
    copyText: vi.fn(async () => undefined),
    useToast: () => ({ show: vi.fn(), error: vi.fn() }),
  };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

const BUTTONS = [
  'Card("The tests pass. What next?", [',
  '  Button("Open the PR", Send("Open a PR for this branch"), variant: "primary"),',
  '  Button("Run the e2e suite first", Send("Run the e2e suite first"))',
  "])",
].join("\n");
const METRICS = [
  'Card("Bundle size", [',
  '  Row([Metric("JavaScript", "184 KB", note: "gzipped", tone: "good"), Metric("CSS", "22 KB")])',
  "])",
].join("\n");
const PLAN = [
  "$seats = 12",
  "price = $seats * 3",
  'Card("Estimate", [',
  '  Stepper($seats, 1, 50, label: "Seats"),',
  '  Metric("Total", "$" + fmt(price))',
  "])",
].join("\n");

let container: HTMLElement;
let root: Root;
let send: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

function Transcript({ text }: { text: string }) {
  const styles = useOfficeStyles(THEME, true, false);
  return createElement(
    GenuiSessionContext.Provider,
    { value: { agentId: "a1", send } },
    createElement(SessionTranscript, {
      rows: [{ kind: "agent", key: "1", text }],
      steps: false,
      name: "Builder",
      uiCards: true,
      styles,
    }),
  );
}

const draw = (text: string) => act(async () => root.render(createElement(Transcript, { text })));
/** The renderer loads as a module of its own, so a block draws a moment after the reply. */
const settle = () => act(async () => new Promise((done) => setTimeout(done, 20)));
const text = () => container.textContent ?? "";

// The first load transforms the whole renderer, which takes seconds; a block then draws at once.
beforeAll(async () => {
  await loadGenuiKit();
}, 60_000);

beforeEach(() => {
  send = vi.fn(async () => undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("a complete ui block is drawn live: its card, not its source or the title card", async () => {
  await draw(`Here it is.\n\n\`\`\`ui\n${METRICS}\n\`\`\``);
  await settle();
  expect(text()).toContain("Bundle size");
  expect(text()).toContain("184 KB");
  expect(text()).toContain("gzipped");
  expect(text()).not.toContain("Drawn in the workspace chat.");
  expect(text()).not.toContain("Metric(");
});

test("a button that sends a reply sends it to the agent the session belongs to", async () => {
  await draw(`\`\`\`ui\n${BUTTONS}\n\`\`\``);
  await settle();
  const button = [...container.querySelectorAll<HTMLElement>('[role="button"]')].find(
    (element) => element.textContent === "Open the PR",
  );
  expect(button).toBeDefined();
  await act(async () => button?.click());
  expect(send).toHaveBeenCalledWith("Open a PR for this branch");
});

test("a card recomputes in place when an input changes, and asks no one", async () => {
  await draw(`\`\`\`ui\n${PLAN}\n\`\`\``);
  await settle();
  expect(text()).toContain("$36");
  const more = [...container.querySelectorAll<HTMLElement>('[role="button"]')].find(
    (element) => element.textContent === "+",
  );
  expect(more).toBeDefined();
  await act(async () => more?.click());
  expect(text()).toContain("$39");
  expect(send).not.toHaveBeenCalled();
});

test("a component that needs the Generative UI plugin's workspace chat is a labelled note", async () => {
  await draw(`\`\`\`ui\nCard("Work", [Changes(), Text("kept")])\n\`\`\``);
  await settle();
  expect(text()).toContain("Changes: needs the Generative UI plugin's workspace chat");
  expect(text()).toContain("kept");
});

test("a block that does not parse keeps its title card, with a short reason", async () => {
  await draw('```ui\nCard("Broken", [Metric("A"\n```');
  await settle();
  expect(text()).toContain("Broken");
  expect(text()).toContain("Could not draw this card here.");
  expect(text()).toMatch(/Line 1:/);
});

test("a block still being written stays the title card", async () => {
  await draw('```ui\nCard("Plan", [\n  Steps([');
  await settle();
  expect(text()).toContain("Being written...");
});

test("markup in a spec is text, never elements", async () => {
  await draw('```ui\nCard("T", [Text("<img src=x onerror=alert(1)><script>x</script>")])\n```');
  await settle();
  expect(container.querySelector("img, script")).toBeNull();
  expect(text()).toContain("<script>x</script>");
});
