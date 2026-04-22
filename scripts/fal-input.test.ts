import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildInput, queueResultUrl, queueSubmitUrl } from "../worker/providers/fal";

describe("fal input shaping", () => {
  it("passes through supported generation options", () => {
    const input = buildInput({
      prompt: "A bright studio product render",
      negativePrompt: null,
      aspectRatio: "16:9",
      aspectParam: "aspect_ratio",
      refImageUrls: [],
      numImages: 3,
      supportsNumImages: true,
      resolution: "2K",
      supportsResolution: true,
      quality: "high",
      supportsQuality: true,
      seed: null,
    });

    assert.deepEqual(input, {
      prompt: "A bright studio product render",
      aspect_ratio: "16:9",
      num_images: 3,
      resolution: "2K",
      quality: "high",
    });
  });

  it("omits unsupported generation options", () => {
    const input = buildInput({
      prompt: "A quiet landscape",
      negativePrompt: null,
      aspectRatio: "1:1",
      aspectParam: "none",
      refImageUrls: [],
      numImages: 2,
      supportsNumImages: false,
      resolution: "4K",
      supportsResolution: false,
      quality: "high",
      supportsQuality: false,
      seed: null,
    });

    assert.deepEqual(input, {
      prompt: "A quiet landscape",
    });
  });
});

describe("fal queue URLs", () => {
  it("builds direct queue submit and result URLs", () => {
    assert.equal(
      queueSubmitUrl("fal-ai/flux/schnell", "https://example.com/webhook?gen=1"),
      "https://queue.fal.run/fal-ai/flux/schnell?fal_webhook=https%3A%2F%2Fexample.com%2Fwebhook%3Fgen%3D1",
    );
    assert.equal(
      queueResultUrl("fal-ai/flux/schnell", "req_123"),
      "https://queue.fal.run/fal-ai/flux/schnell/requests/req_123",
    );
  });
});
