// Paseo's lively floor as it moves the people (paseo-leisure.js); its decisions are in
// leisure.test.ts. The upstream modules it imports draw on a canvas or WebGL as they load, which a
// test has not: each is stood in with the little the floor reads, and a person is the fields
// upstream's restroom visit (people/workers.js visitWc and wcTick) sets on them.
import { beforeEach, expect, test, vi } from "vitest";
// @ts-expect-error vendored JavaScript has no declarations
import { state } from "../../vendor/my-office/src/office/core/state.js";
// @ts-expect-error vendored JavaScript has no declarations
import { leisureNow, updateLeisure } from "../../vendor/my-office/src/office/paseo-leisure.js";

const h = vi.hoisted(() => ({
  sessions: new Map<string, { id: string; status: string }>(),
  workers: new Map<string, Record<string, unknown>>(),
  stations: { coffee: [], dining: [], wc: [] } as Record<string, { by: unknown }[]>,
  /** The floor plan as core/env.js reads it: the company floor, or not. */
  env: { PRO: true },
  /** What the lively floor last told its plan is open now (paseo-leisure-plan.js step's `open`). */
  open: null as Record<string, boolean> | null,
  /** Upstream's midday nap is on (life/nap.js napOn). */
  nap: false,
  /** Whether the lively floor last told its plan to stay quiet. */
  quiet: null as boolean | null,
}));

vi.mock("../../vendor/my-office/src/office/core/env.js", () => ({
  get PRO() {
    return h.env.PRO;
  },
  nowMs: () => 0,
  // At 23:00 nobody starts an activity of their own.
  officeNow: () => new Date(2026, 10, 17, 23),
  rand: (from: number) => from,
  reduceMotion: false,
  replay: { on: false },
}));
vi.mock("../../vendor/my-office/src/office/world/props/aquarium.js", () => ({ AQ: null }));
vi.mock("../../vendor/my-office/src/office/world/props/arcade.js", () => ({ ARC: null }));
vi.mock("../../vendor/my-office/src/office/world/furniture/coffee.js", () => ({
  STEAM_AT: { x: 0, z: 0 },
}));
vi.mock("../../vendor/my-office/src/office/interact/props.js", () => ({
  brewCoffee() {},
  feedFish() {},
}));
vi.mock("../../vendor/my-office/src/office/people/navigation.js", () => ({
  STATIONS: h.stations,
  standBy() {},
  wayTo() {},
}));
vi.mock("../../vendor/my-office/src/office/people/breaks.js", () => ({ COFFEE_Q: [] }));
vi.mock("../../vendor/my-office/src/office/people/workers.js", () => ({
  sessions: h.sessions,
  workers: h.workers,
}));
vi.mock("../../vendor/my-office/src/office/people/errands.js", () => ({
  asleep: () => false,
  quip() {},
}));
vi.mock("../../vendor/my-office/src/office/people/gatherings.js", () => ({
  gatheringNow: () => null,
}));
vi.mock("../../vendor/my-office/src/office/people/billiards.js", () => ({
  bilState: () => ({}),
  billiards: () => false,
}));
vi.mock("../../vendor/my-office/src/office/people/foosball.js", () => ({
  foosState: () => null,
  foosball: () => false,
}));
vi.mock("../../vendor/my-office/src/office/people/gaming.js", () => ({
  tvMatch: () => false,
  tvState: () => ({}),
}));
vi.mock("../../vendor/my-office/src/office/people/karaoke.js", () => ({
  karaoke: () => false,
  ktvState: () => ({}),
}));
vi.mock("../../vendor/my-office/src/office/life/nap.js", () => ({
  get napOn() {
    return h.nap;
  },
}));
vi.mock("../../vendor/my-office/src/i18n/index.js", () => ({ t: (key: string) => key }));
// The real plan, with what it is told is open recorded.
vi.mock("../../vendor/my-office/src/office/paseo-leisure-plan.js", async (importOriginal) => {
  const real = await importOriginal<{
    createPlan(): { step(input: { open: Record<string, boolean>; quiet: boolean }): unknown };
  }>();
  return {
    ...real,
    createPlan: () => {
      const plan = real.createPlan();
      return {
        ...plan,
        step: (input: { open: Record<string, boolean>; quiet: boolean }) => {
          h.open = input.open;
          h.quiet = input.quiet;
          return plan.step(input);
        },
      };
    },
  };
});

interface Person {
  id: string;
  inStall: object | null;
  wcBusy: boolean;
  station: string;
  want: object | null;
  root: { visible: boolean };
  goHomeAndRest: ReturnType<typeof vi.fn>;
  visitWc(): boolean;
}

/** Someone at their desk, at rest; visitWc() takes them into a stall, door shut. */
function person(id: string): Person {
  const stall = { x: 1, z: 2, by: null as unknown };
  h.stations.wc = [stall];
  const someone = {
    id,
    inStall: null as object | null,
    wcBusy: false,
    station: "desk",
    spot: null as object | null,
    phase: "idle",
    pos: { x: 1, y: 2 },
    root: { visible: true, matrixWorldAutoUpdate: true },
    want: null,
    anim: "sleep",
    after: null,
    chore: null,
    onArrive: null,
    path: [],
    pose: "sit",
    leaving: false,
    hush() {},
    goHomeAndRest: vi.fn(),
    visitWc() {
      Object.assign(someone, { wcBusy: true, station: "wc", spot: stall, inStall: stall });
      Object.assign(someone.root, { visible: false, matrixWorldAutoUpdate: false });
      stall.by = someone;
      return true;
    },
  };
  h.workers.set(id, someone);
  h.sessions.set(id, { id, status: "rest" });
  return someone;
}

/** A prompt came in: the session works, and the person has the work to walk to. */
function prompt(someone: Person) {
  h.sessions.set(someone.id, { id: someone.id, status: "work" });
  someone.want = { station: "desk", anim: "type" };
}

beforeEach(() => {
  h.sessions.clear();
  h.workers.clear();
  h.env.PRO = true;
  h.stations.coffee = [];
  h.stations.dining = [];
  h.stations.wc = [];
  h.open = null;
  h.nap = false;
  h.quiet = null;
});

/** One look of the lively floor at what is open: its plan is asked at most once a second of the scene. */
function openNow(): Record<string, boolean> | null {
  state.sim = (state.sim ?? 0) + 2;
  updateLeisure();
  return h.open;
}

test("a prompt calls someone out of upstream's own restroom visit at once, to the work", () => {
  const someone = person("a");
  someone.visitWc(); // upstream's goHomeAndRest rolled a visit
  prompt(someone);

  updateLeisure();

  expect(someone.inStall).toBeNull();
  expect(someone.wcBusy).toBe(false);
  expect(someone.root.visible).toBe(true);
  // Straight to the work, as upstream's wcTick goes on when someone wants them.
  expect(someone.want).not.toBeNull();
  expect(someone.goHomeAndRest).not.toHaveBeenCalled();
});

test("a question for the user calls someone off the sink at once, to the desk", () => {
  const someone = person("a");
  someone.visitWc();
  Object.assign(someone, { inStall: null, station: "sink" }); // washing hands
  h.sessions.set("a", { id: "a", status: "wait" });

  updateLeisure();

  expect(someone.wcBusy).toBe(false);
  expect(someone.goHomeAndRest).toHaveBeenCalledOnce();
});

test("someone at rest finishes their restroom visit", () => {
  const someone = person("a");
  someone.visitWc();

  updateLeisure();

  expect(someone.inStall).not.toBeNull();
  expect(someone.wcBusy).toBe(true);
  expect(someone.goHomeAndRest).not.toHaveBeenCalled();
});

test("a prompt calls someone out of the lively floor's restroom visit straight to the work", () => {
  const someone = person("a");
  expect(leisureNow("a", "wc")).toEqual(["a"]);
  prompt(someone);

  updateLeisure();

  expect(someone.inStall).toBeNull();
  expect(someone.wcBusy).toBe(false);
  expect(someone.goHomeAndRest).not.toHaveBeenCalled();
});

test("on the cozy room nothing opens that needs the sofa, the games or the restroom", () => {
  // Two sofa seats and a stall: on the company floor each opens something.
  h.stations.coffee = [{ by: null }, { by: null }];
  h.stations.wc = [{ by: null }];
  person("a");
  expect(openNow()).toMatchObject({
    pool: true,
    foosball: true,
    tv: true,
    karaoke: true,
    nap: true,
    wc: true,
  });

  // Upstream's cozy room: no sofa or games (core/env.js PRO false), and its STATIONS have no
  // restroom (people/navigation.js).
  h.env.PRO = false;
  h.stations.wc = [];
  expect(openNow()).toMatchObject({
    pool: false,
    foosball: false,
    tv: false,
    karaoke: false,
    nap: false,
    cup: false,
    wc: false,
  });
});

test("the lively floor starts nothing during upstream's midday nap", () => {
  person("a");
  openNow();
  expect(h.quiet).toBe(false);

  h.nap = true;
  openNow();
  expect(h.quiet).toBe(true);
});
