import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("public boot path does not import authenticated app stack eagerly", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  const main = readFileSync("src/main.tsx", "utf8");

  assert.doesNotMatch(main, /@tanstack\/react-query/);
  assert.match(app, /lazy\(\(\) => import\("\.\/routes\/Gallery"\)\)/);
  assert.match(app, /lazy\(\(\) => import\("\.\/routes\/Assistant"\)\)/);
  assert.match(app, /lazy\(\(\) => import\("\.\/routes\/Billing"\)\)/);
  assert.match(app, /lazy\(\(\) => import\("\.\/routes\/GenerationDetail"\)\)/);
  assert.match(app, /lazy\(\(\) => import\("\.\/routes\/ProtectedRoute"\)\)/);
  assert.doesNotMatch(app, /import Gallery from/);
  assert.doesNotMatch(app, /import AppShell from/);
  assert.doesNotMatch(app, /useMe/);
});
