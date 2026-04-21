import { Hono } from "hono";
import type { Env, AppVariables } from "../env";
import { now } from "../lib/ids";

type AppEnv = { Bindings: Env; Variables: AppVariables };
export const bookmarksRoutes = new Hono<AppEnv>();

bookmarksRoutes.post("/:generationId", async (c) => {
  const userId = c.get("userId");
  const genId = c.req.param("generationId");
  const owner = await c.env.DB.prepare(
    "SELECT 1 FROM generations WHERE id = ? AND user_id = ?",
  )
    .bind(genId, userId)
    .first();
  if (!owner) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO bookmarks (user_id, generation_id, created_at) VALUES (?, ?, ?)",
  )
    .bind(userId, genId, now())
    .run();
  return c.json({ ok: true });
});

bookmarksRoutes.delete("/:generationId", async (c) => {
  const userId = c.get("userId");
  await c.env.DB.prepare(
    "DELETE FROM bookmarks WHERE user_id = ? AND generation_id = ?",
  )
    .bind(userId, c.req.param("generationId"))
    .run();
  return c.json({ ok: true });
});
