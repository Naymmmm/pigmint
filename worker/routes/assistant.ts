import { Hono } from "hono";
import { z } from "zod";
import type { Env, AppVariables } from "../env";
import { id, now } from "../lib/ids";
import { moderate } from "../lib/moderation";

type AppEnv = { Bindings: Env; Variables: AppVariables };
export const assistantRoutes = new Hono<AppEnv>();

// Prompt-engineering assistant. Pro-plan only, but does NOT debit credits —
// it's a benefit of the subscription. Backed directly by OpenAI (gpt-5.4-mini).

const OPENAI_MODEL = "gpt-5.4-mini";

const OUTPUT_FORMATS = ["natural", "json", "yaml", "xml", "markdown"] as const;
type OutputFormat = (typeof OUTPUT_FORMATS)[number];

function systemPromptFor(format: OutputFormat): string {
  const base = `You are Pigmint's prompt-engineering assistant. You help users craft high-quality prompts for AI image and video generation models (Flux, Veo, Kling, Seedance, Nano Banana, and others).

Principles you follow:
- Subject first: the strongest tokens go earliest.
- Prefer comma-separated phrases over long prose.
- Layer: subject → style → medium → lighting → composition → camera → mood.
- Be concrete. "cinematic three-point lighting" beats "good lighting".
- Know when to restrain — 40–80 tokens usually outperforms 200.
- For video prompts, describe motion, pacing, and camera movement.
- If the user's request is vague, offer 2–3 variations at different levels of specificity.
- Never refuse benign creative requests on false-positive grounds; flag only genuine policy issues.`;

  switch (format) {
    case "json":
      return `${base}

OUTPUT FORMAT — respond with a single JSON object. Valid JSON only. Shape:
{
  "prompt": "the main prompt string",
  "negative_prompt": "optional negatives",
  "variations": ["optional alternative phrasings"],
  "notes": "optional short explanation"
}
Do not wrap in markdown fences. Do not add commentary outside the JSON.`;
    case "yaml":
      return `${base}

OUTPUT FORMAT — respond with YAML. Fields: prompt, negative_prompt, variations (list), notes. Do not wrap in markdown fences.`;
    case "xml":
      return `${base}

OUTPUT FORMAT — respond with a single XML document:
<response>
  <prompt>…</prompt>
  <negative_prompt>…</negative_prompt>
  <variations>
    <variation>…</variation>
  </variations>
  <notes>…</notes>
</response>
Do not wrap in markdown fences.`;
    case "markdown":
      return `${base}

OUTPUT FORMAT — respond in tidy markdown with these sections when useful:
## Prompt
(the prompt)
## Negative prompt
(optional)
## Variations
- alt 1
- alt 2
## Notes
(optional)`;
    case "natural":
    default:
      return `${base}

OUTPUT FORMAT — conversational, but lead with the prompt itself on the first line. Keep explanations brief.`;
  }
}

// Sessions ------------------------------------------------------------------

assistantRoutes.get("/sessions", async (c) => {
  const userId = c.get("userId");
  const { results } = await c.env.DB.prepare(
    "SELECT id, title, created_at FROM prompt_sessions WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(userId)
    .all();
  return c.json({ items: results });
});

assistantRoutes.post("/sessions", async (c) => {
  const userId = c.get("userId");
  const body = z
    .object({ title: z.string().max(120).optional() })
    .safeParse(await c.req.json().catch(() => ({})));
  const sid = id("ps");
  await c.env.DB.prepare(
    "INSERT INTO prompt_sessions (id, user_id, title, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(sid, userId, body.success ? body.data.title ?? null : null, now())
    .run();
  return c.json({ id: sid });
});

assistantRoutes.get("/sessions/:id/messages", async (c) => {
  const userId = c.get("userId");
  const sid = c.req.param("id");
  const owner = await c.env.DB.prepare(
    "SELECT 1 FROM prompt_sessions WHERE id = ? AND user_id = ?",
  )
    .bind(sid, userId)
    .first();
  if (!owner) return c.json({ error: "not_found" }, 404);
  const { results } = await c.env.DB.prepare(
    "SELECT id, role, content, created_at FROM prompt_messages WHERE session_id = ? ORDER BY created_at ASC",
  )
    .bind(sid)
    .all();
  return c.json({ items: results });
});

// Streaming messages --------------------------------------------------------

const msgSchema = z.object({
  sessionId: z.string(),
  content: z.string().min(1).max(8000),
  format: z.enum(OUTPUT_FORMATS).optional(),
});

assistantRoutes.post("/messages", async (c) => {
  const userId = c.get("userId");
  const body = msgSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "bad_request" }, 400);

  // Paid plan gate. No credit debit — assistant is a Pro-plan benefit.
  const user = await c.env.DB.prepare(
    "SELECT plan FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<{ plan: string }>();
  if (!user) return c.json({ error: "user_missing" }, 500);
  if (user.plan === "free") return c.json({ error: "paid_plan_required" }, 402);

  // Verify session ownership.
  const sessionOwner = await c.env.DB.prepare(
    "SELECT 1 FROM prompt_sessions WHERE id = ? AND user_id = ?",
  )
    .bind(body.data.sessionId, userId)
    .first();
  if (!sessionOwner) return c.json({ error: "session_not_found" }, 404);

  // Moderation.
  const decision = await moderate(c.env, { userId, prompt: body.data.content });
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

  const format: OutputFormat = body.data.format ?? "natural";

  // Persist user message.
  await c.env.DB.prepare(
    "INSERT INTO prompt_messages (id, session_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)",
  )
    .bind(id("pm"), body.data.sessionId, body.data.content, now())
    .run();

  // Load recent history — excluding any system messages, since the system
  // prompt is reconstructed from the format each request.
  const history = await c.env.DB.prepare(
    "SELECT role, content FROM prompt_messages WHERE session_id = ? AND role IN ('user', 'assistant') ORDER BY created_at ASC LIMIT 40",
  )
    .bind(body.data.sessionId)
    .all<{ role: "user" | "assistant"; content: string }>();

  const messages = [
    { role: "system" as const, content: systemPromptFor(format) },
    ...history.results,
  ];

  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      stream: true,
    }),
  });

  if (!openaiRes.ok || !openaiRes.body) {
    const detail = await openaiRes.text().catch(() => "");
    return c.json({ error: "llm_failed", status: openaiRes.status, detail }, 502);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const sessionId = body.data.sessionId;
  const env = c.env;

  const stream = new ReadableStream({
    async start(controller) {
      const reader = openaiRes.body!.getReader();
      let buffer = "";
      let assistantContent = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const chunk = parsed.choices?.[0]?.delta?.content ?? "";
              if (chunk) {
                assistantContent += chunk;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ delta: chunk })}\n\n`),
                );
              }
            } catch {
              /* skip malformed chunk */
            }
          }
        }
      } finally {
        if (assistantContent) {
          await env.DB.prepare(
            "INSERT INTO prompt_messages (id, session_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)",
          )
            .bind(id("pm"), sessionId, assistantContent, now())
            .run();
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
