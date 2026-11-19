import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (rel: string) =>
  readFileSync(new URL(`../../vendor/my-office/src/office/${rel}`, import.meta.url), "utf8");

test("farewell.js and interns.js tell the host, not a server", () => {
  for (const file of ["people/farewell.js", "people/interns.js"]) {
    const text = read(file);
    expect(text, file).toContain("PASEO:");
    expect(text, file).not.toContain("fetch(");
    expect(text, file).not.toContain("/api/");
    expect(text, file).toContain("host.tenure(");
    expect(text, file).not.toMatch(/\bTOKEN\b|state\.isLocal/);
  }
});

test("the courier carries no real brand's mark", () => {
  const text = read("people/staff.js");
  expect(text).toContain("PASEO:");
  expect(text).not.toContain("new Path2D(");
  expect(text).not.toMatch(/Shopee/i);
});

test("the lift's sticker does not say the name of the scene's source", () => {
  const ours = readFileSync(
    new URL("../../vendor/my-office/src/i18n/index.js", import.meta.url),
    "utf8",
  );
  expect(ours).toContain("'life.liftService.stickerWhat'");
  for (const key of [
    "people.staff.shipper",
    "people.staff.shipperHi",
    "people.staff.call",
    "people.staff.callDoor",
  ]) {
    expect(ours).toContain(`'${key}'`);
  }
});
