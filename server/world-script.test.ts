import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { leftIn } from "../scripts/genericise-street.mjs";
import { WORLD_SCRIPT } from "./world.generated.js";
import { embeddedWorldScript } from "./world-script.js";

const BUILD = fileURLToPath(new URL("../scripts/build-world.mjs", import.meta.url));

/** The script with esbuild's \x, \u and \u{} escapes read back, so a Vietnamese name is seen. */
const unescaped = (script: string): string =>
  script.replace(
    /\\x([0-9a-fA-F]{2})|\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})/g,
    (_, x, braced, u) => String.fromCodePoint(parseInt(x ?? braced ?? u, 16)),
  );

describe("the 3D office's page script", () => {
  it("is the embedded script, whenever it is read", async () => {
    const world = embeddedWorldScript();
    expect(await world.read()).toBe(WORLD_SCRIPT);
    expect(await world.read()).toBe(WORLD_SCRIPT);
  });

  it("is one self-contained browser script that sets the scene's entry", () => {
    expect(WORLD_SCRIPT.length).toBeGreaterThan(100_000);
    expect(WORLD_SCRIPT).toContain("PaseoOfficeWorld");
    // Bundled: nothing is left to resolve in the frame.
    expect(WORLD_SCRIPT).not.toMatch(/\bfrom\s*["']three["']/);
  });

  it("carries my-office's licence notice and three.js's", () => {
    expect(WORLD_SCRIPT.startsWith("/*! my-office, https://github.com/khanh020905/my-office")).toBe(
      true,
    );
    expect(WORLD_SCRIPT).toContain("Copyright (c) 2026 khanh020905");
    expect(WORLD_SCRIPT).toContain("Copyright 2010-2023 Three.js Authors");
  });

  it("is what the build makes from the vendored scene", () => {
    // Fails when vendor/my-office changed and the script was not built again.
    expect(() => execFileSync("node", [BUILD, "--check"], { stdio: "pipe" })).not.toThrow();
  }, 60_000);
});

describe("the embedded scene", () => {
  it("holds one script that sets the page's API and needs nothing a browser lacks", () => {
    const script = WORLD_SCRIPT;

    expect(script).toContain("PaseoOfficeWorld");
    // The library's chip and the bookshelf tell Paseo, which opens its Library card.
    expect(script).toContain("onLibrary");
    // E by a person while walking in tells Paseo, which opens their session.
    expect(script).toContain("onOpen");
    // The bell tells Paseo, which has the stand-up notes written, and the label over the meeting
    // room's screen opens them.
    // Seasons, rain and weather: upstream's decorations, umbrellas and rain, drawing what the host sends.
    expect(script).toContain("setWeather");
    expect(script).toContain("life.season.");
    expect(script).toContain("WET");
    // The scene asks nobody: upstream's weather call and its storage key are gone.
    expect(script).not.toContain("open-meteo");
    expect(script).not.toContain("office-wx");
    expect(script).toContain("onBell");
    expect(script).toContain("onNotes");
    expect(script).toContain("Stand-up notes");
    // The label stands on the screen's top edge, clear of the meeting room's chip.
    expect(script).toMatch(/\.set\(\.2,\w+==="tet"\?4\.2:2\.525,-7\.95\)/);
    expect(script).toContain(".center.set(.5,1)");
    // A deploy that failed has its own line in the bubble.
    expect(script).toContain("paseo.deploy.failed");
    // A deploy that succeeded says so.
    expect(script).toContain("Shipped {label}");
    // So has an agent that waits on its sub-agents.
    expect(script).toContain("paseo.subwait");
    // The lively floor: what someone says on the way to the fish, and Paseo's schedule itself
    // (the station of someone it stopped for the bell).
    expect(script).toContain("Feeding the fish");
    expect(script).toContain("Back in a minute");
    expect(script).toContain('.station="leisure"');
    // Upstream's four games are in: pool, the TV matches, foosball and karaoke.
    for (const line of ["billiards", "tv", "foos", "karaoke"]) {
      expect(script).toContain(`people.${line}.invite`);
    }
    // The scene with three.js r160; a jump means a module the port leaves out came back in.
    // (Measured about 1.52M with the street; the car kit travels separately.)
    expect(script.length).toBeGreaterThan(1_350_000);
    expect(script.length).toBeLessThan(1_750_000);
    // Node's globals would throw in the page: upstream's build flag was the one use.
    expect(script).not.toContain("process.env");
    expect(script).not.toMatch(/\brequire\(/);
  });

  it("bundles upstream's photo mode, with Paseo's mark and file name", () => {
    const photo = readFileSync(
      new URL("../vendor/my-office/src/office/ui/photo.js", import.meta.url),
      "utf8",
    );
    const bundle = WORLD_SCRIPT;

    expect(photo).toContain("PASEO:");
    expect(photo).toContain("host.brandName");
    expect(photo).toMatch(/office-\$\{/);
    expect(photo).not.toContain("my-office-");
    expect(bundle).toContain("ph-shoot");
  });

  it("bundles the camera extras: the tour, the clip, and the automatic camera", () => {
    const read = (name: string) =>
      readFileSync(new URL(`../vendor/my-office/src/${name}`, import.meta.url), "utf8");
    const tips = read("office/ui/tips.js");
    const timelapse = read("office/ui/timelapse.js");
    const music = read("office/ui/clip-music.js");
    const photo = read("office/ui/photo.js");
    const words = read("i18n/index.js");
    const bundle = WORLD_SCRIPT;

    // The tour: no bell card, the person card in Paseo's words, once per device.
    expect(tips).toContain("PASEO:");
    expect(tips).not.toContain("key: 'bell'");
    expect(words).toContain("'tips.person.text'");
    expect(bundle).toContain("office-tips");
    expect(bundle).toContain("Each person is an agent");
    // The clip: the file is named for the office, the music waits for Sound, the choices are kept on the device.
    expect(timelapse).toContain("office-clip-");
    expect(timelapse).not.toContain("my-office-clip-");
    expect(music).toMatch(/if \(!sfx\?\.on\) return null;/);
    expect(bundle).toContain("office-clip-music");
    expect(bundle).toContain("ph-clipset");
    // The clip's cover is not hidden by photo mode's rule.
    expect(bundle).toContain(":not(.clip-cover)");
    // Photo mode's day and night go back with it, and a clip keeps it open.
    expect(photo).toContain("setTimeMode('auto')");
    expect(photo).toContain("if (state.clip) return;");
    expect(bundle).toContain("data-ph-time");
    // The automatic camera and its switch.
    expect(bundle).toContain("office-autocam");
    // The scene still makes no network call of its own: nothing the new files add calls out.
    expect(bundle).not.toMatch(/\bfetch\(["'`]https?:/);
  });

  it("bundles the staff scenes, with no network call and no real brand's mark", () => {
    for (const line of [
      "people.hr.",
      "people.accountant.",
      "people.duty.",
      "life.liftService.",
      "life.drill.",
      "life.altar.",
    ]) {
      expect(WORLD_SCRIPT).toContain(line);
    }
    expect(WORLD_SCRIPT).not.toContain("fetch(");
    expect(WORLD_SCRIPT).not.toContain("/api/");
  });

  it("bundles upstream's first-person walk, with the street cut", () => {
    const walk = readFileSync(
      new URL("../vendor/my-office/src/office/interact/first-person.js", import.meta.url),
      "utf8",
    );
    const bundle = WORLD_SCRIPT;

    expect(walk).not.toContain("stand-in");
    expect(walk).toContain("THEME.live?.street");
    expect(walk).toMatch(/export const floorBounds/);
    expect(walk).toContain("open: true");
    expect(bundle).toContain("fp-near");
  });

  it("the scene's bundle builds with the new modules", () => {
    const script = WORLD_SCRIPT;

    // The incidents alarm: Paseo's call and start option, the banner's words, upstream's red stage.
    expect(script).toContain("setIncidents");
    expect(script).toContain("onIncidents");
    expect(script).toContain("Incident: {key} {title}");
    expect(script).toContain("incident.more");
    expect(script).toContain("is-incident");
    // Upstream's red light over the floor.
    expect(script).toContain("#FF2A2A");
    // Upstream's sound engine, all its sounds but one shop's tune (a real brand's, kept out by its key).
    expect(script).toContain("office-sound");
    expect(script).toContain("webkitAudioContext");
    expect(script).toContain("setSound");
    expect(script).toContain("btn-sound");
    expect(script).not.toMatch(/\bfrosty:\(?\w*\)?=>/);
  });

  it("names no real shop, app or product: the names are made-up ones", () => {
    expect(leftIn(unescaped(WORLD_SCRIPT))).toEqual([]);
  });

  it("reads a name the bundle writes with escapes", () => {
    expect(leftIn("a Ph\\xFAc Long")).toEqual([]);
    expect(leftIn(unescaped("a Ph\\xFAc Long, C\\u1ED9ng, C\\u{1ED9}ng C\\xE0 Ph\\xEA"))).toEqual([
      "Cộng Cà Phê",
      "Cộng",
      "Phúc Long",
    ]);
  });
});

it("sends the street models separately and makes no calls for the artwork", async () => {
  const kit = await embeddedWorldScript().readStreet();
  expect(JSON.parse(kit).models).toHaveProperty("sedan");
  expect(WORLD_SCRIPT).not.toContain(kit.slice(0, 150));
  for (const url of ["/assets/brands", "/assets/vehicles", "/api/claude-version"])
    expect(WORLD_SCRIPT).not.toContain(url);
});
