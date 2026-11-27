import { describe, expect, it } from "vitest";
import { failureReason, withPlaceholders, type GenuiNode } from "./genui-placeholders.js";

const node = (type: string, props: Record<string, unknown> = {}, key = type): GenuiNode => ({
  kind: "node",
  type,
  key,
  props: props as GenuiNode["props"],
});

const textOf = (placeholder: GenuiNode | undefined): unknown => placeholder?.props.text;

describe("withPlaceholders", () => {
  it("leaves a block that needs nothing from the workspace as it is", () => {
    const roots = [node("Card", { title: "Plan", children: [node("Metric", { label: "A" })] })];
    expect(withPlaceholders(roots)).toEqual(roots);
  });

  it("names a component that asks the daemon, in place, with its key", () => {
    const [placeholder] = withPlaceholders([node("Changes", {}, "k1")]);
    expect(placeholder).toMatchObject({
      kind: "node",
      type: "Callout",
      key: "k1",
      props: { text: "Changes: needs the Generative UI plugin's workspace chat" },
    });
  });

  it("reaches a component inside another component's props, and keeps its siblings", () => {
    const roots = [
      node("Card", {
        title: "T",
        children: [node("Commits"), node("Text", { text: "kept" }, "t")],
        tabs: [{ label: "A", nodes: [node("Map")] }],
      }),
    ];
    const [card] = withPlaceholders(roots);
    const props = card?.props as {
      children: GenuiNode[];
      tabs: { label: string; nodes: GenuiNode[] }[];
    };
    expect(props.children.map((child) => child.type)).toEqual(["Callout", "Text"]);
    expect(props.tabs[0]?.nodes[0]?.type).toBe("Callout");
    expect(props.tabs[0]?.label).toBe("A");
  });

  it("labels a Load that is still waiting for a file, by the component that reads it", () => {
    const [bare, named] = withPlaceholders([
      node("Loading", { path: "a.json", component: null }),
      node("Loading", { path: "a.json", component: "Tests" }),
    ]);
    expect(textOf(bare)).toBe("Load: needs the Generative UI plugin's workspace chat");
    expect(textOf(named)).toBe("Tests: needs the Generative UI plugin's workspace chat");
  });

  it("does not mutate what it was given", () => {
    const roots = [node("Card", { children: [node("PullRequest")] })];
    const before = JSON.stringify(roots);
    withPlaceholders(roots);
    expect(JSON.stringify(roots)).toBe(before);
  });
});

describe("failureReason", () => {
  it("is the first error with its place", () => {
    expect(
      failureReason([
        { line: 3, column: 7, severity: "warning", message: "unused" },
        { line: 4, column: 2, severity: "error", message: "unknown component Foo" },
      ]),
    ).toBe("Line 4: unknown component Foo");
  });

  it("is short, and says so when no message came", () => {
    expect(
      failureReason([{ line: 1, column: 1, severity: "error", message: "x".repeat(500) }]).length,
    ).toBeLessThanOrEqual(120);
    expect(failureReason([])).toBe("The block did not parse.");
  });
});
