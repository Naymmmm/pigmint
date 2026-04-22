import { Hono } from "hono";
import type { Env, AppVariables } from "../env";
import { MODELS } from "../lib/pricing";

type AppEnv = { Bindings: Env; Variables: AppVariables };
export const modelsRoutes = new Hono<AppEnv>();

// Public catalog for the UI. fal cost is intentionally NOT exposed.
modelsRoutes.get("/", (c) => {
  const items = Object.values(MODELS).map((m) => ({
    key: m.key,
    label: m.label,
    description: m.description,
    thumbnailUrl: m.thumbnailUrl,
    type: m.type,
    category: m.category,
    credits: m.credits,
    aspects: m.aspects,
    defaultAspect: m.defaultAspect,
    supportsRefImages: m.supportsRefImages,
    requiresRefImage: m.requiresRefImage,
    numImagesOptions: m.numImagesOptions,
    defaultNumImages: m.defaultNumImages,
    resolutionOptions: m.resolutionOptions,
    defaultResolution: m.defaultResolution,
    qualityOptions: m.qualityOptions,
    defaultQuality: m.defaultQuality,
    isFeatured: m.isFeatured,
    featuredRank: m.featuredRank,
  }));
  return c.json({ items });
});

modelsRoutes.get("/:key/thumb", async (c) => {
  const model = MODELS[c.req.param("key")];
  if (!model?.thumbnailUrl) return c.json({ error: "not_found" }, 404);

  const width = Math.min(Math.max(Number(c.req.query("w") ?? "64"), 24), 256);
  const upstream = await fetch(model.thumbnailUrl, {
    headers: {
      accept: "image/webp,image/*",
    },
    cf: {
      image: {
        width,
        height: width,
        fit: "cover",
        format: "webp",
        quality: 72,
      },
      cacheEverything: true,
      cacheTtl: 604800,
    },
  } as unknown as RequestInit);

  if (!upstream.ok || !upstream.body) return c.json({ error: "thumbnail_failed" }, 502);

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "image/webp",
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
});
