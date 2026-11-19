// The three files of my-office's staff scenes changed by hand (vendor/SOURCES.md): the tenure list's
// writes go to the host, not to upstream's server, and the courier's carton carries no company's mark.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";

const read = (rel: string) =>
  readFileSync(path.resolve(import.meta.dirname, "../../vendor/my-office/src", rel), "utf8");

test("farewell.js and interns.js tell the host, not a server", () => {
  for (const file of ["office/people/farewell.js", "office/people/interns.js"]) {
    const text = read(file);
    expect(text, file).toContain("PASEO:");
    expect(text, file).not.toContain("fetch(");
    expect(text, file).not.toMatch(/\bTOKEN\b/);
    // Every page tells the host; upstream let only the page on its own host post.
    expect(text, file).not.toContain("state.isLocal");
    expect(text, file).toContain("host.tenure(");
  }
});

test("the courier's carton carries a plain mark, not a company's logo", () => {
  const text = read("office/people/staff.js");
  expect(text).toContain("// PASEO: a plain box mark");
  expect(text).not.toContain("Path2D(");
  expect(text).not.toContain("Simple Icons");
});

test("the lift's sticker names the office, not the scene's source", () => {
  expect(read("i18n/index.js")).toContain("'life.liftService.stickerWhat': 'Office {version}'");
});
