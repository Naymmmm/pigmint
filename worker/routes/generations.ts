import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import type { Env, AppVariables } from "../env";
import { id } from "../lib/ids";
import { MODELS } from "../lib/pricing";
import { createSignedRefUrl, verifySignedRefUrl } from "../lib/ref-images";
import { runSubmission } from "../lib/submit-generation";

type AppEnv = { Bindings: Env; Variables: AppVariables };
export const generationsRoutes = new Hono<AppEnv>();

export async function serveSignedGenerationRef(c: Context<AppEnv>): Promise<Response> {
  const rawKey = c.req.param("key");
  if (!rawKey) return c.json({ error: "bad_request" }, 400);
  const key = decodeURIComponent(rawKey);
  const ok = await verifySignedRefUrl(
    c.env,
    key,
    c.req.query("exp"),
    c.req.query("sig"),
  );
  if (!ok) return c.json({ error: "forbidden" }, 403);

  const obj = await c.env.BUCKET.get(key);
  if (!obj) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=86400",
    },
  });
}

const createSchema = z.object({
  model: z.string(),
  prompt: z.string().min(1).max(4000),
  negativePrompt: z.string().max(1000).optional(),
  aspectRatio: z.string(),
  refImageUrls: z.array(z.string().url()).max(4).optional(),
  folderId: z.string().nullable().optional(),
  seed: z.number().int().optional(),
  numImages: z.number().int().min(1).max(8).optional(),
  resolution: z.string().optional(),
  quality: z.string().optional(),
});

generationsRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = createSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "bad_request", issues: body.error.issues }, 400);

  const model = MODELS[body.data.model];
  if (!model) return c.json({ error: "unknown_model" }, 400);
  if (!model.aspects.includes(body.data.aspectRatio)) {
    return c.json({ error: "unsupported_aspect" }, 400);
  }
  if (model.requiresRefImage && (body.data.refImageUrls?.length ?? 0) === 0) {
    return c.json({ error: "reference_image_required" }, 400);
  }
  const numImages = body.data.numImages ?? model.defaultNumImages ?? 1;
  if (
    body.data.numImages != null &&
    !model.numImagesOptions.includes(body.data.numImages)
  ) {
    return c.json({ error: "unsupported_num_images" }, 400);
  }
  const resolution = body.data.resolution ?? model.defaultResolution ?? null;
  if (
    body.data.resolution &&
    !model.resolutionOptions.includes(body.data.resolution)
  ) {
    return c.json({ error: "unsupported_resolution" }, 400);
  }
  const quality = body.data.quality ?? model.defaultQuality ?? null;
  if (body.data.quality && !model.qualityOptions.includes(body.data.quality)) {
    return c.json({ error: "unsupported_quality" }, 400);
  }

  const outcome = await runSubmission(c.env, {
    userId,
    folderId: body.data.folderId ?? null,
    model,
    modelKey: body.data.model,
    prompt: body.data.prompt,
    negativePrompt: body.data.negativePrompt ?? null,
    aspectRatio: body.data.aspectRatio,
    refImageUrls: body.data.refImageUrls ?? [],
    seed: body.data.seed,
    numImages,
    resolution,
    quality,
  });
  if (!outcome.ok) return c.json(outcome.body, outcome.status as 400 | 402 | 500 | 502);
  return c.json({
    ids: outcome.ids,
    submitted: outcome.submitted,
    failed: outcome.failed,
    id: outcome.ids[0],
    status: "queued",
  });
});

// Regenerate: fan out N new variants of an existing generation using the
// same model + prompt + aspect + refs. Variants link back to the parent
// chain via parent_generation_id so the UI can show a variant strip.
const regenerateSchema = z.object({
  numImages: z.number().int().min(1).max(8).optional(),
  seed: z.number().int().optional(),
});

generationsRoutes.post("/:id/regenerate", async (c) => {
  const userId = c.get("userId");
  const body = regenerateSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "bad_request" }, 400);

  const parent = await c.env.DB.prepare(
    `SELECT id, parent_generation_id, model, prompt, negative_prompt, aspect_ratio,
            ref_image_urls, folder_id, variant_index
     FROM generations WHERE id = ? AND user_id = ?`,
  )
    .bind(c.req.param("id"), userId)
    .first<{
      id: string;
      parent_generation_id: string | null;
      model: string;
      prompt: string;
      negative_prompt: string | null;
      aspect_ratio: string;
      ref_image_urls: string | null;
      folder_id: string | null;
      variant_index: number;
    }>();
  if (!parent) return c.json({ error: "not_found" }, 404);

  const model = MODELS[parent.model];
  if (!model) return c.json({ error: "unknown_model" }, 400);

  // Keep the lineage root as the first-ever generation in the chain so
  // siblings share a single parent_generation_id key.
  const rootId = parent.parent_generation_id ?? parent.id;
  const numImages = body.data.numImages ?? 1;
  if (!model.numImagesOptions.includes(numImages) && numImages !== 1) {
    return c.json({ error: "unsupported_num_images" }, 400);
  }
  const refs = parent.ref_image_urls
    ? (JSON.parse(parent.ref_image_urls) as string[])
    : [];

  // Find the next free variant_index in this lineage.
  const maxRow = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(variant_index), -1) AS mx
     FROM generations WHERE user_id = ? AND (id = ? OR parent_generation_id = ?)`,
  )
    .bind(userId, rootId, rootId)
    .first<{ mx: number }>();
  const nextIndex = (maxRow?.mx ?? -1) + 1;

  const outcome = await runSubmission(c.env, {
    userId,
    folderId: parent.folder_id,
    model,
    modelKey: parent.model,
    prompt: parent.prompt,
    negativePrompt: parent.negative_prompt,
    aspectRatio: parent.aspect_ratio,
    refImageUrls: refs,
    seed: body.data.seed,
    numImages,
    resolution: model.defaultResolution,
    quality: model.defaultQuality,
    parentGenerationId: rootId,
    variantIndexStart: nextIndex,
    skipModeration: true, // prompt already passed moderation at original submit
  });
  if (!outcome.ok) return c.json(outcome.body, outcome.status as 400 | 402 | 500 | 502);
  return c.json({
    ids: outcome.ids,
    submitted: outcome.submitted,
    failed: outcome.failed,
    id: outcome.ids[0],
    parentGenerationId: rootId,
    status: "queued",
  });
});

// Variant strip: return every generation in the same lineage (the root + its
// children), ordered by variant_index. Used by the detail + compare views.
generationsRoutes.get("/:id/variants", async (c) => {
  const userId = c.get("userId");
  const genId = c.req.param("id");
  const self = await c.env.DB.prepare(
    "SELECT id, parent_generation_id FROM generations WHERE id = ? AND user_id = ?",
  )
    .bind(genId, userId)
    .first<{ id: string; parent_generation_id: string | null }>();
  if (!self) return c.json({ error: "not_found" }, 404);
  const rootId = self.parent_generation_id ?? self.id;
  const { results } = await c.env.DB.prepare(
    `SELECT id, type, status, prompt, model, aspect_ratio, r2_key, thumb_r2_key,
            width, height, duration_s, folder_id, parent_generation_id,
            variant_index, created_at, completed_at
     FROM generations
     WHERE user_id = ? AND (id = ? OR parent_generation_id = ?)
     ORDER BY variant_index ASC`,
  )
    .bind(userId, rootId, rootId)
    .all();
  return c.json({ rootId, items: results });
});

const listSchema = z.object({
  type: z.enum(["image", "video"]).optional(),
  folderId: z.string().optional(),
  bookmarked: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  cursor: z.coerce.number().int().optional(),
});

generationsRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const q = listSchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!q.success) return c.json({ error: "bad_query" }, 400);
  const { type, folderId, bookmarked, limit, cursor } = q.data;

  const where: string[] = ["g.user_id = ?"];
  const args: unknown[] = [userId];
  if (type) { where.push("g.type = ?"); args.push(type); }
  if (folderId) { where.push("g.folder_id = ?"); args.push(folderId); }
  if (cursor) { where.push("g.created_at < ?"); args.push(cursor); }
  const join = bookmarked
    ? "INNER JOIN bookmarks b ON b.generation_id = g.id AND b.user_id = g.user_id"
    : "";

  const sql = `
    SELECT g.id, g.type, g.status, g.prompt, g.model, g.aspect_ratio,
           g.r2_key, g.thumb_r2_key, g.width, g.height, g.duration_s,
           g.folder_id, g.parent_generation_id, g.variant_index,
           g.created_at, g.completed_at
    FROM generations g ${join}
    WHERE ${where.join(" AND ")}
    ORDER BY g.created_at DESC
    LIMIT ?`;
  args.push(limit);

  const { results } = await c.env.DB.prepare(sql).bind(...args).all();
  return c.json({ items: results, nextCursor: results.length === limit ? (results[results.length - 1] as { created_at: number }).created_at : null });
});

generationsRoutes.get("/:id", async (c) => {
  const userId = c.get("userId");
  const row = await c.env.DB.prepare(
    "SELECT * FROM generations WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), userId)
    .first();
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(row);
});

// Gallery thumbnails via Cloudflare Image Transformations.
// Fetches our own /asset endpoint with cf.image options; the edge resizes and
// transcodes to WebP/AVIF based on the browser's Accept header. Image
// Transformations must be enabled on the zone (cf.image is silently ignored
// otherwise, in which case we pass through the original).
generationsRoutes.get("/:id/thumb", async (c) => {
  const userId = c.get("userId");
  const genId = c.req.param("id");
  const row = await c.env.DB.prepare(
    "SELECT r2_key, type FROM generations WHERE id = ? AND user_id = ?",
  )
    .bind(genId, userId)
    .first<{ r2_key: string | null; type: string }>();
  if (!row?.r2_key) return c.json({ error: "not_ready" }, 404);
  if (row.type !== "image") {
    // Videos: no transformation, just redirect to the original asset.
    return c.redirect(`/api/generations/${genId}/asset`);
  }

  const width = Math.min(
    Math.max(Number(c.req.query("w") ?? "400"), 80),
    1600,
  );
  const assetUrl = `${c.env.APP_URL}/api/generations/${genId}/asset`;

  const upstream = await fetch(assetUrl, {
    headers: {
      cookie: c.req.header("cookie") ?? "",
      accept: c.req.header("accept") ?? "image/avif,image/webp,image/*",
    },
    cf: {
      image: {
        width,
        format: "auto",
        quality: 82,
        fit: "scale-down",
        "origin-auth": "share-publicly",
      },
    },
  } as unknown as RequestInit);

  if (!upstream.ok) {
    return c.redirect(`/api/generations/${genId}/asset`, 307);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "image/webp",
      "Cache-Control": "private, max-age=86400",
    },
  });
});

generationsRoutes.get("/:id/asset", async (c) => {
  const userId = c.get("userId");
  const row = await c.env.DB.prepare(
    "SELECT r2_key FROM generations WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), userId)
    .first<{ r2_key: string | null }>();
  if (!row?.r2_key) return c.json({ error: "not_ready" }, 404);
  const obj = await c.env.BUCKET.get(row.r2_key);
  if (!obj) return c.json({ error: "missing" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
});

generationsRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const body = z
    .object({ folderId: z.string().nullable().optional() })
    .safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "bad_request" }, 400);
  await c.env.DB.prepare(
    "UPDATE generations SET folder_id = ? WHERE id = ? AND user_id = ?",
  )
    .bind(body.data.folderId ?? null, c.req.param("id"), userId)
    .run();
  return c.json({ ok: true });
});

generationsRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const row = await c.env.DB.prepare(
    "SELECT r2_key, thumb_r2_key FROM generations WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), userId)
    .first<{ r2_key: string | null; thumb_r2_key: string | null }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (row.r2_key) await c.env.BUCKET.delete(row.r2_key);
  if (row.thumb_r2_key) await c.env.BUCKET.delete(row.thumb_r2_key);
  await c.env.DB.prepare("DELETE FROM generations WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .run();
  return c.json({ ok: true });
});

// Upload a ref image (client PUTs directly here; stored in R2 under user's prefix).
const MAX_REF_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_REF_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

generationsRoutes.post("/uploads", async (c) => {
  const userId = c.get("userId");
  const contentType = (c.req.header("Content-Type") ?? "").split(";")[0].trim();
  if (!ALLOWED_REF_TYPES.has(contentType)) {
    return c.json({ error: "unsupported_media_type" }, 415);
  }
  const contentLength = Number(c.req.header("Content-Length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    return c.json({ error: "missing_content_length" }, 411);
  }
  if (contentLength > MAX_REF_UPLOAD_BYTES) {
    return c.json({ error: "payload_too_large", maxBytes: MAX_REF_UPLOAD_BYTES }, 413);
  }

  // Buffer + re-check actual bytes to defend against a lying Content-Length.
  const buf = await c.req.raw.arrayBuffer();
  if (buf.byteLength > MAX_REF_UPLOAD_BYTES) {
    return c.json({ error: "payload_too_large", maxBytes: MAX_REF_UPLOAD_BYTES }, 413);
  }

  const key = `refs/${userId}/${id("ref")}`;
  await c.env.BUCKET.put(key, buf, { httpMetadata: { contentType } });
  return c.json({ key, url: await createSignedRefUrl(c.env, key) });
});

generationsRoutes.get("/refs/:key{.+}", async (c) => {
  const userId = c.get("userId");
  const key = decodeURIComponent(c.req.param("key"));
  if (!key.startsWith(`refs/${userId}/`)) return c.json({ error: "forbidden" }, 403);
  const obj = await c.env.BUCKET.get(key);
  if (!obj) return c.json({ error: "not_found" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
    },
  });
});
