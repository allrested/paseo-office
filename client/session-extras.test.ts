import { expect, test } from "vitest";
import { commandWord, matchingCommands, sessionOptions } from "./session-extras.js";

const COMMANDS = [
  { name: "compact", description: "Shrink the conversation" },
  { name: "model", description: "Choose the model" },
  { name: "clear", description: "Start again" },
  { name: "recompile", description: "Build again" },
];

test("a slash command is being typed while the text is one word after a leading slash", () => {
  expect(commandWord("/")).toBe("");
  expect(commandWord("/Mod")).toBe("mod");
  expect(commandWord("/model opus")).toBeNull();
  expect(commandWord("see /model")).toBeNull();
  expect(commandWord("/a/b")).toBeNull();
  expect(commandWord("")).toBeNull();
});

test("the list has the commands that start with the word first, then those that hold it", () => {
  expect(matchingCommands(COMMANDS, "/").map((each) => each.name)).toEqual([
    "compact",
    "model",
    "clear",
    "recompile",
  ]);
  expect(matchingCommands(COMMANDS, "/c").map((each) => each.name)).toEqual([
    "compact",
    "clear",
    "recompile",
  ]);
  expect(matchingCommands(COMMANDS, "/comp").map((each) => each.name)).toEqual([
    "compact",
    "recompile",
  ]);
  expect(matchingCommands(COMMANDS, "/model x")).toEqual([]);
  expect(matchingCommands(COMMANDS, "hello")).toEqual([]);
});

test("an option is its control with the agent's value, or the control's default", () => {
  const controls = [
    {
      type: "select",
      key: "model",
      label: "Model",
      description: "What answers",
      defaultValue: "fast",
      choices: [
        { value: "fast", label: "Fast" },
        { value: "deep", label: "Deep" },
        { value: 3, label: "Broken" },
      ],
    },
    { type: "toggle", key: "web", label: "Web search", defaultValue: true },
    { type: "toggle", key: "plan", label: "Plan first" },
    { type: "slider", key: "heat", label: "Heat" },
    { type: "select", key: "empty", label: "Empty", choices: [] },
  ];
  expect(sessionOptions(controls, { model: "deep", plan: true })).toEqual([
    {
      type: "select",
      key: "model",
      label: "Model",
      hint: "What answers",
      value: "deep",
      choices: [
        { value: "fast", label: "Fast" },
        { value: "deep", label: "Deep" },
      ],
    },
    { type: "toggle", key: "web", label: "Web search", hint: null, value: true },
    { type: "toggle", key: "plan", label: "Plan first", hint: null, value: true },
  ]);
  expect(sessionOptions(controls, null)[0]).toMatchObject({ value: "fast" });
  expect(sessionOptions(undefined, {})).toEqual([]);
});
