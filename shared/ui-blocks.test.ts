import { expect, test } from "vitest";
import { splitUiBlocks } from "./ui-blocks.js";

test("a reply without a ui block is one piece of text, as it was written", () => {
  const text = "Done.\n\n```ts\nconst a = 1;\n```\n";
  expect(splitUiBlocks(text)).toEqual([{ kind: "text", text }]);
});

test("a ui block is taken out of the prose around it and named after its card", () => {
  const text = [
    "Three threads are open.",
    "",
    "```ui",
    'Card("Review threads", [',
    '  Table(["MR", "State"], [["payme !27", Badge("open")]])',
    "])",
    "```",
    "",
    "Ask if you want more.",
  ].join("\n");
  expect(splitUiBlocks(text)).toEqual([
    { kind: "text", text: "Three threads are open." },
    {
      kind: "block",
      language: "ui",
      title: "Review threads",
      complete: true,
      source:
        'Card("Review threads", [\n  Table(["MR", "State"], [["payme !27", Badge("open")]])\n])',
    },
    { kind: "text", text: "Ask if you want more." },
  ]);
});

test("a block with no card title, an app block and its page title", () => {
  const text = [
    "```ui",
    "$n = 2",
    'Metric("Total", $n)',
    "```",
    "~~~app",
    "<html><head><title>Dice &amp; odds</title></head></html>",
    "~~~",
    "```app",
    "<p>hi</p>",
    "```",
  ].join("\n");
  expect(splitUiBlocks(text)).toEqual([
    {
      kind: "block",
      language: "ui",
      title: null,
      complete: true,
      source: '$n = 2\nMetric("Total", $n)',
    },
    {
      kind: "block",
      language: "app",
      title: "Dice & odds",
      complete: true,
      source: "<html><head><title>Dice &amp; odds</title></head></html>",
    },
    {
      kind: "block",
      language: "app",
      title: null,
      complete: true,
      source: "<p>hi</p>",
    },
  ]);
});

test("a block still being written is a block already, not source", () => {
  expect(splitUiBlocks('Here:\n```ui\nCard("Plan", [\n  Steps([')).toEqual([
    { kind: "text", text: "Here:" },
    {
      kind: "block",
      language: "ui",
      title: "Plan",
      complete: false,
      source: 'Card("Plan", [\n  Steps([',
    },
  ]);
});

test("a ui fence shown inside another code block stays source", () => {
  const text = ["````markdown", "```ui", 'Card("Example", [])', "```", "````"].join("\n");
  expect(splitUiBlocks(text)).toEqual([{ kind: "text", text }]);
});

test("a title with an escaped quote, and one in single quotes", () => {
  expect(splitUiBlocks('```ui\nCard("Say \\"hi\\"", [])\n```')).toEqual([
    {
      kind: "block",
      language: "ui",
      title: 'Say "hi"',
      complete: true,
      source: 'Card("Say \\"hi\\"", [])',
    },
  ]);
  expect(splitUiBlocks("```ui\nCard('Costs', [])\n```")).toEqual([
    { kind: "block", language: "ui", title: "Costs", complete: true, source: "Card('Costs', [])" },
  ]);
});

test("a longer closing fence closes, a shorter one or another character does not", () => {
  expect(splitUiBlocks('````ui\nCard("A", [])\n```\n~~~~\n`````\nafter')).toEqual([
    {
      kind: "block",
      language: "ui",
      title: "A",
      complete: true,
      source: 'Card("A", [])\n```\n~~~~',
    },
    { kind: "text", text: "after" },
  ]);
});

test("a block keeps its body as written, an app's page and a ui's spec", () => {
  const [block] = splitUiBlocks("```app\n<title>Timer</title>\n<p>go</p>\n```");
  expect(block).toMatchObject({
    language: "app",
    source: "<title>Timer</title>\n<p>go</p>",
  });
  expect(splitUiBlocks('```ui\nCard("A", [])\n```')[0]).toMatchObject({
    source: 'Card("A", [])',
  });
});
