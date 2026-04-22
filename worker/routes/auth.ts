import { Hono } from "hono";
import type { Env, AppVariables } from "../env";
import { createSession, sessionCookie, clearCookie } from "../auth/session";
import { authenticateWorkosCode, workosAuthorizationUrl } from "../auth/workos";
import { id, now } from "../lib/ids";
import { DEFAULT_FREE_GRANT } from "../lib/plans";

type AppEnv = { Bindings: Env; Variables: AppVariables };

export const authRoutes = new Hono<AppEnv>();

// Kicks off AuthKit hosted login.
authRoutes.get("/login", (c) => {
  const url = workosAuthorizationUrl({
    clientId: c.env.WORKOS_CLIENT_ID,
    redirectUri: `${c.env.APP_URL}/api/auth/callback`,
  });
  return c.redirect(url);
});

authRoutes.get("/callback", async (c) => {
  const code = c.req.query("code");
  if (!code) return c.json({ error: "missing_code" }, 400);

  let user: { id: string; email: string };
  try {
    user = await authenticateWorkosCode({
      apiKey: c.env.WORKOS_API_KEY,
      clientId: c.env.WORKOS_CLIENT_ID,
      code,
    });
  } catch (err) {
    return c.json({ error: "workos_exchange_failed", detail: String(err) }, 401);
  }

  // Upsert into D1.
  const existing = await c.env.DB.prepare(
    "SELECT id, status FROM users WHERE workos_id = ?",
  )
    .bind(user.id)
    .first<{ id: string; status: string }>();

  let userId: string;
  if (existing) {
    userId = existing.id;
    if (existing.status === "suspended") {
      return c.json({ error: "account_suspended" }, 403);
    }
  } else {
    userId = id("usr");
    await c.env.DB.prepare(
      `INSERT INTO users (id, workos_id, email, plan, free_remaining, credits, created_at)
       VALUES (?, ?, ?, 'free', ?, 0, ?)`,
    )
      .bind(userId, user.id, user.email, DEFAULT_FREE_GRANT, now())
      .run();
  }

  const token = await createSession(c.env, {
    userId,
    email: user.email,
    createdAt: now(),
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/gallery",
      "Set-Cookie": sessionCookie(token, c.env.APP_URL),
    },
  });
});

authRoutes.post("/logout", () => {
  return new Response(null, {
    status: 204,
    headers: { "Set-Cookie": clearCookie() },
  });
});
