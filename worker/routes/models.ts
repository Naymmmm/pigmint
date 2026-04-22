import { Hono } from "hono";
import type { Context } from "hono";
import type { Env, AppVariables } from "../env";
import { MODELS } from "../lib/pricing";
import { listModelSummaries } from "../lib/model-list";

type AppEnv = { Bindings: Env; Variables: AppVariables };
export const modelsRoutes = new Hono<AppEnv>();

// Public catalog for the UI.
modelsRoutes.get("/", (c) => {
  const items = listModelSummaries({
    query: c.req.query("q"),
    limit: Number(c.req.query("limit") ?? "80"),
  });
  return c.json({ items }, 200, { "Cache-Control": "public, max-age=300" });
});

modelsRoutes.get("/search", (c) => {
  const items = listModelSummaries({
    query: c.req.query("q"),
    limit: Number(c.req.query("limit") ?? "80"),
  });
  return c.json({ items }, 200, { "Cache-Control": "public, max-age=300" });
});

modelsRoutes.get("/thumb", async (c) => serveModelThumbnail(c, c.req.query("key")));
modelsRoutes.get("/:key/thumb", async (c) => serveModelThumbnail(c, c.req.param("key")));

async function serveModelThumbnail(c: Context<AppEnv>, key?: string) {
  const model = key ? MODELS[key] : null;
  if (!model?.thumbnailUrl) return c.json({ error: "not_found" }, 404);

  const width = Math.min(Math.max(Number(c.req.query("w") ?? "64"), 24), 256);

  // Cloudflare Image Transformations: resize + format negotiate at the edge.
  // The fetch is to fal's public CDN (storage.googleapis.com), so no auth
  // forwarding needed. If Transformations isn't enabled on the zone the
  // cf.image options are silently ignored and we pass through the original.
  const upstream = await fetch(model.thumbnailUrl, {
    headers: {
      accept: c.req.header("accept") ?? "image/avif,image/webp,image/*",
      "user-agent": "Pigmint/1.0",
    },
    cf: {
      image: {
        width,
        height: width,
        format: "auto",
        quality: 78,
        fit: "cover",
      },
    },
  } as unknown as RequestInit);

  if (!upstream.ok || !upstream.body) {
    // Last-ditch: let the browser fetch fal's CDN directly.
    return c.redirect(model.thumbnailUrl, 307);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "image/webp",
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
}
