import { Hono } from "hono";
import type { Env, AppVariables } from "../../env";
import { id, now } from "../../lib/ids";
import * as fal from "../../providers/fal";
import { moderate } from "../../lib/moderation";

type AppEnv = { Bindings: Env; Variables: AppVariables };
export const falWebhook = new Hono<AppEnv>();

interface FalWebhookPayload {
  request_id: string;
  status: "OK" | "ERROR";
  payload?: {
    images?: Array<{ url: string; width?: number; height?: number }>;
    video?: { url: string; duration?: number };
    seed?: number;
    has_nsfw_concepts?: boolean[];
  };
  error?: string;
}

falWebhook.post("/", async (c) => {
  const rawBody = await c.req.text();
  const ok = await fal.verifyWebhook(c.env, c.req.raw, rawBody);
  if (!ok) return c.json({ error: "invalid_signature" }, 401);

  const payload = JSON.parse(rawBody) as FalWebhookPayload;
  const genId = new URL(c.req.url).searchParams.get("gen");
  if (!genId) return c.json({ error: "missing_gen_id" }, 400);

  const gen = await c.env.DB.prepare(
    `SELECT id, user_id, folder_id, type, prompt, negative_prompt, model,
            aspect_ratio, seed, ref_image_urls, credit_cost, fal_request_id
     FROM generations WHERE id = ?`,
  )
    .bind(genId)
    .first<{
      id: string;
      user_id: string;
      folder_id: string | null;
      type: string;
      prompt: string;
      negative_prompt: string | null;
      model: string;
      aspect_ratio: string;
      seed: number | null;
      ref_image_urls: string | null;
      credit_cost: number;
      fal_request_id: string;
    }>();
  if (!gen) return c.json({ error: "unknown_generation" }, 404);
  if (gen.fal_request_id !== payload.request_id)
    return c.json({ error: "request_id_mismatch" }, 400);

  if (payload.status === "ERROR") {
    await c.env.DB.prepare(
      "UPDATE generations SET status = 'failed', error = ?, completed_at = ? WHERE id = ?",
    )
      .bind(payload.error ?? "unknown", now(), genId)
      .run();
    return c.json({ ok: true });
  }

  if (gen.type === "image") {
    const images = payload.payload?.images ?? [];
    if (images.length === 0) {
      await c.env.DB.prepare(
        "UPDATE generations SET status = 'failed', error = 'no_asset', completed_at = ? WHERE id = ?",
      )
        .bind(now(), genId)
        .run();
      return c.json({ ok: true });
    }

    for (const img of images) {
      const decision = await moderate(c.env, {
        userId: gen.user_id,
        prompt: "output-image-check",
        imageUrls: [img.url],
        generationId: genId,
      });
      if (!decision.allow) {
        await c.env.DB.prepare(
          "UPDATE generations SET status = 'failed', error = 'output_blocked', completed_at = ? WHERE id = ?",
        )
          .bind(now(), genId)
          .run();
        return c.json({ ok: true, blocked: true });
      }
    }

    const completedAt = now();
    for (let index = 0; index < images.length; index++) {
      const img = images[index];
      const rowId = index === 0 ? genId : id("gen");
      const r2Key = `out/${gen.user_id}/${rowId}.png`;
      await fal.saveToR2(c.env, img.url, r2Key);

      if (index === 0) {
        await c.env.DB.prepare(
          `UPDATE generations
           SET status = 'completed', r2_key = ?, width = ?, height = ?, completed_at = ?
           WHERE id = ?`,
        )
          .bind(r2Key, img.width ?? null, img.height ?? null, completedAt, genId)
          .run();
      } else {
        await c.env.DB.prepare(
          `INSERT INTO generations
             (id, user_id, folder_id, type, status, prompt, negative_prompt, model,
              aspect_ratio, seed, ref_image_urls, credit_cost, fal_request_id, r2_key,
              width, height, created_at, completed_at)
           VALUES (?, ?, ?, 'image', 'completed', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            rowId,
            gen.user_id,
            gen.folder_id,
            gen.prompt,
            gen.negative_prompt,
            gen.model,
            gen.aspect_ratio,
            gen.seed,
            gen.ref_image_urls,
            gen.fal_request_id,
            r2Key,
            img.width ?? null,
            img.height ?? null,
            completedAt,
            completedAt,
          )
          .run();
      }
    }

    return c.json({ ok: true });
  }

  const assetUrl = payload.payload?.video?.url;
  const duration = payload.payload?.video?.duration;
  if (!assetUrl) {
    await c.env.DB.prepare(
      "UPDATE generations SET status = 'failed', error = 'no_asset', completed_at = ? WHERE id = ?",
    )
      .bind(now(), genId)
      .run();
    return c.json({ ok: true });
  }

  const r2Key = `out/${gen.user_id}/${genId}.mp4`;
  await fal.saveToR2(c.env, assetUrl, r2Key);

  await c.env.DB.prepare(
    `UPDATE generations
     SET status = 'completed', r2_key = ?, duration_s = ?, completed_at = ?
     WHERE id = ?`,
  )
    .bind(r2Key, duration ?? null, now(), genId)
    .run();

  return c.json({ ok: true });
});
