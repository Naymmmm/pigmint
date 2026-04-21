import type { MiddlewareHandler } from "hono";
import type { Env, AppVariables } from "../env";
import { readSession } from "./session";

export const requireUser: MiddlewareHandler<{
  Bindings: Env;
  Variables: AppVariables;
}> = async (c, next) => {
  const session = await readSession(c.env, c.req.raw);
  if (!session) return c.json({ error: "unauthenticated" }, 401);

  const user = await c.env.DB.prepare(
    "SELECT id, status FROM users WHERE id = ?",
  )
    .bind(session.userId)
    .first<{ id: string; status: string }>();

  if (!user) return c.json({ error: "unauthenticated" }, 401);
  if (user.status === "suspended") {
    return c.json({ error: "account_suspended" }, 403);
  }

  c.set("userId", session.userId);
  c.set("userEmail", session.email);
  await next();
};
