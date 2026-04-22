import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("public boot path does not import authenticated app stack eagerly", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  const main = readFileSync("src/main.tsx", "utf8");
  const protectedRoute = readFileSync("src/routes/ProtectedRoute.tsx", "utf8");

  assert.doesNotMatch(main, /@tanstack\/react-query/);
  assert.match(app, /lazy\(\(\) => import\("\.\/routes\/Gallery"\)\)/);
  assert.match(app, /lazy\(\(\) => import\("\.\/routes\/Assistant"\)\)/);
  assert.match(app, /lazy\(\(\) => import\("\.\/routes\/Billing"\)\)/);
  assert.match(app, /lazy\(\(\) => import\("\.\/routes\/GenerationDetail"\)\)/);
  assert.match(app, /import ProtectedRoute from "\.\/routes\/ProtectedRoute"/);
  assert.doesNotMatch(app, /import Gallery from/);
  assert.doesNotMatch(app, /useMe/);
  assert.match(protectedRoute, /Suspense/);
  assert.match(protectedRoute, /AppShell/);
});

test("production source maps are opt-in", () => {
  const viteConfig = readFileSync("vite.config.ts", "utf8");

  assert.match(viteConfig, /VITE_SOURCEMAP/);
  assert.doesNotMatch(viteConfig, /sourcemap:\s*true/);
});

test("model catalog and thumbnails are public API routes", () => {
  const workerIndex = readFileSync("worker/index.ts", "utf8");
  const modelsRoute = readFileSync("worker/routes/models.ts", "utf8");
  const combobox = readFileSync("src/components/ModelCombobox.tsx", "utf8");

  assert.match(workerIndex, /api\.route\("\/models", modelsRoutes\)/);
  assert.doesNotMatch(workerIndex, /authed\.route\("\/models", modelsRoutes\)/);
  assert.match(modelsRoute, /modelsRoutes\.get\("\/thumb"/);
  assert.match(combobox, /hasThumbnail/);
  assert.match(combobox, /onError/);
  assert.match(readFileSync("src/components/GenerateForm.tsx", "utf8"), /\/models\?limit=80/);
});
