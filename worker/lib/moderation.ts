import type { Env } from "../env";
import { id, now } from "./ids";

const CHILD_SAFETY_CATEGORIES = new Set([
  "sexual/minors",
]);

type OpenAIInput =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

interface ModerationResult {
  flagged: boolean;
  categories: string[];
  categoryScores: Record<string, number>;
  isChildSafety: boolean;
}

export interface ModerationDecision {
  allow: boolean;
  action: "pass" | "warn" | "block" | "suspend";
  httpStatus: 200 | 422 | 403;
  userMessage: string;
  categories: string[];
  isChildSafety: boolean;
}

async function callOpenAI(env: Env, input: OpenAIInput): Promise<ModerationResult> {
  const res = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: "omni-moderation-latest", input }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI Moderation error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as {
    results: Array<{
      flagged: boolean;
      categories: Record<string, boolean>;
      category_scores: Record<string, number>;
    }>;
  };
  const r = data.results[0];
  const flaggedCategories = Object.entries(r.categories)
    .filter(([, v]) => v)
    .map(([k]) => k);
  return {
    flagged: r.flagged,
    categories: flaggedCategories,
    categoryScores: r.category_scores,
    isChildSafety: flaggedCategories.some((c) => CHILD_SAFETY_CATEGORIES.has(c)),
  };
}

/**
 * Moderate a user input (prompt text + optional ref image URLs).
 * Writes a `moderation_events` row and, on child-safety flags, tracks strikes
 * and suspends the account on the second offense.
 */
export async function moderate(
  env: Env,
  opts: {
    userId: string;
    prompt: string;
    imageUrls?: string[];
    generationId?: string | null;
  },
): Promise<ModerationDecision> {
  const input: OpenAIInput = [
    { type: "text" as const, text: opts.prompt },
    ...(opts.imageUrls ?? []).map((url) => ({
      type: "image_url" as const,
      image_url: { url },
    })),
  ];

  const result = await callOpenAI(env, input);

  if (!result.flagged) {
    await logEvent(env, {
      userId: opts.userId,
      generationId: opts.generationId ?? null,
      prompt: opts.prompt,
      result,
      action: "warn", // stored as 'warn' only when flagged; skip write on pass
      skipWrite: true,
    });
    return {
      allow: true,
      action: "pass",
      httpStatus: 200,
      userMessage: "",
      categories: [],
      isChildSafety: false,
    };
  }

  if (result.isChildSafety) {
    const user = await env.DB.prepare(
      "SELECT cs_strike_count FROM users WHERE id = ?",
    )
      .bind(opts.userId)
      .first<{ cs_strike_count: number }>();

    const strikeCount = user?.cs_strike_count ?? 0;

    if (strikeCount >= 1) {
      // Second offense — suspend permanently.
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE users SET status = 'suspended', suspended_at = ?, suspended_reason = 'child_safety' WHERE id = ?",
        ).bind(now(), opts.userId),
      ]);
      await invalidateSessions(env, opts.userId);
      await logEvent(env, {
        userId: opts.userId,
        generationId: opts.generationId ?? null,
        prompt: opts.prompt,
        result,
        action: "suspend",
      });
      // Ops queue for manual review.
      await env.BUCKET.put(
        `moderation/suspensions/${opts.userId}-${now()}.json`,
        JSON.stringify({
          userId: opts.userId,
          prompt: opts.prompt,
          categories: result.categories,
          categoryScores: result.categoryScores,
          timestamp: now(),
        }),
      );
      return {
        allow: false,
        action: "suspend",
        httpStatus: 403,
        userMessage:
          "Your account has been suspended for violating our child-safety policy.",
        categories: result.categories,
        isChildSafety: true,
      };
    }

    // First offense — warn and strike.
    await env.DB.prepare(
      "UPDATE users SET cs_strike_count = 1 WHERE id = ?",
    )
      .bind(opts.userId)
      .run();
    await logEvent(env, {
      userId: opts.userId,
      generationId: opts.generationId ?? null,
      prompt: opts.prompt,
      result,
      action: "warn",
    });
    return {
      allow: false,
      action: "warn",
      httpStatus: 422,
      userMessage:
        "This prompt violates our child-safety policy. This is your only warning — any further attempt will permanently suspend your account.",
      categories: result.categories,
      isChildSafety: true,
    };
  }

  // Non-child-safety flag: soft warn, allow retry with different prompt.
  await logEvent(env, {
    userId: opts.userId,
    generationId: opts.generationId ?? null,
    prompt: opts.prompt,
    result,
    action: "warn",
  });
  return {
    allow: false,
    action: "warn",
    httpStatus: 422,
    userMessage: `This prompt was flagged for: ${result.categories.join(", ")}. Please edit and try again.`,
    categories: result.categories,
    isChildSafety: false,
  };
}

async function logEvent(
  env: Env,
  opts: {
    userId: string;
    generationId: string | null;
    prompt: string;
    result: ModerationResult;
    action: "warn" | "block" | "suspend";
    skipWrite?: boolean;
  },
) {
  if (opts.skipWrite) return;
  await env.DB.prepare(
    `INSERT INTO moderation_events
       (id, user_id, generation_id, prompt_excerpt, categories, category_scores, flagged, action, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id("mod"),
      opts.userId,
      opts.generationId,
      opts.prompt.slice(0, 500),
      JSON.stringify(opts.result.categories),
      JSON.stringify(opts.result.categoryScores),
      opts.result.flagged ? 1 : 0,
      opts.action,
      now(),
    )
    .run();
}

async function invalidateSessions(env: Env, userId: string) {
  // New requests are blocked by the suspended user status in requireUser.
  // Delete the legacy reverse index if it exists from older sessions.
  await env.SESSIONS.delete(`user:${userId}:sessions`);
}
