import { Hono } from "hono";
import { z } from "zod";
import type { Env, AppVariables } from "../env";
import { id, now } from "../lib/ids";
import { MODELS, creditCost } from "../lib/pricing";
import { moderate } from "../lib/moderation";
import * as fal from "../providers/fal";

type AppEnv = { Bindings: Env; Variables: AppVariables };
export const generationsRoutes = new Hono<AppEnv>();

const createSchema = z.object({
  model: z.string(),
  prompt: z.string().min(1).max(4000),
  negativePrompt: z.string().max(1000).optional(),
  aspectRatio: z.string(),
  refImageUrls: z.array(z.string().url()).max(4).optional(),
  folderId: z.string().nullable().optional(),
  seed: z.number().int().optional(),
});

generationsRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = createSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "bad_request", issues: body.error.issues }, 400);

  const model = MODELS[body.data.model];
  if (!model) return c.json({ error: "unknown_model" }, 400);
  if (!model.maxAspects.includes(body.data.aspectRatio)) {
    return c.json({ error: "unsupported_aspect" }, 400);
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

  const cost = creditCost(body.data.model);
  const useFree =
    model.type === "image" && user.plan === "free" && user.free_remaining > 0;

  if (!useFree) {
    if (model.type === "video" && user.plan === "free") {
      return c.json({ error: "video_requires_paid_plan" }, 402);
    }
    if (user.credits < cost) {
      return c.json({ error: "insufficient_credits", required: cost, balance: user.credits }, 402);
    }
  }

  const genId = id("gen");
  const createdAt = now();

  // Debit atomically.
  if (useFree) {
    await c.env.DB.prepare(
      "UPDATE users SET free_remaining = free_remaining - 1 WHERE id = ? AND free_remaining > 0",
    )
      .bind(userId)
      .run();
  } else {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ?",
      ).bind(cost, userId, cost),
      c.env.DB.prepare(
        `INSERT INTO credit_ledger (id, user_id, delta, reason, created_at)
         VALUES (?, ?, ?, 'generation', ?)`,
      ).bind(id("led"), userId, -cost, createdAt),
    ]);
  }

  // Submit to fal.
  const webhookUrl = `${c.env.APP_URL}/api/webhooks/fal?gen=${genId}`;
  const falInput = fal.buildInput({
    prompt: body.data.prompt,
    negativePrompt: body.data.negativePrompt,
    aspectRatio: body.data.aspectRatio,
    refImageUrls: body.data.refImageUrls ?? [],
    seed: body.data.seed,
  });

  let submission: fal.FalSubmitResult;
  try {
    submission = await fal.submit(c.env, {
      modelEndpoint: model.id,
      input: falInput,
      webhookUrl,
    });
  } catch (e) {
    // Refund.
    if (useFree) {
      await c.env.DB.prepare(
        "UPDATE users SET free_remaining = free_remaining + 1 WHERE id = ?",
      )
        .bind(userId)
        .run();
    } else {
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE users SET credits = credits + ? WHERE id = ?").bind(cost, userId),
        c.env.DB.prepare(
          `INSERT INTO credit_ledger (id, user_id, delta, reason, created_at)
           VALUES (?, ?, ?, 'refund', ?)`,
        ).bind(id("led"), userId, cost, now()),
      ]);
    }
    return c.json({ error: "provider_submit_failed", detail: String(e) }, 502);
  }

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
      body.data.seed ?? null,
      JSON.stringify(body.data.refImageUrls ?? []),
      useFree ? 0 : cost,
      submission.requestId,
      createdAt,
    )
    .run();

  return c.json({ id: genId, status: "queued" });
});

const listSchema = z.object({
  type: z.enum(["image", "video"]).optional(),
  folderId: z.string().optional(),
  bookmarked: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
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
generationsRoutes.post("/uploads", async (c) => {
  const userId = c.get("userId");
  const contentType = c.req.header("Content-Type") ?? "application/octet-stream";
  if (!contentType.startsWith("image/")) {
    return c.json({ error: "not_an_image" }, 400);
  }
  const key = `refs/${userId}/${id("ref")}`;
  await c.env.BUCKET.put(key, c.req.raw.body, { httpMetadata: { contentType } });
  return c.json({ key, url: `${c.env.APP_URL}/api/generations/refs/${encodeURIComponent(key)}` });
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
