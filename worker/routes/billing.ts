import { Hono } from "hono";
import { z } from "zod";
import Stripe from "stripe";
import type { Env, AppVariables } from "../env";
import { id, now } from "../lib/ids";
import { PRO_MONTHLY_CREDITS } from "../lib/plans";
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
    allow_promotion_codes: true,
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

// Reconcile with Stripe when a subscription was created outside the Checkout
// flow (Stripe dashboard, API, re-linked account). Looks up the customer by
// email, binds it to this user, and flips plan/credits accordingly.
billingRoutes.post("/sync", async (c) => {
  const userId = c.get("userId");
  const email = c.get("userEmail");
  if (!email) return c.json({ error: "no_email" }, 400);

  const s = stripe(c.env);

  // Find customers with this email. Prefer the one that has an active sub.
  const customers = await s.customers.list({ email, limit: 10 });
  if (customers.data.length === 0) {
    return c.json({ synced: false, reason: "no_customer" });
  }

  for (const customer of customers.data) {
    const subs = await s.subscriptions.list({
      customer: customer.id,
      status: "all",
      limit: 10,
    });
    const active = subs.data.find(
      (sub) => sub.status === "active" || sub.status === "trialing",
    );
    if (!active) continue;

    const renewsAt = active.current_period_end ?? now() + 60 * 60 * 24 * 30;

    // Upsert mapping + flip plan.
    await c.env.DB.prepare(
      `INSERT INTO stripe_customers (user_id, stripe_customer_id, subscription_id, plan, renews_at)
       VALUES (?, ?, ?, 'pro', ?)
       ON CONFLICT(user_id) DO UPDATE SET
         stripe_customer_id = excluded.stripe_customer_id,
         subscription_id = excluded.subscription_id,
         plan = 'pro',
         renews_at = excluded.renews_at`,
    )
      .bind(userId, customer.id, active.id, renewsAt)
      .run();
    await c.env.DB.prepare("UPDATE users SET plan = 'pro' WHERE id = ?")
      .bind(userId)
      .run();

    // Grant this cycle's credits if we haven't already (idempotent on
    // sync_<sub_id>_<period_start>).
    const grantKey = `sync:${active.id}:${active.current_period_start ?? 0}`;
    const already = await c.env.DB.prepare(
      "SELECT 1 FROM credit_ledger WHERE stripe_event_id = ?",
    )
      .bind(grantKey)
      .first();
    if (!already) {
      await c.env.DB.batch([
        c.env.DB.prepare("UPDATE users SET credits = credits + ? WHERE id = ?")
          .bind(PRO_MONTHLY_CREDITS, userId),
        c.env.DB.prepare(
          "INSERT INTO credit_ledger (id, user_id, delta, reason, stripe_event_id, created_at) VALUES (?, ?, ?, 'subscription', ?, ?)",
        ).bind(id("led"), userId, PRO_MONTHLY_CREDITS, grantKey, now()),
      ]);
    }

    return c.json({ synced: true, plan: "pro", subscriptionId: active.id });
  }

  return c.json({ synced: false, reason: "no_active_subscription" });
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
