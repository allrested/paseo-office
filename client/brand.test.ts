import { expect, test } from "vitest";
import { parseBrand } from "./brand.js";

const PAGE = "https://office.example/h/local/plugin/office/surface/office";

test("the page's brand has its name and its logo's address in full", () => {
  expect(
    parseBrand({ name: "Acme", logoUrl: "/_brand/logo.svg", iconUrl: "/_brand/icon.png" }, PAGE),
  ).toEqual({ name: "Acme", logoUrl: "https://office.example/_brand/logo.svg" });
});

test("the logo's address as the daemon writes it keeps its version", () => {
  // A daemon with a brand serves its logo as `/_brand/logo?v=<version>`.
  expect(parseBrand({ name: "Acme", logoUrl: "/_brand/logo?v=3f2a" }, PAGE)).toEqual({
    name: "Acme",
    logoUrl: "https://office.example/_brand/logo?v=3f2a",
  });
});

test("a name alone and a logo alone are each a brand", () => {
  expect(parseBrand({ name: "Acme" }, PAGE)).toEqual({ name: "Acme", logoUrl: null });
  expect(parseBrand({ logoUrl: "/_brand/logo.png" }, PAGE)).toEqual({
    name: null,
    logoUrl: "https://office.example/_brand/logo.png",
  });
});

test("anything else is no brand", () => {
  const not = [
    undefined,
    null,
    "Acme",
    3,
    {},
    { name: "  " },
    { name: 3 },
    { logoUrl: 3 },
    { logoUrl: { href: "/_brand/logo?v=1" } },
    { logoUrl: "https://elsewhere.example/logo.svg" },
    { logoUrl: "//elsewhere.example/_brand/logo.svg" },
  ];
  for (const value of not) expect(parseBrand(value, PAGE)).toBeNull();
});
