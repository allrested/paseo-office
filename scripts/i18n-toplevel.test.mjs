import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { ROOT } from "./locale-words.mjs";

const SCENE = path.join(ROOT, "vendor/my-office/src/office");
const FUNCTIONS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.Constructor,
]);

/** Calls of what a file imports from the i18n stand-in that run when the module loads, not inside a function. */
export function lookupsAtLoad(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const names = new Set();
  source.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier.text.endsWith("/i18n/index.js")) {
      node.importClause?.namedBindings?.elements?.forEach((element) =>
        names.add(element.name.text),
      );
    }
  });
  const hits = [];
  const visit = (node, inside) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      names.has(node.expression.text) &&
      !inside
    ) {
      hits.push(
        `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${node.getText().slice(0, 60)}`,
      );
    }
    node.forEachChild((child) => visit(child, inside || FUNCTIONS.has(child.kind)));
  };
  source.forEachChild((child) => visit(child, FUNCTIONS.has(child.kind)));
  return hits;
}

test("the check sees a lookup at load and not one in a function", () => {
  const head = "import { t, t as tr } from '../i18n/index.js';\n";
  assert.equal(lookupsAtLoad("a.js", `${head}const A = tr('x.y');`).length, 1);
  assert.equal(lookupsAtLoad("a.js", `${head}const A = { b: [t('x.y')] };`).length, 1);
  assert.equal(
    lookupsAtLoad("a.js", `${head}const A = () => tr('x.y'); function f() { return t('a.b'); }`)
      .length,
    0,
  );
});

test("no module of the scene looks a word up while it loads: the language is set in start()", () => {
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js"))
        hits.push(...lookupsAtLoad(path.relative(SCENE, full), readFileSync(full, "utf8")));
    }
  };
  walk(SCENE);
  assert.deepEqual(hits, []);
});
