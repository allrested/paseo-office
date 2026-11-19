import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { leftIn, named, swap } from "./genericise-street.mjs";
import { BRANDS, REAL_NAMES } from "./street-brands.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "genericise-street.mjs");
const TABLE = path.join(HERE, "street-brands.mjs");

/** A line of text as the source holds it: a string. */
const say = (input, expected) => [`"${input}"`, `"${expected}"`];

/** Every case: [input, what swap makes of it]. An unchanged case has the input twice. */
const CASES = {
  "display names": [
    ["name: 'Circle K'", "name: 'Corner Kiosk'"],
    ['"GrabFood"', '"Ridely Food"'],
    say(
      "going home past WinMart+ or Bách Hóa Xanh",
      "going home past Greenway Market or Green Basket",
    ),
    say("the MIXUE sign", "the FROSTY CONE sign"),
    say("a bowl at Phở 24, PHO 24 on the board", "a bowl at Phở Ngon, PHO NGON on the board"),
  ],
  "keys as a quoted string, an object key or a property": [
    ["circlek: { name: 'x' }", "kiosk: { name: 'x' }"],
    ["CHAINS['gs25']", "CHAINS['pebble']"],
    ['"mixue"', '"frosty"'],
    ["tr('people.looks.pixar')", "tr('people.looks.cartoon')"],
    ["`shop-mixue.js`", "`shop-mixue.js`"],
    ["import x from './mixue.js';", "import x from './mixue.js';"],
  ],
  "keys in a camelCase compound": [
    ["mixueAsk: [", "frostyAsk: ["],
    ["traSuaPhucLong: 'a milk tea'", "traSuaJadeTea: 'a milk tea'"],
    ["highlandsMorning: [", "plateauMorning: ["],
  ],
  "word keys: whole quoted strings and object keys only": [
    ["'seven'", "'dailystop'"],
    ["  seven: 1,", "  dailystop: 1,"],
    ["const seven = 7;", "const seven = 7;"],
    ["sevenfold", "sevenfold"],
    ["'Seven days'", "'Seven days'"],
    ["'cong'", "'olivecafe'"],
    ["congDay", "congDay"],
    ["congAsk: [", "olivecafeAsk: ["],
    ["congWeekend: [", "olivecafeWeekend: ["],
    ["{ grab: '#00A859', be: '#F6C51B' }", "{ ridely: '#00A859', buzz: '#F6C51B' }"],
    ["['grab', 'nonla', 'box', 'be']", "['ridely', 'nonla', 'box', 'buzz']"],
    ["const kinds = {\n  seven: 1,\n};", "const kinds = {\n  dailystop: 1,\n};"],
    ["const hex = ['bd', 'be', 'bf'];", "const hex = ['bd', 'be', 'bf'];"],
    ["#stage canvas { cursor: grab; }", "#stage canvas { cursor: grab; }"],
    ["el.style.cursor = 'grab';", "el.style.cursor = 'grab';"],
    ["{ cursor: 'grab' }", "{ cursor: 'grab' }"],
    ["el.style.setProperty('cursor', 'grab');", "el.style.setProperty('cursor', 'grab');"],
    [
      "el.style.cursor = drag ? 'grabbing' : 'grab';",
      "el.style.cursor = drag ? 'grabbing' : 'grab';",
    ],
    ["const be = 1;", "const be = 1;"],
    say("it will be: yes", "it will be: yes"),
  ],
  "file name stems": [
    ["'xanh-sm.svg'", "'aqua.svg'"],
    ["'circle-k.svg'", "'kiosk.svg'"],
    ["'brands/mixue.svg'", "'brands/frosty.svg'"],
  ],
  "Vietnamese forms, as whole words": [
    ["'Cộng Cà Phê'", "'Olive Cafe'"],
    ["'Bách Hóa Xanh'", "'Green Basket'"],
    say("Off to Cộng for a coconut coffee", "Off to Olive Cafe for a coconut coffee"),
    say("a walk down Cộng Hòa, CỘNG HÒA on the sign", "a walk down Cộng Hòa, CỘNG HÒA on the sign"),
    say("bên kia đường", "bên kia đường"),
    say("ôKia", "ôKia"),
    say("a Kia and a Ford", "a Karo and a Forge"),
  ],
  "ordinary words are not names": [
    say("afford", "afford"),
    say("Grab me 500k too 😆", "Grab me 500k too 😆"),
    say("GRAB ME A COFFEE", "GRAB ME A COFFEE"),
    say("Grab some vitamin C fizz for everyone", "Grab some vitamin C fizz for everyone"),
    say("Let me grab a cue 🎱", "Let me grab a cue 🎱"),
    say("A printout? I'll grab it 🖨️", "A printout? I'll grab it 🖨️"),
    say("Grabbing a phin sữa đá at Highlands", "Grabbing a phin sữa đá at Plateau"),
    say("Be careful", "Be careful"),
  ],
  "a name that is also a word, used as the name": [
    say("Take a Grab home 🍻🚫", "Take a Ridely home 🍻🚫"),
    say("TAKE A GRAB HOME", "TAKE A RIDELY HOME"),
    ["grab: 'Grab’s on its way',", "ridely: 'Ridely’s on its way',"],
    [
      "how: { grab: 'GrabBike', xsm: 'Xanh SM Bike' }",
      "how: { ridely: 'Ridely Bike', aqua: 'Aqua Ride Bike' }",
    ],
    [
      "// a motorbike from behind: Grab green, Be yellow",
      "// a motorbike from behind: Ridely green, Buzz yellow",
    ],
  ],
  "phrases rewritten whole": [
    say("vertical 9:16 for Reels, TikTok and Shorts", "vertical 9:16 for short-video apps"),
    say(
      "At {temp}°, a Mixue cone is the answer",
      "At {temp}°, a Frosty Cone soft-serve is the answer",
    ),
    say("A weekend needs a Cộng coffee", "A weekend needs an Olive Cafe coffee"),
    say("not without a Cộng coconut coffee", "not without an Olive Cafe coconut coffee"),
  ],
};

/** Names in code: the output must parse, and an identifier is renamed the same way in every file. */
const CODE = [
  [
    "const CHAIN = { 'Circle K': 'circlek', GS25: 'gs25', Ministop: 'ministop', Mixue: 'mixue', Katinat: 'katinat' };",
    "const CHAIN = { 'Corner Kiosk': 'kiosk', 'Pebble Mart': 'pebble', 'Hourglass Mart': 'hourglass', 'Frosty Cone': 'frosty', 'Navy Coffee House': 'navycafe' };",
  ],
  [
    "// KATINAT: the sign's letters\nexport const KATINAT = { chain: { name: 'Katinat' } };",
    "// NAVY COFFEE HOUSE: the sign's letters\nexport const NAVY_COFFEE_HOUSE = { chain: { name: 'Navy Coffee House' } };",
  ],
  [
    "import { KATINAT } from './shop-katinat.js';\nconst CUSTOM = { katinat: KATINAT };",
    "import { NAVY_COFFEE_HOUSE } from './shop-katinat.js';\nconst CUSTOM = { navycafe: NAVY_COFFEE_HOUSE };",
  ],
  [
    "const s = CHAIN.Mixue + KATINAT.chain.name + a?.Mixue + x.Grab;",
    "const s = CHAIN['Frosty Cone'] + NAVY_COFFEE_HOUSE.chain.name + a?.['Frosty Cone'] + x.Ridely;",
  ],
  [
    "const s = `${Mixue} at Mixue`; const r = /Mixue|GS25/; const d = a / Mixue / 2;",
    "const s = `${Frosty_Cone} at Frosty Cone`; const r = /Frosty Cone|Pebble Mart/; const d = a / Frosty_Cone / 2;",
  ],
];

const parses = (code) => transformSync(code, { loader: "js", format: "esm" });

describe("genericise-street", () => {
  for (const [name, cases] of Object.entries(CASES)) {
    it(`swaps ${name}`, () => {
      for (const [input, expected] of cases) assert.equal(swap(input), expected, input);
    });
  }

  it("writes code that still parses for a name in code", () => {
    for (const [input, expected] of CODE) {
      parses(input);
      assert.equal(swap(input), expected, input);
      parses(swap(input));
    }
  });

  it("is idempotent", () => {
    for (const [input] of [...Object.values(CASES).flat(), ...CODE]) {
      assert.equal(swap(swap(input)), swap(input), input);
    }
  });

  it("reports what the swap would change: names in table order, then keys, each once", () => {
    assert.deepEqual(leftIn("a Mixue and a Toyota"), ["Mixue", "Toyota"]);
    assert.deepEqual(leftIn("a Toyota and a Mixue"), ["Mixue", "Toyota"]);
    assert.deepEqual(leftIn("a toyota"), []);
    assert.deepEqual(leftIn("MIXUE"), ["Mixue"]);
    assert.deepEqual(leftIn("cursor: grab; Grabbing an onigiri; afford; bên kia"), []);
    assert.deepEqual(leftIn("Grab me 500k too"), []);
    assert.deepEqual(leftIn("Take a Grab home"), ["Grab"]);
    assert.deepEqual(leftIn("Be careful"), []);
    assert.deepEqual(leftIn("Be yellow"), ["Be"]);
    assert.deepEqual(leftIn("const a = { xsm: 1, b: 'mixue', mixueAsk: [] };"), ["mixue", "xsm"]);
    assert.deepEqual(leftIn("x.Mixue; y = 'mixue'; z = { grab: 1 }"), ["Mixue", "mixue", "grab"]);
  });

  it("finds something exactly where the swap would change something", () => {
    for (const [input, expected] of [...Object.values(CASES).flat(), ...CODE]) {
      assert.equal(leftIn(input).length === 0, swap(input) === input, input);
      assert.deepEqual(leftIn(expected), [], expected);
    }
  });

  it("leaves no real name of the table after a swap", () => {
    // Each name followed by a word that makes it the name (Be is one only before "yellow").
    const text = BRANDS.map((b) => `"${b.real} ${b.followedBy?.[0] ?? "x"}";`).join("\n");
    assert.deepEqual(leftIn(text), REAL_NAMES);
    assert.deepEqual(leftIn(text.toUpperCase()), REAL_NAMES);
    assert.deepEqual(leftIn(swap(text)), []);
    assert.deepEqual(leftIn(swap(text.toUpperCase())), []);
  });

  it("notes a changed file once, on its first line", () => {
    const note = named("export default { a: 'Mixue' };\n");
    assert.match(
      note,
      /^\/\/ PASEO: names [^\n]*genericise-street\.mjs[^\n]*\nexport default \{ a: 'Frosty Cone' \};\n$/,
    );
    assert.equal(named(note), note);
    assert.equal(named("const a = 1;\n"), "const a = 1;\n");
  });

  describe("the command", () => {
    let dir;
    before(() => {
      dir = mkdtempSync(path.join(tmpdir(), "genericise-street-"));
    });
    after(() => rmSync(dir, { recursive: true, force: true }));
    const run = (...args) => spawnSync("node", [SCRIPT, ...args], { encoding: "utf8" });

    it("--check fails on a file with a real name and names the file, and writes nothing", () => {
      const file = path.join(dir, "a.js");
      writeFileSync(file, "export const shop = 'Mixue';\n");
      const result = run("--check", "--files", file);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /a\.js: Mixue/);
      assert.equal(readFileSync(file, "utf8"), "export const shop = 'Mixue';\n");
    });

    it("--check fails on a file with only a real key", () => {
      const file = path.join(dir, "keys.js");
      writeFileSync(file, "export const how = { xsm: 'a ride' };\n");
      const result = run("--check", "--files", file);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /keys\.js: xsm/);
    });

    it("--check passes on a clean file", () => {
      const file = path.join(dir, "b.js");
      writeFileSync(file, "export const shop = 'a shop';\n");
      assert.equal(run("--check", "--files", file).status, 0);
    });

    it("never reads the table itself", () => {
      const result = run("--check", "--files", TABLE);
      assert.equal(result.status, 0, result.stderr);
    });

    it("swaps the names in the files and passes its own check", () => {
      const file = path.join(dir, "c.js");
      writeFileSync(file, "export const shop = 'Mixue';\n");
      assert.equal(run("--files", file).status, 0);
      const once = readFileSync(file, "utf8");
      assert.match(once, /^\/\/ PASEO: names [^\n]*\nexport const shop = 'Frosty Cone';\n$/);
      assert.equal(run("--files", file).status, 0);
      assert.equal(readFileSync(file, "utf8"), once);
    });

    it("--check passes over every vendored file of this repository", () => {
      const result = run("--check");
      assert.equal(result.status, 0, result.stderr);
    });
  });
});
