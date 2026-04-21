import { Hono } from "hono";
import { z } from "zod";
import type { Env, AppVariables } from "../env";
import { id, now } from "../lib/ids";

type AppEnv = { Bindings: Env; Variables: AppVariables };
export const foldersRoutes = new Hono<AppEnv>();

foldersRoutes.get("/", async (c) => {
  const userId = c.get("userId");
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, parent_id, created_at FROM folders WHERE user_id = ? ORDER BY name",
  )
    .bind(userId)
    .all();
  return c.json({ items: results });
});

foldersRoutes.post("/", async (c) => {
  const userId = c.get("userId");
  const body = z
    .object({ name: z.string().min(1).max(80), parentId: z.string().nullable().optional() })
    .safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "bad_request" }, 400);
  const folderId = id("fld");
  await c.env.DB.prepare(
    "INSERT INTO folders (id, user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(folderId, userId, body.data.name, body.data.parentId ?? null, now())
    .run();
  return c.json({ id: folderId });
});

foldersRoutes.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const body = z.object({ name: z.string().min(1).max(80) }).safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "bad_request" }, 400);
  await c.env.DB.prepare("UPDATE folders SET name = ? WHERE id = ? AND user_id = ?")
    .bind(body.data.name, c.req.param("id"), userId)
    .run();
  return c.json({ ok: true });
});

foldersRoutes.delete("/:id", async (c) => {
  const userId = c.get("userId");
  await c.env.DB.prepare("DELETE FROM folders WHERE id = ? AND user_id = ?")
    .bind(c.req.param("id"), userId)
    .run();
  return c.json({ ok: true });
});
