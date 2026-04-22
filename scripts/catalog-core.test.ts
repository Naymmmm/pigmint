import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCatalogModel,
  isGenerationCategory,
  isModelCatalogCompatible,
  slugKey,
} from "./catalog-core";

const baseMetadata = {
  display_name: "Example Model",
  description: "Example description",
  status: "active",
  thumbnail_url: "https://example.com/thumb.jpg",
};

describe("catalog model derivation", () => {
  it("keeps active image and video generation categories only", () => {
    assert.equal(isGenerationCategory("text-to-image"), true);
    assert.equal(isGenerationCategory("image-to-video"), true);
    assert.equal(isGenerationCategory("text-to-audio"), false);
    assert.equal(isGenerationCategory("vision"), false);
  });

  it("rejects generation category models without prompt inputs", () => {
    assert.equal(
      isModelCatalogCompatible({
        endpoint_id: "fal-ai/example/upscaler",
        metadata: { ...baseMetadata, category: "image-to-image" },
        openapi: {
          components: {
            schemas: {
              ExampleInput: {
                required: ["image_url"],
                properties: {
                  image_url: { type: "string" },
                },
              },
            },
          },
        },
      }),
      false,
    );
  });

  it("derives image aspect_ratio models from OpenAPI schema and pricing", () => {
    const model = buildCatalogModel(
      {
        endpoint_id: "fal-ai/example/image",
        metadata: {
          ...baseMetadata,
          category: "text-to-image",
        },
        openapi: {
          components: {
            schemas: {
              ExampleInput: {
                required: ["prompt"],
                properties: {
                  prompt: { type: "string" },
                  aspect_ratio: {
                    default: "16:9",
                    enum: ["16:9", "9:16", "1:1"],
                  },
                  negative_prompt: { type: "string" },
                  seed: { type: "integer" },
                  num_images: {
                    minimum: 1,
                    maximum: 4,
                    default: 2,
                    type: "integer",
                  },
                  resolution: {
                    default: "1K",
                    enum: ["1K", "2K"],
                    type: "string",
                  },
                  quality: {
                    default: "high",
                    enum: ["low", "medium", "high"],
                    type: "string",
                  },
                },
              },
            },
          },
        },
      },
      {
        endpoint_id: "fal-ai/example/image",
        unit_price: 0.03,
        unit: "images",
        currency: "USD",
      },
    );

    assert.deepEqual(model, {
      key: "example-image",
      endpoint: "fal-ai/example/image",
      displayName: "Example Model",
      description: "Example description",
      category: "text-to-image",
      status: "active",
      thumbnailUrl: "https://example.com/thumb.jpg",
      type: "image",
      aspects: ["16:9", "9:16", "1:1"],
      defaultAspect: "16:9",
      supportsRefImages: false,
      requiresRefImage: false,
      aspectParam: "aspect_ratio",
      refImageParam: null,
      refImageParamKind: null,
      negativePromptParam: "negative_prompt",
      supportsSeed: true,
      numImagesOptions: [1, 2, 3, 4],
      defaultNumImages: 2,
      resolutionOptions: ["1K", "2K"],
      defaultResolution: "1K",
      qualityOptions: ["low", "medium", "high"],
      defaultQuality: "high",
      isFeatured: false,
      featuredRank: null,
      pricingUnit: "images",
      pricingUnitPrice: 0.03,
      falCostUsd: 0.03,
      credits: 3,
    });
  });

  it("derives required image-to-video start image mapping", () => {
    const model = buildCatalogModel(
      {
        endpoint_id: "fal-ai/example/image-to-video",
        metadata: {
          ...baseMetadata,
          category: "image-to-video",
        },
        openapi: {
          components: {
            schemas: {
              ExampleInput: {
                required: ["prompt", "start_image_url"],
                properties: {
                  prompt: { type: "string" },
                  start_image_url: {
                    type: "string",
                    _fal_ui_field: "image",
                  },
                  duration: {
                    enum: ["5", "10"],
                    default: "5",
                  },
                },
              },
            },
          },
        },
      },
      {
        endpoint_id: "fal-ai/example/image-to-video",
        unit_price: 0.05,
        unit: "seconds",
        currency: "USD",
      },
    );

    assert.equal(model.type, "video");
    assert.equal(model.defaultAspect, "16:9");
    assert.deepEqual(model.aspects, ["16:9", "9:16", "1:1"]);
    assert.equal(model.supportsRefImages, true);
    assert.equal(model.requiresRefImage, true);
    assert.equal(model.refImageParam, "start_image_url");
    assert.equal(model.refImageParamKind, "single");
    assert.equal(model.falCostUsd, 0.25);
    assert.equal(model.credits, 25);
  });

  it("marks pinned and highlighted models as featured", () => {
    const model = buildCatalogModel(
      {
        endpoint_id: "fal-ai/example/featured",
        metadata: {
          ...baseMetadata,
          category: "text-to-video",
          pinned: true,
          highlighted: true,
        },
        openapi: {
          components: {
            schemas: {
              ExampleInput: {
                required: ["prompt"],
                properties: {
                  prompt: { type: "string" },
                },
              },
            },
          },
        },
      },
      {
        endpoint_id: "fal-ai/example/featured",
        unit_price: 0.2,
        unit: "videos",
        currency: "USD",
      },
    );

    assert.equal(model.isFeatured, true);
    assert.equal(model.featuredRank, 0);
  });

  it("derives metadata from OpenAPI x-fal-metadata when top-level metadata is missing", () => {
    const model = buildCatalogModel(
      {
        endpoint_id: "fal-ai/gpt-image-2",
        openapi: {
          info: {
            "x-fal-metadata": {
              category: "text-to-image",
              thumbnailUrl: "https://example.com/gpt-image-2.jpg",
            },
          },
          components: {
            schemas: {
              GptImage2Input: {
                required: ["prompt"],
                properties: {
                  prompt: { type: "string" },
                  image_size: {
                    default: "landscape_4_3",
                    anyOf: [
                      {
                        enum: ["square_hd", "landscape_4_3"],
                        type: "string",
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
      {
        endpoint_id: "fal-ai/gpt-image-2",
        unit_price: 1,
        unit: "units",
        currency: "USD",
      },
    );

    assert.equal(model.key, "gpt-image-2");
    assert.equal(model.displayName, "GPT Image 2");
    assert.equal(model.category, "text-to-image");
    assert.equal(model.thumbnailUrl, "https://example.com/gpt-image-2.jpg");
    assert.equal(model.isFeatured, true);
  });

  it("uses full endpoint path for OpenAPI fallback display names", () => {
    const model = buildCatalogModel(
      {
        endpoint_id: "fal-ai/gpt-image-2/edit",
        openapi: {
          info: {
            "x-fal-metadata": {
              category: "image-to-image",
              thumbnailUrl: "https://example.com/gpt-image-2-edit.jpg",
            },
          },
          components: {
            schemas: {
              GptImage2EditInput: {
                required: ["prompt", "image_urls"],
                properties: {
                  prompt: { type: "string" },
                  image_urls: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
      },
      {
        endpoint_id: "fal-ai/gpt-image-2/edit",
        unit_price: 1,
        unit: "units",
        currency: "USD",
      },
    );

    assert.equal(model.displayName, "GPT Image 2 Edit");
  });
});

describe("slugKey", () => {
  it("removes known provider prefixes and normalizes slashes", () => {
    assert.equal(slugKey("fal-ai/flux/dev"), "flux-dev");
    assert.equal(
      slugKey("bytedance/seedance-2.0/fast/text-to-video"),
      "bytedance-seedance-2.0-fast-text-to-video",
    );
  });
});
