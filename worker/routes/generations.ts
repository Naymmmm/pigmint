import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import type { Env, AppVariables } from "../env";
import { id, now } from "../lib/ids";
import {
  FREE_GENERATION_CREDIT_CAP,
  MODELS,
  generationCreditCost,
  isWithinFreeGenerationCap,
} from "../lib/pricing";
import { moderate } from "../lib/moderation";
import { createSignedRefUrl, verifySignedRefUrl } from "../lib/ref-images";
import * as fal from "../providers/fal";

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

  // Moderation gate (prompt + any ref images).
  const decision = await moderate(c.env, {
    userId,
    prompt: body.data.prompt,
    imageUrls: body.data.refImageUrls,
  });
  if (!decision.allow) {
    return c.json(
      {
        error: "moderation_blocked",
        action: decision.action,
        message: decision.userMessage,
        categories: decision.categories,
        isChildSafety: decision.isChildSafety,
      },
      decision.httpStatus,
    );
  }

  // Quota / credit check.
  const user = await c.env.DB.prepare(
    "SELECT plan, free_remaining, credits FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<{ plan: string; free_remaining: number; credits: number }>();
  if (!user) return c.json({ error: "user_missing" }, 500);

  const cost = generationCreditCost(body.data.model, model.type === "image" ? numImages : 1);
  if (user.plan === "free" && !isWithinFreeGenerationCap(cost)) {
    return c.json(
      {
        error: "free_generation_credit_cap",
        cap: FREE_GENERATION_CREDIT_CAP,
        required: cost,
      },
      402,
    );
  }
  const useFree =
    model.type === "image" && user.plan === "free" && user.free_remaining >= numImages;

  if (!useFree) {
    if (model.type === "video" && user.plan === "free") {
      return c.json({ error: "video_requires_paid_plan" }, 402);
    }
    if (user.credits < cost) {
      return c.json({ error: "insufficient_credits", required: cost, balance: user.credits }, 402);
    }
  }

  // We submit N independent single-image jobs rather than one batched call.
  // Rationale: most fal models still bill per output image regardless of
  // batch param, but batching adds provider-side cost variance and ties the
  // whole request's fate together. Independent submissions give the user
  // graceful partial success + simpler refund on failure.
  const perCallCost = generationCreditCost(body.data.model, 1);
  const createdAt = now();

  // Debit the total upfront, atomically.
  if (useFree) {
    const res = await c.env.DB.prepare(
      "UPDATE users SET free_remaining = free_remaining - ? WHERE id = ? AND free_remaining >= ?",
    )
      .bind(numImages, userId, numImages)
      .run();
    if ((res.meta.changes ?? 0) === 0) {
      return c.json({ error: "insufficient_free_generations" }, 402);
    }
  } else {
    const debit = await c.env.DB.prepare(
      "UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ?",
    )
      .bind(cost, userId, cost)
      .run();
    if ((debit.meta.changes ?? 0) === 0) {
      return c.json({ error: "insufficient_credits", required: cost }, 402);
    }
    await c.env.DB.prepare(
      `INSERT INTO credit_ledger (id, user_id, delta, reason, created_at)
       VALUES (?, ?, ?, 'generation', ?)`,
    )
      .bind(id("led"), userId, -cost, createdAt)
      .run();
  }

  // Fan out: build one fal input (no num_images), submit N times in parallel,
  // insert a row per submission. Per-submission failures refund that slot
  // only; successful ones proceed.
  const baseFalInput = fal.buildInput({
    prompt: body.data.prompt,
    negativePrompt: body.data.negativePrompt,
    aspectRatio: body.data.aspectRatio,
    aspectParam: model.aspectParam,
    refImageUrls: body.data.refImageUrls ?? [],
    refImageParam: model.refImageParam,
    refImageParamKind: model.refImageParamKind,
    negativePromptParam: model.negativePromptParam,
    supportsSeed: model.supportsSeed,
    numImages: 1,
    supportsNumImages: false, // force single-image per submission
    resolution,
    supportsResolution: model.resolutionOptions.length > 0,
    quality,
    supportsQuality: model.qualityOptions.length > 0,
    seed: body.data.seed,
  });

  const genIds = Array.from({ length: numImages }, () => id("gen"));
  const refImageJson = JSON.stringify(body.data.refImageUrls ?? []);

  const results = await Promise.all(
    genIds.map(async (genId, index) => {
      // If the user passed a seed, increment it per submission so each
      // output is distinct. If no seed, fal will randomize anyway.
      const seed =
        body.data.seed != null ? body.data.seed + index : undefined;
      const input = seed != null ? { ...baseFalInput, seed } : baseFalInput;
      const webhookUrl = `${c.env.APP_URL}/api/webhooks/fal?gen=${genId}`;
      try {
        const submission = await fal.submit(c.env, {
          modelEndpoint: model.endpoint,
          input,
          webhookUrl,
        });
        await c.env.DB.prepare(
          `INSERT INTO generations
             (id, user_id, folder_id, type, status, prompt, negative_prompt, model,
              aspect_ratio, seed, ref_image_urls, credit_cost, fal_request_id, created_at)
           VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            genId,
            userId,
            body.data.folderId ?? null,
            model.type,
            body.data.prompt,
            body.data.negativePrompt ?? null,
            body.data.model,
            body.data.aspectRatio,
            seed ?? null,
            refImageJson,
            useFree ? 0 : perCallCost,
            submission.requestId,
            createdAt,
          )
          .run();
        return { ok: true as const, id: genId };
      } catch (e) {
        return { ok: false as const, id: genId, error: String(e) };
      }
    }),
  );

  const succeeded = results.filter((r) => r.ok) as Array<{ ok: true; id: string }>;
  const failed = results.filter((r) => !r.ok) as Array<{
    ok: false;
    id: string;
    error: string;
  }>;

  // Refund the failed slots only.
  if (failed.length > 0) {
    if (useFree) {
      await c.env.DB.prepare(
        "UPDATE users SET free_remaining = free_remaining + ? WHERE id = ?",
      )
        .bind(failed.length, userId)
        .run();
    } else {
      const refundAmount = perCallCost * failed.length;
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE users SET credits = credits + ? WHERE id = ?").bind(
          refundAmount,
          userId,
        ),
        c.env.DB.prepare(
          `INSERT INTO credit_ledger (id, user_id, delta, reason, created_at)
           VALUES (?, ?, ?, 'refund', ?)`,
        ).bind(id("led"), userId, refundAmount, now()),
      ]);
    }
  }

  if (succeeded.length === 0) {
    return c.json(
      {
        error: "provider_submit_failed",
        detail: failed[0]?.error ?? "unknown",
      },
      502,
    );
  }

  return c.json({
    ids: succeeded.map((s) => s.id),
    submitted: succeeded.length,
    failed: failed.length,
    // Backwards-compat: some callers still read `.id`.
    id: succeeded[0].id,
    status: "queued",
  });
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
           g.folder_id, g.created_at, g.completed_at
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
