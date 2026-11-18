// Draws icon.png, the plugin's icon: an office building on a rounded square, 256 by 256. Needs
// nothing beyond Node: the shapes are rectangles, each pixel is 4 by 4 samples for smooth edges,
// and the PNG is written by hand over node:zlib. Run with `npm run build:icon`.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "icon.png");
const SIZE = 256;
const SAMPLES = 4;

// A mid blue reads on light and dark backgrounds; the building is near white.
const BACKGROUND = [43, 108, 176];
const BUILDING = [247, 250, 252];

/** [left, top, right, bottom], in pixels of the 256 grid. */
const rect = (left, top, right, bottom) => ({ left, top, right, bottom });
const inside = (r, x, y) => x >= r.left && x < r.right && y >= r.top && y < r.bottom;

const SQUARE = { ...rect(8, 8, 248, 248), radius: 52 };
const TOWER = rect(66, 48, 146, 208);
const WING = rect(146, 108, 190, 208);
const ROWS = [66, 96, 126, 156];
const HOLES = [
  ...ROWS.flatMap((top) => [76, 98, 120].map((left) => rect(left, top, left + 16, top + 18))),
  ...ROWS.slice(2).map((top) => rect(160, top, 176, top + 18)),
];
// The door, under the tower's middle column of windows.
const DOOR = rect(96, 182, 116, 208);

function inSquare(x, y) {
  const { left, top, right, bottom, radius } = SQUARE;
  if (!inside(SQUARE, x, y)) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function inBuilding(x, y) {
  if (!inside(TOWER, x, y) && !inside(WING, x, y)) return false;
  if (inside(DOOR, x, y)) return false;
  return !HOLES.some((hole) => inside(hole, x, y));
}

function pixel(px, py) {
  let covered = 0;
  const sum = [0, 0, 0];
  for (let sy = 0; sy < SAMPLES; sy += 1) {
    for (let sx = 0; sx < SAMPLES; sx += 1) {
      const x = px + (sx + 0.5) / SAMPLES;
      const y = py + (sy + 0.5) / SAMPLES;
      if (!inSquare(x, y)) continue;
      const colour = inBuilding(x, y) ? BUILDING : BACKGROUND;
      covered += 1;
      for (let c = 0; c < 3; c += 1) sum[c] += colour[c];
    }
  }
  if (covered === 0) return [0, 0, 0, 0];
  return [
    ...sum.map((value) => Math.round(value / covered)),
    Math.round((255 * covered) / SAMPLES ** 2),
  ];
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// Each row is filter type 0 (none) followed by RGBA bytes.
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y += 1) {
  const row = y * (1 + SIZE * 4);
  for (let x = 0; x < SIZE; x += 1) Buffer.from(pixel(x, y)).copy(raw, row + 1 + x * 4);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA, deflate, adaptive filters, no interlace

writeFileSync(
  OUT,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);
console.log(`wrote ${path.relative(ROOT, OUT)}`);
