/**
 * @vitest-environment jsdom
 */
// The Office list, mounted. The sheet is the host's, so a plain stand-in shows what it was passed.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { OfficeCardsDialog, type OfficeCard } from "./office-cards.js";
import { useOfficeStyles } from "./styles.js";

vi.mock("@getpaseo/plugin/client/ui", () => {
  const Modal = (props: { title: string; open: boolean; children: ReactNode }) =>
    props.open ? createElement("section", { "aria-label": props.title }, props.children) : null;
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  return { Icon: () => null, Modal };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

function Harness({ cards, onClose }: { cards: readonly OfficeCard[]; onClose(): void }) {
  const styles = useOfficeStyles(THEME, false, false);
  return <OfficeCardsDialog cards={cards} open color="#fff" onClose={onClose} styles={styles} />;
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const order: string[] = [];
const closed = () => void order.push("close");
const CARDS: readonly OfficeCard[] = [
  {
    title: "Library",
    icon: "BookOpen",
    note: { text: "Teach a skill", tone: "muted" },
    onOpen: () => void order.push("library"),
  },
  {
    title: "QA",
    icon: "FlaskConical",
    note: { text: "2 checks failing", tone: "warning" },
    onOpen: () => void order.push("qa"),
  },
];

test("each card is listed by name with what it says, and a press closes the list, then opens it", async () => {
  await act(async () => root.render(<Harness cards={CARDS} onClose={closed} />));
  const list = container.querySelector('section[aria-label="Office"]');
  expect(list?.textContent).toContain("LibraryTeach a skill");
  expect(list?.textContent).toContain("QA2 checks failing");
  const qa = list?.querySelector('[aria-label="QA: 2 checks failing"]');
  await act(async () => (qa as HTMLElement).click());
  expect(order).toEqual(["close", "qa"]);
});
