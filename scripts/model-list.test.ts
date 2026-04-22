import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import test from "node:test";

import { listModelSummaries } from "../worker/lib/model-list";

test("initial model list is compact and limited", () => {
  const items = listModelSummaries({ limit: 80 });
  const payload = JSON.stringify({ items });

  assert.ok(items.length <= 80);
  assert.ok(items.some((item) => item.key === "flux-schnell"));
  assert.ok(items.some((item) => item.isFeatured));
  assert.ok(!("description" in items[0]));
  assert.ok(!("thumbnailUrl" in items[0]));
  assert.ok(gzipSync(payload).length < 10_000);
});

test("model search finds catalog entries outside the initial list", () => {
  const initial = listModelSummaries({ limit: 10 });
  const matches = listModelSummaries({ query: "gpt image 2 edit", limit: 10 });

  assert.ok(initial.length <= 10);
  assert.ok(matches.some((item) => item.key === "gpt-image-2-edit"));
  assert.ok(matches.length <= 10);
});
