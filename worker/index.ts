import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Env, AppVariables } from "./env";
import { authRoutes } from "./routes/auth";
import { generationsRoutes, serveSignedGenerationRef } from "./routes/generations";
import { modelsRoutes } from "./routes/models";
import { foldersRoutes } from "./routes/folders";
import { bookmarksRoutes } from "./routes/bookmarks";
import { assistantRoutes } from "./routes/assistant";
import { billingRoutes } from "./routes/billing";
import { falWebhook } from "./routes/webhooks/fal";
import { stripeWebhook } from "./routes/webhooks/stripe";
import { requireUser } from "./auth/middleware";
import { runCreditRefill } from "./jobs/refill";

type AppEnv = { Bindings: Env; Variables: AppVariables };

const api = new Hono<AppEnv>();

api.use("*", logger());
api.use(
  "*",
  cors({
    origin: (o) => o ?? "*",
    credentials: true,
  }),
);

// Webhooks (no auth — providers call these).
api.route("/webhooks/fal", falWebhook);
api.route("/webhooks/stripe", stripeWebhook);

// Public auth routes.
api.route("/auth", authRoutes);

// Public model catalog. It intentionally excludes provider cost and secrets.
api.route("/models", modelsRoutes);

// Signed reference images need to be reachable by model providers.
api.get("/generations/refs/:key{.+}", serveSignedGenerationRef);

// Authed routes.
const authed = new Hono<AppEnv>();
authed.use("*", requireUser);
authed.route("/generations", generationsRoutes);
authed.route("/folders", foldersRoutes);
authed.route("/bookmarks", bookmarksRoutes);
authed.route("/assistant", assistantRoutes);
authed.route("/billing", billingRoutes);
authed.get("/me", (c) => c.json({ id: c.get("userId"), email: c.get("userEmail") }));

api.route("/", authed);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      // Strip /api prefix once before handing to Hono.
      const stripped = new Request(
        new URL(url.pathname.replace(/^\/api/, "") + url.search, url.origin),
        request,
      );
      return api.fetch(stripped, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runCreditRefill(env));
  },
} satisfies ExportedHandler<Env>;
