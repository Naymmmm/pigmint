import { Hono } from "hono";
import { z } from "zod";
import Stripe from "stripe";
import type { Env, AppVariables } from "../env";
import { SUBSCRIPTION_PRICE_IDS, TOPUP_CREDITS } from "../../shared/billing";

type AppEnv = { Bindings: Env; Variables: AppVariables };
export const billingRoutes = new Hono<AppEnv>();

function stripe(env: Env) {
  return new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });
}

billingRoutes.get("/status", async (c) => {
  const userId = c.get("userId");
  const [user, sub] = await Promise.all([
    c.env.DB.prepare("SELECT plan, credits, free_remaining FROM users WHERE id = ?")
      .bind(userId)
      .first<{ plan: string; credits: number; free_remaining: number }>(),
    c.env.DB.prepare(
      "SELECT stripe_customer_id, subscription_id, plan, renews_at FROM stripe_customers WHERE user_id = ?",
    )
      .bind(userId)
      .first(),
  ]);
  return c.json({ user, subscription: sub });
});

const checkoutSchema = z.object({
  kind: z.enum(["subscription", "topup"]),
  priceId: z.string(),
});

billingRoutes.post("/checkout", async (c) => {
  const userId = c.get("userId");
  const email = c.get("userEmail");
  const body = checkoutSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: "bad_request" }, 400);

  const { kind, priceId } = body.data;
  let credits: number | undefined;
  if (kind === "subscription") {
    if (!SUBSCRIPTION_PRICE_IDS.has(priceId)) {
      return c.json({ error: "unknown_price" }, 400);
    }
  } else {
    credits = TOPUP_CREDITS[priceId];
    if (!credits) return c.json({ error: "unknown_price" }, 400);
  }

  const s = stripe(c.env);
  const session = await s.checkout.sessions.create({
    mode: kind === "subscription" ? "subscription" : "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: email,
    metadata: {
      userId,
      kind,
      ...(credits ? { credits: String(credits) } : {}),
    },
    success_url: `${c.env.APP_URL}/settings/billing?ok=1`,
    cancel_url: `${c.env.APP_URL}/settings/billing?canceled=1`,
  });
  return c.json({ url: session.url });
});

billingRoutes.post("/portal", async (c) => {
  const userId = c.get("userId");
  const cust = await c.env.DB.prepare(
    "SELECT stripe_customer_id FROM stripe_customers WHERE user_id = ?",
  )
    .bind(userId)
    .first<{ stripe_customer_id: string }>();
  if (!cust) return c.json({ error: "no_customer" }, 404);
  const s = stripe(c.env);
  const portal = await s.billingPortal.sessions.create({
    customer: cust.stripe_customer_id,
    return_url: `${c.env.APP_URL}/settings/billing`,
  });
  return c.json({ url: portal.url });
});
