import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { leftIn, named, swap } from "./genericise-street.mjs";
import { BRANDS, REAL_NAMES } from "./street-brands.mjs";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "genericise-street.mjs");

/** Every case: [input, what swap makes of it]. An unchanged case has the input twice. */
const CASES = {
  "display names": [
    ["name: 'Circle K'", "name: 'Corner Kiosk'"],
    ['"GrabFood"', '"Ridely Food"'],
    [
      "going home past WinMart+ or Bách Hóa Xanh",
      "going home past Greenway Market or Green Basket",
    ],
    ["the MIXUE sign", "the FROSTY CONE sign"],
  ],
  "keys as a quoted string, an object key or a property": [
    ["circlek: { name: 'x' }", "kiosk: { name: 'x' }"],
    ["CHAINS['gs25']", "CHAINS['mart24']"],
    ['"mixue"', '"frosty"'],
    ["tr('people.looks.pixar')", "tr('people.looks.cartoon')"],
    ["`shop-mixue.js`", "`shop-mixue.js`"],
    ["import x from './mixue.js';", "import x from './mixue.js';"],
  ],
  "keys in a camelCase compound": [
    ["mixueAsk: [", "frostyAsk: ["],
    ["traSuaPhucLong: 'a milk tea'", "traSuaJadeTea: 'a milk tea'"],
    ["highlandsMorning: [", "hilltopMorning: ["],
  ],
  "word keys: whole quoted strings and object keys only": [
    ["'seven'", "'dailystop'"],
    ["  seven: 1,", "  dailystop: 1,"],
    ["const seven = 7;", "const seven = 7;"],
    ["sevenfold", "sevenfold"],
    ["'Seven days'", "'Seven days'"],
    ["'cong'", "'olivecafe'"],
    ["congDay", "congDay"],
    ["congWeekend: [", "olivecafeWeekend: ["],
    ["{ grab: '#00A859', be: '#F6C51B' }", "{ ridely: '#00A859', buzz: '#F6C51B' }"],
    ["['grab', 'nonla', 'box', 'be']", "['ridely', 'nonla', 'box', 'buzz']"],
    ["#stage canvas { cursor: grab; }", "#stage canvas { cursor: grab; }"],
    ["el.style.cursor = 'grab';", "el.style.cursor = 'grab';"],
    ["{ cursor: 'grab' }", "{ cursor: 'grab' }"],
    ["const be = 1;", "const be = 1;"],
  ],
  "file name stems": [
    ["'xanh-sm.svg'", "'aqua.svg'"],
    ["'circle-k.svg'", "'kiosk.svg'"],
    ["'brands/mixue.svg'", "'brands/frosty.svg'"],
  ],
  "Vietnamese forms, as whole words": [
    ["'Cộng Cà Phê'", "'Olive Cafe'"],
    ["'Bách Hóa Xanh'", "'Green Basket'"],
    ["Off to Cộng for a coconut coffee", "Off to Olive Cafe for a coconut coffee"],
    ["bên kia đường", "bên kia đường"],
    ["ôKia", "ôKia"],
    ["a Kia and a Ford", "a Karo and a Forge"],
  ],
  "ordinary words are not names": [
    ["afford", "afford"],
    ["Grab me 500k too 😆", "Grab me 500k too 😆"],
    ["Grab some vitamin C fizz for everyone", "Grab some vitamin C fizz for everyone"],
    ["Let me grab a cue 🎱", "Let me grab a cue 🎱"],
    ["A printout? I'll grab it 🖨️", "A printout? I'll grab it 🖨️"],
    ["Grabbing a phin sữa đá at Highlands", "Grabbing a phin sữa đá at Hilltop"],
    ["Be careful", "Be careful"],
  ],
  "a name that is also a word, used as the name": [
    ["Take a Grab home 🍻🚫", "Take a Ridely home 🍻🚫"],
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
    ["vertical 9:16 for Reels, TikTok and Shorts", "vertical 9:16 for short-video apps"],
    [
      "At {temp}°, a Mixue cone is the answer",
      "At {temp}°, a Frosty Cone soft-serve is the answer",
    ],
    ["A weekend needs a Cộng coffee", "A weekend needs an Olive Cafe coffee"],
  ],
};

describe("genericise-street", () => {
  for (const [name, cases] of Object.entries(CASES)) {
    it(`swaps ${name}`, () => {
      for (const [input, expected] of cases) assert.equal(swap(input), expected, input);
    });
  }

  it("is idempotent", () => {
    for (const cases of Object.values(CASES)) {
      for (const [input] of cases) assert.equal(swap(swap(input)), swap(input), input);
    }
  });

  it("finds the real names left, as whole words in the table's case or all caps, in table order", () => {
    assert.deepEqual(leftIn("a Mixue and a Toyota"), ["Mixue", "Toyota"]);
    assert.deepEqual(leftIn("a Toyota and a Mixue"), ["Mixue", "Toyota"]);
    assert.deepEqual(leftIn("a toyota"), []);
    assert.deepEqual(leftIn("MIXUE"), ["Mixue"]);
    assert.deepEqual(leftIn("cursor: grab; Grabbing an onigiri; afford; bên kia"), []);
    assert.deepEqual(leftIn("Grab me 500k too"), []);
    assert.deepEqual(leftIn("Take a Grab home"), ["Grab"]);
    assert.deepEqual(leftIn("Be careful"), []);
    assert.deepEqual(leftIn("Be yellow"), ["Be"]);
  });

  it("leaves no real name of the table after a swap", () => {
    // Each name followed by a word that makes it the name (Be is one only before "yellow").
    const text = BRANDS.map((b) => `${b.real} ${b.followedBy?.[0] ?? "x"}`).join(" · ");
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
      assert.match(result.stderr, /a\.js/);
      assert.match(result.stderr, /Mixue/);
      assert.equal(readFileSync(file, "utf8"), "export const shop = 'Mixue';\n");
    });

    it("--check passes on a clean file", () => {
      const file = path.join(dir, "b.js");
      writeFileSync(file, "export const shop = 'a shop';\n");
      assert.equal(run("--check", "--files", file).status, 0);
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
  });
});
