// @vitest-environment jsdom
// The pantry's duties with the host's board (people/duty.js, PASEO). The scene's modules it moves people with are
// stood in with the little it reads: a walk arrives at once and a wait is over at once, so a duty runs to its end in
// one look. The plan and the words are the real ones.
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** What the board was last drawn with. */
  drawn: [] as { rows: { label?: string; name: string; at: string; busy: boolean }[] }[],
  workers: new Map<string, Record<string, unknown>>(),
  sessions: new Map<string, Record<string, unknown>>(),
  /** The scene's clock: Wednesday 18 November 2026, 15:00. */
  now: new Date(2026, 10, 18, 15, 0),
  chat: [] as string[],
}));

vi.mock("../../vendor/my-office/three/three.module.min.js", () => ({}));
vi.mock("../../vendor/my-office/src/office/core/env.js", () => ({
  PRO: true,
  officeNow: () => h.now,
  pad2: (n: number) => String(n).padStart(2, "0"),
  rand: (a: number) => a,
  reduceMotion: true,
  replay: { on: false },
}));
vi.mock("../../vendor/my-office/src/office/scene/blocks.js", () => ({ mat: () => ({}) }));
vi.mock("../../vendor/my-office/src/office/world/entrance.js", () => ({
  stairsVisit: (_w: unknown, _s: number, done: () => void) => done(),
}));
vi.mock("../../vendor/my-office/src/office/world/props/duty-board.js", () => ({
  SINK: { x: 12.55, z: -7.55 },
  BOARD_AT: { x: 11, z: -7.955 },
  drawBoard: (b: (typeof h.drawn)[number]) => h.drawn.push(b),
  setPile() {},
}));
vi.mock("../../vendor/my-office/src/office/people/navigation.js", () => ({
  spotAt: (x: number, y: number, face: number) => ({ x, y, face }),
  standBy: (x: number, y: number) => ({ x, y, face: 0 }),
}));
vi.mock("../../vendor/my-office/src/office/people/errands.js", () => ({
  free: () => true,
  later: (_s: number, run: () => void) => run(),
  plantSpot: () => null,
  plantsToWater: () => [],
  pour: () => undefined,
}));
vi.mock("../../vendor/my-office/src/office/people/workers.js", () => ({
  dn: (s: { name?: string }) => s.name ?? "",
  sessions: h.sessions,
  workers: h.workers,
}));
vi.mock("../../vendor/my-office/src/office/people/outings.js", () => ({
  called: () => false,
  resting: () => true,
  resume: () => undefined,
}));
vi.mock("../../vendor/my-office/src/office/people/staff.js", () => ({
  binHooks: {},
  staff: () => ({ bin: { spot: { x: 0, y: 0, face: 0 } } }),
}));
vi.mock("../../vendor/my-office/src/office/people/hr.js", () => ({
  projOf: (s: { dir?: string }) => s.dir,
}));
vi.mock("../../vendor/my-office/src/office/life/nap.js", () => ({ napOn: false }));
vi.mock("../../vendor/my-office/src/office/audio/sfx.js", () => ({ sfx: { play() {} } }));
vi.mock("../../vendor/my-office/src/office/ui/group-chat.js", () => ({
  chatLife: (kind: string) => h.chat.push(kind),
}));
vi.mock("../../vendor/my-office/src/office/ui/activity.js", () => ({ queueUi() {} }));

// @ts-expect-error vendored JavaScript has no declarations
const { state } = await import("../../vendor/my-office/src/office/core/state.js");
// @ts-expect-error vendored JavaScript has no declarations
const { host } = await import("../../vendor/my-office/src/office/paseo-host.js");
// @ts-expect-error vendored JavaScript has no declarations
const duty = await import("../../vendor/my-office/src/office/people/duty.js");
duty.setup();

/** Someone at their desk, resting: a walk arrives at once. */
function person(id: string): Record<string, unknown> {
  const w: Record<string, unknown> = {
    id,
    root: { parent: {} },
    pos: { x: 0, y: 0 },
    hush() {},
    say() {},
    goTo: (_spot: unknown, arrived: () => void) => arrived(),
    homeSpot: () => ({ x: 0, y: 0, face: 0 }),
  };
  return w;
}

function seat(id: string, name: string): Record<string, unknown> {
  const w = person(id);
  h.workers.set(id, w);
  h.sessions.set(id, { id, name, dir: "shop", status: "rest" });
  return w;
}

let look = 0;
/** One look of the rota: the scene looks every two seconds of its own time. */
function lookOnce(): void {
  look += 10;
  state.sim = look;
  duty.updateDuty();
}

const pretend = {
  id: "p1",
  name: "Restock the paper",
  chore: null,
  pretend: true,
  holder: null,
  state: "open",
  owed: false,
};

beforeEach(() => {
  h.drawn.length = 0;
  h.workers.clear();
  h.sessions.clear();
  h.chat.length = 0;
  host.duties = null;
  host.dutyDone = vi.fn();
  localStorage.clear();
});

test("a free figure acts out a pretend duty of the host's board, which is told it is done, once", () => {
  seat("a1", "Planner");
  host.duties = [pretend];
  lookOnce();
  expect(host.dutyDone).toHaveBeenCalledWith("p1", "a1");
  lookOnce();
  expect(host.dutyDone).toHaveBeenCalledTimes(1);
  expect(h.drawn.at(-1)?.rows).toEqual([
    { chore: null, label: "Restock the paper", name: "", at: "", busy: false, owed: false },
  ]);
});

test("an agent's duty is acted out by its holder's figure, and nothing is reported", () => {
  seat("a1", "Planner");
  const holder = seat("a2", "Builder");
  host.duties = [
    {
      ...pretend,
      id: "p2",
      pretend: false,
      holder: { id: "a2", name: "Builder" },
      state: "claimed",
    },
  ];
  let walked = false;
  holder.goTo = (_spot: unknown, arrived: () => void) => {
    walked = true;
    arrived();
  };
  lookOnce();
  expect(walked).toBe(true);
  expect(host.dutyDone).not.toHaveBeenCalled();
  expect(h.drawn.at(-1)?.rows[0]).toMatchObject({ label: "Restock the paper", name: "Builder" });
});

test("the tooltip names each duty and who has it; with no duty due it says so; no rota is kept", () => {
  seat("a1", "Planner");
  host.duties = [
    { ...pretend, state: "done" },
    {
      ...pretend,
      id: "p2",
      name: "Build",
      pretend: false,
      holder: { id: "a2", name: "Refactor the paymen…" },
      state: "claimed",
    },
  ];
  expect(duty.dutyText()).toBe("Restock the paper: — ✓ · Build: Refactor the paymen…");
  host.duties = [];
  expect(duty.dutyText()).toBe("No duty is due today");
  lookOnce();
  expect(h.chat).toEqual([]);
  const kept = JSON.parse(localStorage.getItem("office-duty") ?? "{}");
  expect(kept.who ?? {}).toEqual({});
});

test("without the host's board the scene keeps upstream's rota", () => {
  seat("a1", "Planner");
  lookOnce();
  const kept = JSON.parse(localStorage.getItem("office-duty") ?? "{}");
  expect(Object.keys(kept.who)).toEqual(["cups", "trash", "plants", "table"]);
});

test("HR posts the host's duties in the morning, once a day", () => {
  seat("a1", "Planner");
  host.duties = [{ ...pretend, chore: "plants", state: "done" }];
  const afternoon = h.now;
  h.now = new Date(2026, 10, 19, 9, 0);
  try {
    lookOnce();
    lookOnce();
  } finally {
    h.now = afternoon;
  }
  expect(h.chat).toEqual(["dutyRoster"]);
});
