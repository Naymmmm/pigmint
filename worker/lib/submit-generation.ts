import type { Env } from "../env";
import { id, now } from "./ids";
import {
  FREE_GENERATION_CREDIT_CAP,
  type ModelSpec,
  generationCreditCost,
  isWithinFreeGenerationCap,
} from "./pricing";
import { moderate } from "./moderation";
import * as fal from "../providers/fal";

export interface SubmitInputs {
  userId: string;
  folderId: string | null;
  model: ModelSpec;
  modelKey: string;
  prompt: string;
  negativePrompt: string | null;
  aspectRatio: string;
  refImageUrls: string[];
  seed: number | undefined;
  numImages: number;
  resolution: string | null;
  quality: string | null;
  // Linkage for variants produced by /regenerate. When set, each new row
  // inherits parentGenerationId and takes a fresh variant_index.
  parentGenerationId?: string | null;
  variantIndexStart?: number;
  skipModeration?: boolean;
}

export type SubmitOutcome =
  | { ok: true; ids: string[]; submitted: number; failed: number }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Shared submission pipeline used by POST /generations and regenerate.
 * Handles moderation, quota/credit debit, fan-out to fal, row inserts,
 * and per-slot refund on failure. Callers are expected to validate
 * model/aspect/options up front.
 */
export async function runSubmission(
  env: Env,
  p: SubmitInputs,
): Promise<SubmitOutcome> {
  if (!p.skipModeration) {
    const decision = await moderate(env, {
      userId: p.userId,
      prompt: p.prompt,
      imageUrls: p.refImageUrls,
    });
    if (!decision.allow) {
      return {
        ok: false,
        status: decision.httpStatus,
        body: {
          error: "moderation_blocked",
          action: decision.action,
          message: decision.userMessage,
          categories: decision.categories,
          isChildSafety: decision.isChildSafety,
        },
      };
    }
  }

  const user = await env.DB.prepare(
    "SELECT plan, free_remaining, credits FROM users WHERE id = ?",
  )
    .bind(p.userId)
    .first<{ plan: string; free_remaining: number; credits: number }>();
  if (!user) return { ok: false, status: 500, body: { error: "user_missing" } };

  const cost = generationCreditCost(
    p.modelKey,
    p.model.type === "image" ? p.numImages : 1,
  );
  if (user.plan === "free" && !isWithinFreeGenerationCap(cost)) {
    return {
      ok: false,
      status: 402,
      body: {
        error: "free_generation_credit_cap",
        cap: FREE_GENERATION_CREDIT_CAP,
        required: cost,
      },
    };
  }
  const useFree =
    p.model.type === "image" &&
    user.plan === "free" &&
    user.free_remaining >= p.numImages;

  if (!useFree) {
    if (p.model.type === "video" && user.plan === "free") {
      return { ok: false, status: 402, body: { error: "video_requires_paid_plan" } };
    }
    if (user.credits < cost) {
      return {
        ok: false,
        status: 402,
        body: { error: "insufficient_credits", required: cost, balance: user.credits },
      };
    }
  }

  const perCallCost = generationCreditCost(p.modelKey, 1);
  const createdAt = now();

  if (useFree) {
    const res = await env.DB.prepare(
      "UPDATE users SET free_remaining = free_remaining - ? WHERE id = ? AND free_remaining >= ?",
    )
      .bind(p.numImages, p.userId, p.numImages)
      .run();
    if ((res.meta.changes ?? 0) === 0) {
      return { ok: false, status: 402, body: { error: "insufficient_free_generations" } };
    }
  } else {
    const debit = await env.DB.prepare(
      "UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ?",
    )
      .bind(cost, p.userId, cost)
      .run();
    if ((debit.meta.changes ?? 0) === 0) {
      return { ok: false, status: 402, body: { error: "insufficient_credits", required: cost } };
    }
    await env.DB.prepare(
      `INSERT INTO credit_ledger (id, user_id, delta, reason, created_at)
       VALUES (?, ?, ?, 'generation', ?)`,
    )
      .bind(id("led"), p.userId, -cost, createdAt)
      .run();
  }

  const baseFalInput = fal.buildInput({
    prompt: p.prompt,
    negativePrompt: p.negativePrompt ?? undefined,
    aspectRatio: p.aspectRatio,
    aspectParam: p.model.aspectParam,
    refImageUrls: p.refImageUrls,
    refImageParam: p.model.refImageParam,
    refImageParamKind: p.model.refImageParamKind,
    negativePromptParam: p.model.negativePromptParam,
    supportsSeed: p.model.supportsSeed,
    numImages: 1,
    supportsNumImages: false,
    resolution: p.resolution,
    supportsResolution: p.model.resolutionOptions.length > 0,
    quality: p.quality,
    supportsQuality: p.model.qualityOptions.length > 0,
    seed: p.seed,
  });

  const genIds = Array.from({ length: p.numImages }, () => id("gen"));
  const refImageJson = JSON.stringify(p.refImageUrls);
  const variantStart = p.variantIndexStart ?? 0;
  const parentGenerationId = p.parentGenerationId ?? null;

  const results = await Promise.all(
    genIds.map(async (genId, index) => {
      const seed = p.seed != null ? p.seed + index : undefined;
      const input = seed != null ? { ...baseFalInput, seed } : baseFalInput;
      const webhookUrl = `${env.APP_URL}/api/webhooks/fal?gen=${genId}`;
      try {
        const submission = await fal.submit(env, {
          modelEndpoint: p.model.endpoint,
          input,
          webhookUrl,
        });
        await env.DB.prepare(
          `INSERT INTO generations
             (id, user_id, folder_id, type, status, prompt, negative_prompt, model,
              aspect_ratio, seed, ref_image_urls, credit_cost, fal_request_id,
              parent_generation_id, variant_index, created_at)
           VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(
            genId,
            p.userId,
            p.folderId,
            p.model.type,
            p.prompt,
            p.negativePrompt,
            p.modelKey,
            p.aspectRatio,
            seed ?? null,
            refImageJson,
            useFree ? 0 : perCallCost,
            submission.requestId,
            parentGenerationId,
            variantStart + index,
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
  const failed = results.filter((r) => !r.ok) as Array<{ ok: false; id: string; error: string }>;

  if (failed.length > 0) {
    if (useFree) {
      await env.DB.prepare(
        "UPDATE users SET free_remaining = free_remaining + ? WHERE id = ?",
      )
        .bind(failed.length, p.userId)
        .run();
    } else {
      const refundAmount = perCallCost * failed.length;
      await env.DB.batch([
        env.DB.prepare("UPDATE users SET credits = credits + ? WHERE id = ?").bind(
          refundAmount,
          p.userId,
        ),
        env.DB.prepare(
          `INSERT INTO credit_ledger (id, user_id, delta, reason, created_at)
           VALUES (?, ?, ?, 'refund', ?)`,
        ).bind(id("led"), p.userId, refundAmount, now()),
      ]);
    }
  }

  if (succeeded.length === 0) {
    return {
      ok: false,
      status: 502,
      body: { error: "provider_submit_failed", detail: failed[0]?.error ?? "unknown" },
    };
  }

  return {
    ok: true,
    ids: succeeded.map((s) => s.id),
    submitted: succeeded.length,
    failed: failed.length,
  };
}
