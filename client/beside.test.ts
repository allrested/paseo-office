import { expect, test } from "vitest";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { resourcesOpener, showBesideOf, type BesideTarget } from "./beside.js";

type Navigation = NonNullable<PluginSurfaceProps["navigation"]>;

interface FakeNavigation {
  navigation: Navigation;
  shown: BesideTarget[];
  opened: string[];
}

/** The app's navigation; `answer` is what its side area says, null when the app has none. */
function fakeNavigation(answer: boolean | null): FakeNavigation {
  const shown: BesideTarget[] = [];
  const opened: string[] = [];
  const navigation: Navigation = {
    openAgent: ({ agentId }) => {
      opened.push(agentId);
    },
    openWorkspace: () => {},
    ...(answer === null
      ? {}
      : {
          showBeside: (target: BesideTarget) => {
            shown.push(target);
            return answer;
          },
        }),
  };
  return { navigation, shown, opened };
}

test("an app without a side area leaves the wall screen to the Host card", () => {
  let machineOpened = 0;
  const open = resourcesOpener(fakeNavigation(null).navigation, () => {
    machineOpened += 1;
  });
  expect(open).toBeUndefined();
  expect(resourcesOpener(undefined, () => {})).toBeUndefined();
  expect(machineOpened).toBe(0);
});

test("the wall screen shows Resources beside the floor", () => {
  const fake = fakeNavigation(true);
  let machineOpened = 0;
  const open = resourcesOpener(fake.navigation, () => {
    machineOpened += 1;
  });
  open?.();
  expect(fake.shown).toEqual([
    { kind: "screen", pluginId: "resource-manager", screenId: "resources" },
  ]);
  expect(machineOpened).toBe(0);
});

test("the wall screen opens the Host card when the side area cannot show Resources", () => {
  const fake = fakeNavigation(false);
  let machineOpened = 0;
  const open = resourcesOpener(fake.navigation, () => {
    machineOpened += 1;
  });
  open?.();
  expect(fake.shown).toHaveLength(1);
  expect(machineOpened).toBe(1);
  expect(fake.opened).toEqual([]);
});

test("showBesideOf gives the app's call, and null where it has none", () => {
  expect(showBesideOf(fakeNavigation(true).navigation)).toBeTypeOf("function");
  expect(showBesideOf(fakeNavigation(null).navigation)).toBeNull();
  expect(showBesideOf(undefined)).toBeNull();
  const odd = { ...fakeNavigation(null).navigation, showBeside: "no" } as unknown as Navigation;
  expect(showBesideOf(odd)).toBeNull();
});
