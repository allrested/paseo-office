/**
 * @vitest-environment jsdom
 */
// The Reviews card, mounted: stacks drawn together and labelled, the tour with its fold, and
// Explain beside the request for a review. The sheet and the link are the host's.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type {
  OfficeAgent,
  OfficeWorkspace,
  Post,
  WorkspacePullRequest,
} from "../shared/contracts.js";
import { buildOfficeModel } from "../shared/model.js";
import { ReviewCard } from "./review-card.js";
import { reviewRows, tourAsk, type ReviewRow } from "./review-text.js";
import { useOfficeStyles } from "./styles.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const Modal = (props: { title: string; open: boolean; children: ReactNode }) =>
    props.open ? createElement("section", { "aria-label": props.title }, props.children) : null;
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  const ExternalLink = (props: { href: string; children: ReactNode }) =>
    createElement("a", { href: props.href }, props.children);
  return { ExternalLink, Modal };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

function agent(id: string, workspaceId: string): OfficeAgent {
  return {
    id,
    title: id,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId,
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-16T00:00:01Z",
  };
}

function pull(n: number, base: string, head: string): WorkspacePullRequest {
  return {
    number: n,
    url: `https://forge.example/pull/${n}`,
    title: `Change ${n}`,
    base,
    head,
    state: "open",
    checks: "none",
    runs: [],
    review: null,
    conflicts: false,
  };
}

function rowsOf(
  workspaces: [string, WorkspacePullRequest][],
  boards: Record<string, Post[]> = {},
  agents: OfficeAgent[] = [],
): ReviewRow[] {
  const spaces: OfficeWorkspace[] = workspaces.map(([id, pullRequest]) => ({
    id,
    name: id,
    projectName: "shop",
    pullRequest,
  }));
  return reviewRows(
    buildOfficeModel({
      agents,
      workspaces: spaces,
      activity: {},
      boards,
      wake: { paused: false, queued: {} },
    }),
  );
}

const nothing = async () => undefined;
const ignore = () => undefined;

function Harness({
  rows,
  explain = nothing,
}: {
  rows: ReviewRow[];
  explain?: (row: ReviewRow) => Promise<void>;
}) {
  const styles = useOfficeStyles(THEME, false, false);
  return (
    <ReviewCard
      rows={rows}
      open
      ask={nothing}
      explain={explain}
      wakesPaused={false}
      onOpenWorkspace={undefined}
      onOpenBoard={ignore}
      styles={styles}
      onClose={ignore}
    />
  );
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

const button = (label: string) =>
  [...container.querySelectorAll('[role="button"]')].find((node) =>
    node.textContent?.startsWith(label),
  ) as HTMLElement | undefined;

function note(seq: number, patch: Partial<Post>): Post {
  return {
    id: `p${seq}`,
    seq,
    board: "w1",
    kind: "note",
    text: "hello",
    author: "user",
    createdAt: "2026-11-16T08:00:00.000Z",
    updatedAt: "2026-11-16T08:00:00.000Z",
    ...patch,
  };
}

test("a stack is kept together, bottom first, and each row says its place", async () => {
  const rows = rowsOf([
    ["top", pull(3, "mid", "top")],
    ["alone", pull(9, "main", "alone")],
    ["mid", pull(2, "main", "mid")],
  ]);
  await act(async () => root.render(<Harness rows={rows} />));
  const text = container.textContent ?? "";
  expect(text).toContain("Stack: 1 of 2");
  expect(text).toContain("Stack: 2 of 2");
  expect(text.split("Stack:").length).toBe(3);
  // (the stack stands where its bottom stood in the queue: after the pull request listed before it)
  expect(text.indexOf("#9 Change 9")).toBeLessThan(text.indexOf("#2 Change 2"));
  expect(text.indexOf("#2 Change 2")).toBeLessThan(text.indexOf("#3 Change 3"));
});

test("Explain asks, and is off with who was asked until the tour is in", async () => {
  const explain = vi.fn(async () => undefined);
  const rows = rowsOf([["w1", pull(1, "main", "a")]], {}, [agent("b", "w1")]);
  await act(async () => root.render(<Harness rows={rows} explain={explain} />));
  await act(async () => button("Explain")?.click());
  expect(explain).toHaveBeenCalledTimes(1);

  const asked = rowsOf(
    [["w1", pull(1, "main", "a")]],
    { w1: [note(1, { text: tourAsk(pull(1, "main", "a")), to: "b" })] },
    [agent("b", "w1")],
  );
  await act(async () => root.render(<Harness rows={asked} explain={explain} />));
  const off = button("Asked b");
  expect(off?.getAttribute("aria-disabled")).toBe("true");
  expect(button("Ask for a review")).toBeDefined();
});

test("a tour shows under the row, 30 lines of it, and the rest behind a toggle", async () => {
  const lines = Array.from({ length: 33 }, (_, index) => `file-${index + 1}.ts`).join("\n");
  const request = pull(1, "main", "a");
  const rows = rowsOf(
    [["w1", request]],
    { w1: [note(1, { text: tourAsk(request), to: "b" }), note(2, { author: "b", text: lines })] },
    [agent("b", "w1")],
  );
  await act(async () => root.render(<Harness rows={rows} />));
  expect(container.textContent).toContain("Tour");
  expect(container.textContent).toContain("file-30.ts");
  expect(container.textContent).not.toContain("file-31.ts");
  await act(async () => button("3 more lines")?.click());
  expect(container.textContent).toContain("file-33.ts");
  expect(button("Fewer lines")).toBeDefined();
});
