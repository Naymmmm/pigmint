import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import type { Env, AppVariables } from "./env";
import { requireUser } from "./auth/middleware";
import { authRoutes } from "./routes/auth";

type AppEnv = { Bindings: Env; Variables: AppVariables };

let authApi: Hono<AppEnv> | null = null;
let fullApiPromise: Promise<Hono<AppEnv>> | null = null;

function strippedApiRequest(request: Request, url: URL): Request {
  return new Request(
    new URL(url.pathname.replace(/^\/api/, "") + url.search, url.origin),
    request,
  );
}

function getAuthApi(): Hono<AppEnv> {
  if (authApi) return authApi;

  const api = new Hono<AppEnv>();
  api.route("/auth", authRoutes);

  const me = new Hono<AppEnv>();
  me.use("*", requireUser);
  me.get("/", (c) => c.json({ id: c.get("userId"), email: c.get("userEmail") }));
  api.route("/me", me);

  authApi = api;
  return api;
}

async function getFullApi(): Promise<Hono<AppEnv>> {
  fullApiPromise ??= buildFullApi();
  return fullApiPromise;
}

async function buildFullApi(): Promise<Hono<AppEnv>> {
  const { generationsRoutes, serveSignedGenerationRef } = await import("./routes/generations");
  const { modelsRoutes } = await import("./routes/models");
  const { foldersRoutes } = await import("./routes/folders");
  const { bookmarksRoutes } = await import("./routes/bookmarks");
  const { assistantRoutes } = await import("./routes/assistant");
  const { billingRoutes } = await import("./routes/billing");
  const { falWebhook } = await import("./routes/webhooks/fal");
  const { stripeWebhook } = await import("./routes/webhooks/stripe");

  const api = new Hono<AppEnv>();
  api.use("*", logger());

  // Webhooks are server-to-server; no CORS, no CSRF surface.
  api.route("/webhooks/fal", falWebhook);
  api.route("/webhooks/stripe", stripeWebhook);

  // CORS only for SPA-facing routes. Locked to our own origin to prevent
  // cross-site authenticated requests — browsers ignore `credentials: true`
  // responses that don't echo the exact request origin.
  const spaCors = cors({
    origin: (origin, c) => {
      const appUrl = c.env.APP_URL;
      if (!origin) return appUrl;
      return origin === appUrl ? origin : null;
    },
    credentials: true,
  });
  api.use("/auth/*", spaCors);
  api.use("/models/*", spaCors);
  api.use("/generations/*", spaCors);
  api.use("/folders/*", spaCors);
  api.use("/bookmarks/*", spaCors);
  api.use("/assistant/*", spaCors);
  api.use("/billing/*", spaCors);
  api.use("/me", spaCors);

  api.route("/auth", authRoutes);
  api.route("/models", modelsRoutes);
  api.get("/generations/refs/:key{.+}", serveSignedGenerationRef);

  const authed = new Hono<AppEnv>();
  authed.use("*", requireUser);
  authed.route("/generations", generationsRoutes);
  authed.route("/folders", foldersRoutes);
  authed.route("/bookmarks", bookmarksRoutes);
  authed.route("/assistant", assistantRoutes);
  authed.route("/billing", billingRoutes);
  authed.get("/me", (c) => c.json({ id: c.get("userId"), email: c.get("userEmail") }));

  api.route("/", authed);
  return api;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const stripped = strippedApiRequest(request, url);
      if (url.pathname.startsWith("/api/auth/") || url.pathname === "/api/me") {
        return getAuthApi().fetch(stripped, env, ctx);
      }
      return (await getFullApi()).fetch(stripped, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const { runCreditRefill } = await import("./jobs/refill");
        await runCreditRefill(env);
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
