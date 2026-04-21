import { Hono } from "hono";
import type { Env, AppVariables } from "../../env";
import { now } from "../../lib/ids";
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
    "SELECT id, user_id, type, fal_request_id FROM generations WHERE id = ?",
  )
    .bind(genId)
    .first<{ id: string; user_id: string; type: string; fal_request_id: string }>();
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

  let assetUrl: string | undefined;
  let width: number | undefined;
  let height: number | undefined;
  let duration: number | undefined;
  if (gen.type === "image") {
    const img = payload.payload?.images?.[0];
    assetUrl = img?.url;
    width = img?.width;
    height = img?.height;
  } else {
    assetUrl = payload.payload?.video?.url;
    duration = payload.payload?.video?.duration;
  }
  if (!assetUrl) {
    await c.env.DB.prepare(
      "UPDATE generations SET status = 'failed', error = 'no_asset', completed_at = ? WHERE id = ?",
    )
      .bind(now(), genId)
      .run();
    return c.json({ ok: true });
  }

  // Output moderation — check the image URL through OpenAI Moderation too.
  if (gen.type === "image") {
    const prompt = "output-image-check";
    const decision = await moderate(c.env, {
      userId: gen.user_id,
      prompt,
      imageUrls: [assetUrl],
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

  const ext = gen.type === "image" ? "png" : "mp4";
  const r2Key = `out/${gen.user_id}/${genId}.${ext}`;
  await fal.saveToR2(c.env, assetUrl, r2Key);

  await c.env.DB.prepare(
    `UPDATE generations
     SET status = 'completed', r2_key = ?, width = ?, height = ?, duration_s = ?, completed_at = ?
     WHERE id = ?`,
  )
    .bind(r2Key, width ?? null, height ?? null, duration ?? null, now(), genId)
    .run();

  return c.json({ ok: true });
});
