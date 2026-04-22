import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FREE_GENERATION_CREDIT_CAP,
  isWithinFreeGenerationCap,
} from "../worker/lib/pricing";

describe("free generation credit cap", () => {
  it("allows free image generations at or below the cap", () => {
    assert.equal(isWithinFreeGenerationCap(10), true);
    assert.equal(isWithinFreeGenerationCap(FREE_GENERATION_CREDIT_CAP), true);
  });

  it("blocks free image generations above the cap", () => {
    assert.equal(isWithinFreeGenerationCap(11), false);
  });
});
