import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("auth routes do not import catalog-backed pricing", () => {
  const auth = readFileSync("worker/routes/auth.ts", "utf8");
  const plans = readFileSync("worker/lib/plans.ts", "utf8");

  assert.match(auth, /from "\.\.\/lib\/plans"/);
  assert.doesNotMatch(auth, /from "\.\.\/lib\/pricing"/);
  assert.match(plans, /DEFAULT_FREE_GRANT/);
});

test("worker has a lightweight auth and me fast path", () => {
  const index = readFileSync("worker/index.ts", "utf8");

  assert.match(index, /getAuthApi/);
  assert.match(index, /url\.pathname\.startsWith\("\/api\/auth\/"\)/);
  assert.match(index, /url\.pathname === "\/api\/me"/);
  assert.match(index, /getFullApi/);
  assert.match(index, /await import\("\.\/routes\/generations"\)/);
  assert.match(index, /await import\("\.\/routes\/models"\)/);
  assert.doesNotMatch(index, /import \{ generationsRoutes/);
  assert.doesNotMatch(index, /import \{ modelsRoutes/);
  assert.doesNotMatch(index, /import \{ billingRoutes/);
  assert.doesNotMatch(index, /import \{ runCreditRefill \}/);
});

test("session creation is a single write on the login callback path", () => {
  const session = readFileSync("worker/auth/session.ts", "utf8");

  assert.match(session, /SESSIONS\.put\(`session:\$\{token\}`/);
  assert.doesNotMatch(session, /SESSIONS\.get\(indexKey/);
  assert.doesNotMatch(session, /user:\$\{data\.userId\}:sessions/);
});
