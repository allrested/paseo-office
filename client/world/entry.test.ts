// @vitest-environment jsdom
// Paseo's entry to the 3D office (paseo-entry.js), driven through the API the plugin calls. The
// upstream modules it imports draw on a canvas or WebGL as they load, which a test has not: each
// is stood in with the little the entry reads. An upstream rule a test is about is copied into
// its stand-in, with where it comes from.
import { beforeEach, expect, test, vi } from "vitest";
// @ts-expect-error vendored JavaScript has no declarations
import { state } from "../../vendor/my-office/src/office/core/state.js";
import { WORLD_API_VERSION } from "./world-api.js";
import { openWorldFrame } from "./world-frame.web.js";

const h = vi.hoisted(() => ({
  sessions: new Map<string, Record<string, unknown>>(),
  workers: new Map<string, Record<string, unknown>>(),
  applauded: [] as string[],
  played: [] as string[],
  incidentsOpened: 0,
  /** How many times the meeting table's bell rang. */
  rung: 0,
  /** The camera bar's markup is in the page. */
  built: false,
  /** Whether it was when the first of the scene's modules started (ui/photo.js wires it then). */
  builtBeforeModules: null as boolean | null,
  closePlace: vi.fn(),
  sound: [] as boolean[],
  soundAsked: [] as boolean[],
  setTenure: vi.fn(),
  setLiftService: vi.fn(),
  tenureAsked: [] as unknown[],
  lines: [] as unknown[][],
  /** How many times the wall clock's own act ran (upstream's cycleTime). */
  clockCycled: 0,
  /** What the camera bar's autoCam() answers: whether the camera may glide now. */
  autoCam: false,
  /** Whom the camera glided to, in order. */
  panned: [] as string[],
}));

vi.mock("../../vendor/my-office/src/office/paseo-modules.js", () => ({
  MODULES: [
    [
      "probe",
      {
        setup() {
          h.builtBeforeModules ??= h.built;
        },
      },
    ],
  ],
}));
vi.mock("../../vendor/my-office/src/office/scene/renderer.js", () => ({
  renderer: { domElement: document.createElement("canvas"), dispose() {}, forceContextLoss() {} },
}));
vi.mock("../../vendor/my-office/src/office/scene/blocks.js", () => ({ canvasTex: () => null }));
vi.mock("../../vendor/my-office/src/office/core/loop.js", () => ({ focusTarget: null }));
vi.mock("../../vendor/my-office/src/office/net/live.js", () => ({
  teamTags: [],
  setupTeams() {},
  projOf: () => "",
  upsertSession: (s: { id: string }) => h.sessions.set(s.id, s),
  removeSession: (id: string) => h.sessions.delete(id),
}));
vi.mock("../../vendor/my-office/src/office/ui/whiteboard.js", () => ({ setup() {} }));
vi.mock("../../vendor/my-office/src/office/world/backdrops/index.js", () => ({
  setup() {},
  applyNight() {},
}));
vi.mock("../../vendor/my-office/src/office/ui/camera-bar.js", () => ({
  build() {
    h.built = true;
  },
  setup() {},
  autoCam: () => h.autoCam,
  panTo: (w: { id: string }) => h.panned.push(w.id),
}));
vi.mock("../../vendor/my-office/src/office/ui/event-text.js", () => ({
  ACT: { other: {} },
  bubbleText: () => "",
}));
vi.mock("../../vendor/my-office/src/office/ui/icons.js", () => ({
  TYPE_ICON: {},
  icon: () => null,
}));
vi.mock("../../vendor/my-office/src/office/ui/session-drawer.js", () => ({
  openSession() {},
  closeSession() {},
}));
vi.mock("../../vendor/my-office/src/office/interact/place-chips.js", () => ({ PLACES: {} }));
vi.mock("../../vendor/my-office/src/office/interact/props.js", () => ({ PROPS: new Map() }));
vi.mock("../../vendor/my-office/src/office/interact/place-cards.js", () => ({
  closePlace: h.closePlace,
}));
vi.mock("../../vendor/my-office/src/office/world/pro/pieces.js", () => ({
  OFFICE_MARK: "",
  PRO_FX: {},
}));
vi.mock("../../vendor/my-office/src/office/paseo-leisure.js", () => ({
  ringWithEveryone: (ring: () => unknown) => ring(),
  updateLeisure() {},
}));
vi.mock("../../vendor/my-office/src/office/people/workers.js", () => ({
  sessions: h.sessions,
  workers: h.workers,
  subs: new Map(),
  dropSub() {},
  spawnSub() {},
  subAct() {},
}));
vi.mock("../../vendor/my-office/src/office/people/director.js", () => ({ director: null }));
vi.mock("../../vendor/my-office/src/office/people/navigation.js", () => ({ STATIONS: {} }));
vi.mock("../../vendor/my-office/src/office/people/gatherings.js", async () => {
  // @ts-expect-error vendored JavaScript has no declarations
  const scene = await import("../../vendor/my-office/src/office/core/state.js");
  return {
    ringBell() {
      h.rung += 1;
    },
    // Upstream's applause cheers someone once per 600 s of scene time (people/gatherings.js applaud).
    applaud(sess: string) {
      const w = h.workers.get(sess) as { cheeredAt?: number } | undefined;
      if (!w || scene.state.sim - (w.cheeredAt ?? -1e9) < 600) return;
      w.cheeredAt = scene.state.sim;
      h.applauded.push(sess);
    },
  };
});
vi.mock("../../vendor/my-office/src/office/world/room-update.js", () => ({ launchRocket() {} }));
vi.mock("../../vendor/my-office/src/office/world/props/printer.js", () => ({ printPage() {} }));
vi.mock("../../vendor/my-office/src/office/world/props/dev-servers.js", () => ({
  lostObj: null,
  syncDevBoxes() {},
}));
vi.mock("../../vendor/my-office/src/office/world/props/shredder.js", () => ({
  shredAction: (_w: unknown, a: unknown) => a,
}));
vi.mock("../../vendor/my-office/src/office/life/tests.js", () => ({ clearRun() {}, onTest() {} }));
vi.mock("../../vendor/my-office/src/office/life/your-turn.js", () => ({ onTurnDone() {} }));
// The sounds need a page's audio: the test hears which one played.
vi.mock("../../vendor/my-office/src/office/people/farewell.js", () => ({
  setTenure: h.setTenure,
}));
vi.mock("../../vendor/my-office/src/office/life/lift-service.js", () => ({
  setLiftService: h.setLiftService,
}));
vi.mock("../../vendor/my-office/src/office/audio/sfx.js", () => ({
  sfx: { play: (name: string) => h.played.push(name), set: (on: boolean) => h.sound.push(on) },
  setup() {},
}));

// The entry sets the API on the window as it loads.
// @ts-expect-error vendored JavaScript has no declarations
await import("../../vendor/my-office/src/office/paseo-entry.js");
// @ts-expect-error vendored JavaScript has no declarations
const { updateIncident } = await import("../../vendor/my-office/src/office/life/incidents.js");
// @ts-expect-error vendored JavaScript has no declarations
const { host } = await import("../../vendor/my-office/src/office/paseo-host.js");
// @ts-expect-error vendored JavaScript has no declarations
const { sound } = await import("../../vendor/my-office/src/office/paseo-sound.js");

interface World {
  start(options?: object): void;
  setSessions(list: object[]): void;
  event(e: { sess: string; type: string }): void;
  setIncidents(list: object[]): void;
  setMachine(machine: object | null): void;
  meet(): void;
  gather(): void;
  setSound(on: boolean): void;
  setTenure(data: object | null): void;
  setLiftService(info: object | null): void;
}
const world = (globalThis as unknown as { PaseoOfficeWorld: World }).PaseoOfficeWorld;
// A page with Web Audio whose context runs: the entry's probe finds it ready, and the switch can be
// on. (Earlier tests press Escape on the document; the probe hears that keydown on the window, and a
// context left suspended would make it "blocked" and hold the switch off for every test after.)
Object.assign(window, {
  AudioContext: class {
    state = "suspended";
    resume() {
      this.state = "running";
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  },
});
world.start({
  brand: { name: "Acme" },
  onSound: (on: boolean) => h.soundAsked.push(on),
  onTenure: (op: unknown) => h.tenureAsked.push(op),
  onLife: (kind: string, vars: object) => h.lines.push([kind, vars]),
  onIncidents: () => {
    h.incidentsOpened += 1;
  },
});
const atStart = [...h.sound];

const session = (id: string) => ({
  id,
  name: id,
  title: id,
  dir: "team",
  git: { repo: "team" },
  status: "rest",
  agent: "claude",
  lastPrompt: "",
  stuck: false,
  subs: [],
});

/** An element of the page the entry built. */
function page(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`The page has no #${id}`);
  return found;
}

/** An open incident as Paseo sends it, newest first; `ring` where this device has not rung for it. */
function incident(key: string, title: string, ring: boolean) {
  return { id: `jira:${key}`, key, title, ring };
}

/** Someone at a desk: a session the scene knows and the person drawn for it. */
function seat(id: string) {
  world.setSessions([session(id)]);
  h.workers.set(id, { id, push() {} });
}

beforeEach(() => {
  h.sessions.clear();
  h.workers.clear();
  h.applauded.length = 0;
  h.played.length = 0;
  h.sound.length = 0;
  h.soundAsked.length = 0;
  h.incidentsOpened = 0;
  h.rung = 0;
  h.autoCam = false;
  h.panned.length = 0;
  state.sim = 0;
  state.incidentUntil = 0;
  world.setIncidents([]);
  page("stage-wrap").classList.remove("is-incident");
});

test("a deploy that succeeded is applauded, also right after a push or another deploy", () => {
  seat("a");
  state.sim = 100;
  world.event({ sess: "a", type: "push" });
  state.sim = 160;
  world.event({ sess: "a", type: "deploy" });
  state.sim = 220;
  world.event({ sess: "a", type: "deploy" });

  expect(h.applauded).toEqual(["a", "a", "a"]);
});

test("a push is applauded once in ten minutes, as upstream has it", () => {
  seat("a");
  state.sim = 100;
  world.event({ sess: "a", type: "push" });
  state.sim = 160;
  world.event({ sess: "a", type: "push" });

  expect(h.applauded).toEqual(["a"]);
});

test("a new list of sessions keeps the last event the scene saw of each person, and its time", () => {
  vi.useFakeTimers({ now: 1_700_000_000_000 });
  try {
    seat("a");
    world.event({ sess: "a", type: "stop" });
    world.setSessions([{ ...session("a"), doneAt: 1_699_999_000_000 }]);

    expect(h.sessions.get("a")).toMatchObject({
      lastAt: 1_700_000_000_000,
      last: { type: "stop" },
      doneAt: 1_699_999_000_000,
    });
  } finally {
    vi.useRealTimers();
  }
});

test("an agent stopped on an error keeps no time of its last event, so it stays in sight at night", () => {
  world.setSessions([{ ...session("a"), stuck: true }]);
  h.workers.set("a", { id: "a", push() {} });
  world.event({ sess: "a", type: "fail" });
  world.setSessions([{ ...session("a"), stuck: true }]);

  expect(h.sessions.get("a")).toMatchObject({ last: { type: "fail" } });
  expect(h.sessions.get("a")).not.toHaveProperty("lastAt");
});

test("an incident that rings starts the alarm once: 25 s of red, a fail bubble over each person at work, the siren", () => {
  world.setSessions([{ ...session("a"), status: "work" }, session("b")]);
  const pushed: Record<string, unknown[]> = { a: [], b: [] };
  h.workers.set("a", { id: "a", push: (act: unknown) => pushed.a?.push(act) });
  h.workers.set("b", { id: "b", push: (act: unknown) => pushed.b?.push(act) });
  state.sim = 100;
  // Two new at once ring once.
  world.setIncidents([
    incident("SHOP-13", "Payments time out", true),
    incident("SHOP-12", "Checkout fails on Safari", true),
  ]);

  expect(state.incidentUntil).toBe(125);
  expect(page("stage-wrap").classList.contains("is-incident")).toBe(true);
  expect(h.played).toEqual(["siren"]);
  expect(pushed).toEqual({ a: [{ type: "fail", text: "Incident!" }], b: [] });

  // The same incidents again, rung for already: nothing rings.
  world.setIncidents([
    incident("SHOP-13", "Payments time out", false),
    incident("SHOP-12", "Checkout fails on Safari", false),
  ]);
  expect(h.played).toEqual(["siren"]);
  expect(pushed.a).toHaveLength(1);
});

test("an incident rung for already shows on the banner and rings nothing", () => {
  state.sim = 100;
  world.setIncidents([incident("SHOP-12", "Checkout fails on Safari", false)]);

  expect(state.incidentUntil).toBe(0);
  expect(page("stage-wrap").classList.contains("is-incident")).toBe(false);
  expect(h.played).toEqual([]);
  expect(page("incident").hidden).toBe(false);
});

test("the red ends after 25 s and the banner stays while the incident is open", () => {
  state.sim = 100;
  world.setIncidents([incident("SHOP-12", "Checkout fails on Safari", true)]);
  state.sim = 124;
  updateIncident(state.sim);
  expect(page("stage-wrap").classList.contains("is-incident")).toBe(true);

  state.sim = 126;
  updateIncident(state.sim);
  expect(page("stage-wrap").classList.contains("is-incident")).toBe(false);
  expect(page("incident").hidden).toBe(false);
});

test("dismissing one incident leaves the red; dismissing every one ends it at once", () => {
  state.sim = 100;
  world.setIncidents([
    incident("SHOP-13", "Payments time out", true),
    incident("SHOP-12", "Checkout fails on Safari", true),
  ]);
  state.sim = 101;
  world.setIncidents([incident("SHOP-13", "Payments time out", false)]);
  updateIncident(state.sim);
  expect(page("stage-wrap").classList.contains("is-incident")).toBe(true);

  world.setIncidents([]);
  updateIncident(state.sim);
  expect(page("stage-wrap").classList.contains("is-incident")).toBe(false);
  expect(page("incident").hidden).toBe(true);
});

test("the banner names the newest incident and how many more; a click opens Paseo's Incidents card", () => {
  world.setIncidents([
    incident("SHOP-13", "Payments time out", false),
    incident("SHOP-12", "Checkout fails on Safari", false),
    incident("SHOP-11", "Search is slow", false),
  ]);
  expect(page("incident").hidden).toBe(false);
  expect(page("incident").textContent).toBe("Incident: SHOP-13 Payments time out · +2 more");

  page("incident").click();
  expect(h.incidentsOpened).toBe(1);

  world.setIncidents([incident("SHOP-13", "Payments time out", false)]);
  expect(page("incident").textContent).toBe("Incident: SHOP-13 Payments time out");

  world.setIncidents([]);
  expect(page("incident").hidden).toBe(true);
});

test("gather rings the bell for everyone without telling Paseo, and meet is not changed", () => {
  const bell = vi.fn();
  host.bell = bell;
  world.gather();
  expect(h.rung).toBe(1);
  expect(bell).not.toHaveBeenCalled();
  world.meet();
  expect(h.rung).toBe(2);
});

interface Prop {
  act(): void;
  /** The tooltip's line under the prop's name: interact/props.js's propHint gives it as it is for these props. */
  hint: string;
}

test("the camera bar is built before the scene's modules start", () => {
  // ui/photo.js, one of the modules, wires the bar's photo button as it starts.
  expect(h.builtBeforeModules).toBe(true);
});

test("the photo's mark carries the brand's name", () => {
  expect(host.brandName).toBe("Acme");
});

test("the host's photo switch is on unless the start said false", () => {
  // The entry started once, above, without the option.
  expect(host.photo).toBe(true);
});

test("Escape in photo mode leaves the place card under it alone", () => {
  page("plc").hidden = false;
  document.body.classList.add("is-photo");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(h.closePlace).not.toHaveBeenCalled();

  document.body.classList.remove("is-photo");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(h.closePlace).toHaveBeenCalledTimes(1);
  page("plc").hidden = true;
});

/**
 * A page of its own, started with `options`, and its props. The page has a reading of the host, as `openMac()` reaches
 * Paseo's `onMachine` only then. A click on a prop runs its `act` (upstream's `activateProp`); a test calls it directly,
 * without the scene's picking. The entry starts once a page.
 */
async function startPage(options: object): Promise<Map<string, Prop>> {
  vi.resetModules();
  // Upstream's racks and wall screen open the machine panel (interact/props.js, prop('racks') and prop('tv')). The
  // stand-in is registered again for each page: resetModules keeps a mock's first module, and with it the first
  // page's host.
  vi.doMock("../../vendor/my-office/src/office/interact/props.js", async () => {
    // @ts-expect-error vendored JavaScript has no declarations
    const { openMac } = await import("../../vendor/my-office/src/office/ui/mac-drawer.js");
    // @ts-expect-error vendored JavaScript has no declarations
    const { t } = await import("../../vendor/my-office/src/i18n/index.js");
    return {
      PROPS: new Map([
        ["racks", { id: "racks", hint: t("props.racks.hint"), act: () => openMac() }],
        ["tv", { id: "tv", hint: t("props.tv.hint"), act: () => openMac() }],
        [
          "clock",
          {
            id: "clock",
            hint: t("props.clock.hint"),
            act: () => {
              h.clockCycled += 1;
            },
          },
        ],
      ]),
    };
  });
  // (three.js, which core/env.js loads, warns when it loads twice in one window: a page of its own loads it again)
  delete (window as { __THREE__?: string }).__THREE__;
  // @ts-expect-error vendored JavaScript has no declarations
  await import("../../vendor/my-office/src/office/paseo-entry.js");
  const fresh = (globalThis as unknown as { PaseoOfficeWorld: World }).PaseoOfficeWorld;
  fresh.start(options);
  fresh.setMachine({ mem: null, cpu: { percent: 0 }, devServers: [] });
  // @ts-expect-error vendored JavaScript has no declarations
  const { PROPS } = await import("../../vendor/my-office/src/office/interact/props.js");
  return PROPS as Map<string, Prop>;
}

test("the wall screen asks Paseo for Resources, and the racks still open the Host card", async () => {
  const resources = vi.fn();
  const machine = vi.fn();
  const props = await startPage({ onResources: resources, onMachine: machine });

  props.get("tv")?.act();
  expect(resources).toHaveBeenCalledTimes(1);
  expect(machine).not.toHaveBeenCalled();

  props.get("racks")?.act();
  expect(machine).toHaveBeenCalledTimes(1);
  expect(resources).toHaveBeenCalledTimes(1);
});

test("without Resources the wall screen opens the Host card", async () => {
  const machine = vi.fn();
  const props = await startPage({ onMachine: machine });

  props.get("tv")?.act();
  expect(machine).toHaveBeenCalledTimes(1);
});

test("the wall screen's tooltip says what it opens", async () => {
  const withResources = await startPage({ onResources() {}, onMachine() {} });
  expect(withResources.get("tv")?.hint).toBe("Open Resources");

  const without = await startPage({ onMachine() {} });
  expect(without.get("tv")?.hint).toBe("Open the Host panel");
});

test("the frame's page lets the office go full screen", () => {
  const container = document.createElement("div");
  const frame = openWorldFrame({ container, script: "", title: "Office in 3D" });

  expect(container.querySelector("iframe")?.getAttribute("allow")).toBe("fullscreen; autoplay");
  frame.dispose();
});

/**
 * Opens a frame whose script is a world the frame accepts, and returns the frame's page and how
 * often a press in it gave the keyboard back to Paseo's page.
 */
async function openFrame() {
  const container = document.createElement("div");
  document.body.append(container);
  const script = `window.PaseoOfficeWorld = { version: ${WORLD_API_VERSION}, start() {}, stop() {}, setSessions() {}, event() {}, select() {}, setMachine() {} };`;
  const frame = openWorldFrame({ container, script, title: "Office in 3D" });
  await frame.api;
  const doc = container.querySelector("iframe")?.contentDocument;
  const view = doc?.defaultView;
  if (!doc || !view) throw new Error("The frame has no page");
  // (jsdom's window.focus only reports that it has none)
  const focused = vi.spyOn(window, "focus").mockImplementation(() => {});
  const press = (target: Element = doc.body) =>
    target.dispatchEvent(new view.Event("pointerup", { bubbles: true }));
  return {
    doc,
    press,
    focused,
    close() {
      focused.mockRestore();
      frame.dispose();
      container.remove();
    },
  };
}

test("a press on the floor gives the keyboard back to Paseo's page", async () => {
  const frame = await openFrame();
  frame.press();
  expect(frame.focused).toHaveBeenCalledTimes(1);
  frame.close();
});

test("while walking, a press on the floor leaves the keyboard in the frame", async () => {
  const frame = await openFrame();
  frame.doc.body.classList.add("is-fp");
  frame.press();
  expect(frame.focused).not.toHaveBeenCalled();

  // out of the walk, a press gives it back again
  frame.doc.body.classList.remove("is-fp");
  frame.press();
  expect(frame.focused).toHaveBeenCalledTimes(1);
  frame.close();
});

// Safari and Firefox on macOS do not focus a button on a click: the body still has focus when
// the press ends, and the walk starts on the click after it.
test("a press on a control of the frame leaves the keyboard there, whatever has focus", async () => {
  const frame = await openFrame();
  const button = frame.doc.createElement("button");
  const label = frame.doc.createElement("span");
  button.append(label);
  frame.doc.body.append(button);
  expect(frame.doc.activeElement).toBe(frame.doc.body);
  frame.press(button);
  frame.press(label);
  expect(frame.focused).not.toHaveBeenCalled();

  // a press on the floor still gives it back
  frame.press();
  expect(frame.focused).toHaveBeenCalledTimes(1);
  frame.close();
});

test("onOpen is what the scene calls to open a person's session", async () => {
  const open = vi.fn();
  await startPage({ onOpen: open });
  // @ts-expect-error vendored JavaScript has no declarations
  const { host: fresh } = await import("../../vendor/my-office/src/office/paseo-host.js");

  fresh.open?.("ada");
  expect(open).toHaveBeenCalledWith("ada");
});

test("without onOpen the scene has nothing to open a session with", async () => {
  await startPage({});
  // @ts-expect-error vendored JavaScript has no declarations
  const { host: fresh } = await import("../../vendor/my-office/src/office/paseo-host.js");

  expect(fresh.open).toBeNull();
});

test("the plan the host names is the scene's floor; headquarters is not offered", async () => {
  const planOf = async (options: object) => {
    await startPage(options);
    // @ts-expect-error vendored JavaScript has no declarations
    const { host: fresh } = await import("../../vendor/my-office/src/office/paseo-host.js");
    return fresh.plan;
  };
  expect(await planOf({ plan: "cozy" })).toBe("cozy");
  expect(await planOf({ plan: "pro" })).toBe("pro");
  expect(await planOf({ plan: "hq" })).toBe("pro");
  expect(await planOf({})).toBe("pro");
});

test("a start that says photo: false turns the host's photo switch off", async () => {
  await startPage({ photo: false });
  // @ts-expect-error vendored JavaScript has no declarations
  const { host: fresh } = await import("../../vendor/my-office/src/office/paseo-host.js");

  expect(fresh.photo).toBe(false);
});

test("the scene starts with sound off, whatever its page stored", () => {
  expect(atStart).toEqual([false]);
});

test("the host's switch turns upstream's engine on and off", () => {
  world.setSound(true);
  world.setSound(false);
  expect(h.sound).toEqual([true, false]);
});

test("a press on the Sound button plays at once and asks the host, which answers with the same value", () => {
  sound.request(true);
  expect(h.sound).toEqual([true]);
  expect(h.soundAsked).toEqual([true]);
  world.setSound(true);
  expect(h.sound).toEqual([true]);
  world.setSound(false);
});

test("a value that is not true is off", () => {
  world.setSound(true);
  // @ts-expect-error the page treats anything but true as off
  world.setSound("yes");
  expect(h.sound).toEqual([true, false]);
});

test("with no toast from the host the scene shows the text itself: one polite note, a new text replacing the old, gone after four seconds", () => {
  vi.useFakeTimers();
  try {
    host.toast("This browser won't go full screen.");
    const notes = document.querySelectorAll('[role="status"]');
    expect(notes).toHaveLength(1);
    const note = notes[0] as HTMLElement;
    expect(note.textContent).toBe("This browser won't go full screen.");
    vi.advanceTimersByTime(3000);
    host.toast("This app does not let the office play sound.");
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(note.textContent).toBe("This app does not let the office play sound.");
    vi.advanceTimersByTime(3900);
    expect(note.textContent).toBe("This app does not let the office play sound.");
    vi.advanceTimersByTime(200);
    expect(note.textContent).toBe("");
    // The live region stays in the page, so the next text is announced too.
    expect(note.isConnected).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

test("the scene's note is styled with the page's colours, clear of the toolbar, and holds still under reduced motion", async () => {
  // @ts-expect-error vendored JavaScript has no declarations
  const { STYLE } = await import("../../vendor/my-office/src/office/paseo-style.js");
  const css = STYLE as string;
  expect(css).toMatch(
    /\.paseo-note \{[^}]*background: var\(--o-surface-raised\);[^}]*color: var\(--o-fg\);[^}]*border: 1px solid var\(--o-border\);/,
  );
  // The toolbar is 16 px up and 54 px tall: the note's live region starts 84 px up, and over it.
  expect(css).toMatch(/#paseo-note \{[^}]*bottom: 84px;[^}]*z-index: 7;[^}]*pointer-events: none;/);
  expect(css).toMatch(
    /@media \(prefers-reduced-motion: reduce\) \{[^\n]*\.paseo-note \{ animation: none; \}/,
  );
});

test("the wall clock changes nothing: the lights follow the app's theme", async () => {
  h.clockCycled = 0;
  const props = await startPage({});

  expect(props.get("clock")?.hint).toBe("The lights follow the app's theme");
  props.get("clock")?.act();
  expect(h.clockCycled).toBe(0);
});

test("a person whose request begins is glided to, once, when the camera may move", () => {
  seat("a"); // at rest
  h.autoCam = true;
  world.setSessions([{ ...session("a"), status: "wait" }]);
  expect(h.panned).toEqual(["a"]);

  world.setSessions([{ ...session("a"), status: "wait" }]); // still waiting: no second glide
  expect(h.panned).toEqual(["a"]);
});

test("no glide when the camera may not move, for a newcomer, or for a change that is not a request", () => {
  seat("a");
  world.setSessions([{ ...session("a"), status: "wait" }]); // autoCam is off
  expect(h.panned).toEqual([]);

  h.autoCam = true;
  world.setSessions([session("a")]);
  world.setSessions([{ ...session("a"), status: "work" }]);
  expect(h.panned).toEqual([]);

  h.workers.set("b", { id: "b", push() {} });
  world.setSessions([session("a"), { ...session("b"), status: "wait" }]); // b is new to the scene
  expect(h.panned).toEqual([]);
});

test("the host's tenure list and the lift's servicing reach the scenes that read them", () => {
  const tenure = { days: 30, choices: [30], projects: [] };
  world.setTenure(tenure);
  world.setTenure(null);
  world.setLiftService({ left: 1000, total: 180000, newBuild: false, sticker: null });

  expect(h.setTenure.mock.calls).toEqual([[tenure]]);
  expect(h.setLiftService.mock.calls).toEqual([
    [{ left: 1000, total: 180000, newBuild: false, sticker: null }],
  ]);
});

test("the scenes tell the host a farewell, a promotion and a chat line, and nothing else", () => {
  host.tenure({ op: "farewell", name: "api" });
  host.tenure({ op: "official", name: "web" });
  host.tenure({ op: "config", days: 0 });
  host.life("parcel", { id: "a1" });

  expect(h.tenureAsked).toEqual([
    { op: "farewell", name: "api" },
    { op: "official", name: "web" },
  ]);
  expect(h.lines).toEqual([["parcel", { id: "a1" }]]);
});
