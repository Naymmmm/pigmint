import { Hono } from "hono";
import { z } from "zod";
import type { Env, AppVariables } from "../env";
import { id, now } from "../lib/ids";
import { MODELS } from "../lib/pricing";
import { runSubmission } from "../lib/submit-generation";

type AppEnv = { Bindings: Env; Variables: AppVariables };
export const comparisonsRoutes = new Hono<AppEnv>();

/**
 * Comparisons let a user pin two or more generations side-by-side
 * ("Model 1 vs Model 2") from their history, or kick off a new run
 * that fans a single prompt across multiple models at once.
 *
 * Data shape:
 *   comparison         → id, name, prompt?, user
 *   comparison_slots   → one per column (label like "Model 1", optional model key)
 *   comparison_slot_generations → ordered generations in each slot
 *
 * Regenerating within a slot appends new variants to that slot.
 */

const createFromHistorySchema = z.object({
  mode: z.literal("history"),
  name: z.string().min(1).max(120),
  slots: z
    .array(
      z.object({
        label: z.string().min(1).max(60),
        generationIds: z.array(z.string()).min(1).max(8),
      }),
    )
    .min(2)
    .max(6),
});

const createFromPromptSchema = z.object({
  mode: z.literal("prompt"),
  name: z.string().min(1).max(120),
  prompt: z.string().min(1).max(4000),
  aspectRatio: z.string(),
  numImages: z.number().int().min(1).max(4).optional(),
  refImageUrls: z.array(z.string().url()).max(4).optional(),
  slots: z
    .array(
      z.object({
        label: z.string().min(1).max(60),
        model: z.string(),
      }),
    )
    .min(2)
    .max(6),
});

const createSchema = z.discriminatedUnion("mode", [
  createFromHistorySchema,
  createFromPromptSchema,
]);

comparisonsRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const parsed = createSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "bad_request", issues: parsed.error.issues }, 400);
  }

  const cmpId = id("cmp");
  const createdAt = now();

  if (parsed.data.mode === "history") {
    // Validate all referenced generations belong to this user.
    const allIds = parsed.data.slots.flatMap((s) => s.generationIds);
    const placeholders = allIds.map(() => "?").join(",");
    const { results } = await c.env.DB.prepare(
      `SELECT id FROM generations WHERE user_id = ? AND id IN (${placeholders})`,
    )
      .bind(userId, ...allIds)
      .all<{ id: string }>();
    const owned = new Set(results.map((r) => r.id));
    for (const gid of allIds) {
      if (!owned.has(gid)) return c.json({ error: "not_found", generationId: gid }, 404);
    }

    const stmts = [
      c.env.DB.prepare(
        "INSERT INTO comparisons (id, user_id, name, prompt, created_at) VALUES (?, ?, ?, NULL, ?)",
      ).bind(cmpId, userId, parsed.data.name, createdAt),
    ];
    parsed.data.slots.forEach((slot, slotIdx) => {
      const slotId = id("cmps");
      stmts.push(
        c.env.DB.prepare(
          "INSERT INTO comparison_slots (id, comparison_id, slot_index, label, model, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
        ).bind(slotId, cmpId, slotIdx, slot.label, createdAt),
      );
      slot.generationIds.forEach((gid, pos) => {
        stmts.push(
          c.env.DB.prepare(
            "INSERT INTO comparison_slot_generations (slot_id, generation_id, position) VALUES (?, ?, ?)",
          ).bind(slotId, gid, pos),
        );
      });
    });
    await c.env.DB.batch(stmts);
    return c.json({ id: cmpId });
  }

  // mode === "prompt": run the prompt across each slot's model in parallel
  // and attach the resulting generations to the slot.
  const spec = parsed.data;
  for (const slot of spec.slots) {
    if (!MODELS[slot.model]) {
      return c.json({ error: "unknown_model", model: slot.model }, 400);
    }
  }

  // Create comparison + slot rows first so we can attach generations after.
  const slotRecords = spec.slots.map((s, i) => ({ id: id("cmps"), ...s, index: i }));
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO comparisons (id, user_id, name, prompt, created_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(cmpId, userId, spec.name, spec.prompt, createdAt),
    ...slotRecords.map((r) =>
      c.env.DB.prepare(
        "INSERT INTO comparison_slots (id, comparison_id, slot_index, label, model, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).bind(r.id, cmpId, r.index, r.label, r.model, createdAt),
    ),
  ]);

  // Fan out across slots. Each slot runs runSubmission independently so one
  // failure (e.g. unsupported aspect) doesn't block the others.
  const numImages = spec.numImages ?? 1;
  const refUrls = spec.refImageUrls ?? [];
  const slotResults = await Promise.all(
    slotRecords.map(async (slot) => {
      const model = MODELS[slot.model]!;
      if (!model.aspects.includes(spec.aspectRatio)) {
        return { slot, ok: false as const, error: "unsupported_aspect", ids: [] };
      }
      if (model.requiresRefImage && refUrls.length === 0) {
        return { slot, ok: false as const, error: "reference_image_required", ids: [] };
      }
      const outcome = await runSubmission(c.env, {
        userId,
        folderId: null,
        model,
        modelKey: slot.model,
        prompt: spec.prompt,
        negativePrompt: null,
        aspectRatio: spec.aspectRatio,
        refImageUrls: refUrls,
        seed: undefined,
        numImages,
        resolution: model.defaultResolution,
        quality: model.defaultQuality,
      });
      if (!outcome.ok) return { slot, ok: false as const, error: String(outcome.body.error ?? "submit_failed"), ids: [] };
      return { slot, ok: true as const, ids: outcome.ids };
    }),
  );

  const inserts = slotResults.flatMap((r) =>
    r.ids.map((gid, pos) =>
      c.env.DB.prepare(
        "INSERT INTO comparison_slot_generations (slot_id, generation_id, position) VALUES (?, ?, ?)",
      ).bind(r.slot.id, gid, pos),
    ),
  );
  if (inserts.length) await c.env.DB.batch(inserts);

  return c.json({
    id: cmpId,
    slots: slotResults.map((r) => ({
      slotId: r.slot.id,
      label: r.slot.label,
      model: r.slot.model,
      ok: r.ok,
      ids: r.ids,
      error: r.ok ? null : r.error,
    })),
  });
});

comparisonsRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, prompt, created_at FROM comparisons
     WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(userId)
    .all();
  return c.json({ items: results });
});

comparisonsRoutes.get("/:id", async (c) => {
  const userId = c.get("userId");
  const cmp = await c.env.DB.prepare(
    "SELECT id, name, prompt, created_at FROM comparisons WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param("id"), userId)
    .first<{ id: string; name: string; prompt: string | null; created_at: number }>();
  if (!cmp) return c.json({ error: "not_found" }, 404);

  const { results: slotRows } = await c.env.DB.prepare(
    `SELECT id, slot_index, label, model FROM comparison_slots
     WHERE comparison_id = ? ORDER BY slot_index ASC`,
  )
    .bind(cmp.id)
    .all<{ id: string; slot_index: number; label: string; model: string | null }>();

  const slotIds = slotRows.map((s) => s.id);
  const placeholders = slotIds.map(() => "?").join(",") || "''";
  const { results: genRows } = slotIds.length
    ? await c.env.DB.prepare(
        `SELECT csg.slot_id, csg.position, g.id, g.type, g.status, g.prompt, g.model,
                g.aspect_ratio, g.r2_key, g.thumb_r2_key, g.width, g.height,
                g.duration_s, g.folder_id, g.parent_generation_id, g.variant_index,
                g.created_at, g.completed_at
         FROM comparison_slot_generations csg
         JOIN generations g ON g.id = csg.generation_id
         WHERE csg.slot_id IN (${placeholders}) AND g.user_id = ?
         ORDER BY csg.slot_id, csg.position ASC`,
      )
        .bind(...slotIds, userId)
        .all()
    : { results: [] as Array<{ slot_id: string } & Record<string, unknown>> };

  const bySlot = new Map<string, unknown[]>();
  for (const row of genRows as Array<{ slot_id: string } & Record<string, unknown>>) {
    const arr = bySlot.get(row.slot_id) ?? [];
    const { slot_id: _ignored, position: _pos, ...gen } = row as Record<string, unknown>;
    arr.push(gen);
    bySlot.set(row.slot_id, arr);
  }

  return c.json({
    id: cmp.id,
    name: cmp.name,
    prompt: cmp.prompt,
    created_at: cmp.created_at,
    slots: slotRows.map((s) => ({
      id: s.id,
      index: s.slot_index,
      label: s.label,
      model: s.model,
      generations: bySlot.get(s.id) ?? [],
    })),
  });
});

comparisonsRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  await c.env.DB.prepare("DELETE FROM comparisons WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .run();
  return c.json({ ok: true });
});

// Regenerate within a slot: creates a new generation using the slot's model
// + the comparison's prompt, and appends it to the slot.
const runSlotSchema = z.object({
  aspectRatio: z.string().optional(),
  numImages: z.number().int().min(1).max(4).optional(),
});

comparisonsRoutes.post("/:id/slots/:slotId/run", async (c) => {
  const userId = c.get("userId");
  const body = runSlotSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "bad_request" }, 400);

  const row = await c.env.DB.prepare(
    `SELECT cs.id AS slot_id, cs.label, cs.model, cs.comparison_id,
            c.prompt, c.user_id
     FROM comparison_slots cs
     JOIN comparisons c ON c.id = cs.comparison_id
     WHERE cs.id = ? AND cs.comparison_id = ? AND c.user_id = ?`,
  )
    .bind(c.req.param("slotId"), c.req.param("id"), userId)
    .first<{
      slot_id: string;
      label: string;
      model: string | null;
      comparison_id: string;
      prompt: string | null;
      user_id: string;
    }>();
  if (!row) return c.json({ error: "not_found" }, 404);
  if (!row.model) return c.json({ error: "slot_has_no_model" }, 400);
  if (!row.prompt) return c.json({ error: "comparison_has_no_prompt" }, 400);

  const model = MODELS[row.model];
  if (!model) return c.json({ error: "unknown_model" }, 400);
  const aspect = body.data.aspectRatio ?? model.defaultAspect;
  if (!model.aspects.includes(aspect)) {
    return c.json({ error: "unsupported_aspect" }, 400);
  }

  const numImages = body.data.numImages ?? 1;
  const outcome = await runSubmission(c.env, {
    userId,
    folderId: null,
    model,
    modelKey: row.model,
    prompt: row.prompt,
    negativePrompt: null,
    aspectRatio: aspect,
    refImageUrls: [],
    seed: undefined,
    numImages,
    resolution: model.defaultResolution,
    quality: model.defaultQuality,
    skipModeration: true,
  });
  if (!outcome.ok) return c.json(outcome.body, outcome.status as 400 | 402 | 500 | 502);

  // Append to slot at next position.
  const posRow = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(position), -1) AS mx FROM comparison_slot_generations WHERE slot_id = ?",
  )
    .bind(row.slot_id)
    .first<{ mx: number }>();
  const start = (posRow?.mx ?? -1) + 1;
  await c.env.DB.batch(
    outcome.ids.map((gid, i) =>
      c.env.DB.prepare(
        "INSERT INTO comparison_slot_generations (slot_id, generation_id, position) VALUES (?, ?, ?)",
      ).bind(row.slot_id, gid, start + i),
    ),
  );

  return c.json({ ids: outcome.ids, submitted: outcome.submitted, failed: outcome.failed });
});
