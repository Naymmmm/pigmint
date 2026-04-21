import { Hono } from "hono";
import { z } from "zod";
import type { Env, AppVariables } from "../env";
import { id, now } from "../lib/ids";
import { ASSISTANT_COST_PER_MESSAGE } from "../lib/pricing";
import { moderate } from "../lib/moderation";

type AppEnv = { Bindings: Env; Variables: AppVariables };
export const assistantRoutes = new Hono<AppEnv>();

// List/create sessions.
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

const msgSchema = z.object({
  sessionId: z.string(),
  content: z.string().min(1).max(4000),
});

// Send a user message; stream assistant reply via SSE.
assistantRoutes.post("/messages", async (c) => {
  const userId = c.get("userId");
  const body = msgSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "bad_request" }, 400);

  // Paid plan gate.
  const user = await c.env.DB.prepare(
    "SELECT plan, credits FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<{ plan: string; credits: number }>();
  if (!user) return c.json({ error: "user_missing" }, 500);
  if (user.plan === "free") return c.json({ error: "paid_plan_required" }, 402);
  if (user.credits < ASSISTANT_COST_PER_MESSAGE)
    return c.json({ error: "insufficient_credits" }, 402);

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

  // Persist user message.
  await c.env.DB.prepare(
    "INSERT INTO prompt_messages (id, session_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)",
  )
    .bind(id("pm"), body.data.sessionId, body.data.content, now())
    .run();

  // Load recent history.
  const history = await c.env.DB.prepare(
    "SELECT role, content FROM prompt_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 40",
  )
    .bind(body.data.sessionId)
    .all<{ role: string; content: string }>();

  const systemMsg = {
    role: "system",
    content:
      "You are Pigmint's prompting assistant. Help the user craft effective image and video generation prompts. Be concise and offer variations.",
  };
  const messages = [systemMsg, ...history.results];

  // Debit credit up front.
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET credits = credits - ? WHERE id = ?")
      .bind(ASSISTANT_COST_PER_MESSAGE, userId),
    c.env.DB.prepare(
      "INSERT INTO credit_ledger (id, user_id, delta, reason, created_at) VALUES (?, ?, ?, 'assistant', ?)",
    ).bind(id("led"), userId, -ASSISTANT_COST_PER_MESSAGE, now()),
  ]);

  // Stream from fal's any-llm endpoint via SSE.
  const falRes = await fetch("https://fal.run/fal-ai/any-llm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${c.env.FAL_KEY}`,
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages,
      stream: true,
    }),
  });

  if (!falRes.ok || !falRes.body) {
    return c.json({ error: "llm_failed", detail: await falRes.text() }, 502);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const sessionId = body.data.sessionId;
  const env = c.env;

  const stream = new ReadableStream({
    async start(controller) {
      const reader = falRes.body!.getReader();
      let buffer = "";
      let assistantContent = "";

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
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: chunk })}\n\n`));
            }
          } catch { /* ignore malformed chunk */ }
        }
      }

      await env.DB.prepare(
        "INSERT INTO prompt_messages (id, session_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)",
      )
        .bind(id("pm"), sessionId, assistantContent, now())
        .run();

      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
