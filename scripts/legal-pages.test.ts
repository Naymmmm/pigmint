import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { legalPages } from "../src/lib/legal";

test("legal pages expose terms and privacy content", () => {
  assert.deepEqual(
    legalPages.map((page) => page.slug),
    ["terms", "privacy"],
  );

  for (const page of legalPages) {
    assert.match(page.effectiveDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(page.title.length > 0);
    assert.ok(page.summary.length > 0);
    assert.ok(page.sections.length >= 6);
    assert.ok(page.sections.every((section) => section.heading && section.body.length > 0));
  }
});

test("legal pages are public routes linked from public and authenticated UI", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  const landing = readFileSync("src/routes/Landing.tsx", "utf8");
  const shell = readFileSync("src/components/AppShell.tsx", "utf8");

  assert.match(app, /path="\/terms"/);
  assert.match(app, /path="\/privacy"/);
  assert.match(landing, /to="\/terms"/);
  assert.match(landing, /to="\/privacy"/);
  assert.match(shell, /to="\/terms"/);
  assert.match(shell, /to="\/privacy"/);
});
