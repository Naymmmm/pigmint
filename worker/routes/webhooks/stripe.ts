import { Hono } from "hono";
import Stripe from "stripe";
import type { Env, AppVariables } from "../../env";
import { id, now } from "../../lib/ids";
import { PRO_MONTHLY_CREDITS } from "../../lib/plans";

type AppEnv = { Bindings: Env; Variables: AppVariables };
export const stripeWebhook = new Hono<AppEnv>();

stripeWebhook.post("/", async (c) => {
  const raw = await c.req.text();
  const sig = c.req.header("stripe-signature");
  if (!sig) return c.json({ error: "no_signature" }, 400);
  const s = new Stripe(c.env.STRIPE_SECRET_KEY, { apiVersion: "2025-02-24.acacia" });

  let event: Stripe.Event;
  try {
    event = await s.webhooks.constructEventAsync(
      raw,
      sig,
      c.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    return c.json({ error: "bad_signature", detail: String(err) }, 400);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      const kind = session.metadata?.kind;
      if (!userId || !kind) break;

      if (kind === "subscription") {
        await upsertSubscriptionFromSession(c.env, userId, session);
      } else if (kind === "topup") {
        const credits = Number(session.metadata?.credits ?? 0);
        if (credits > 0) {
          await grantCredits(c.env, userId, credits, "topup", event.id);
        }
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      // Catches subscriptions created outside our Checkout flow (Stripe
      // dashboard, API, Billing Portal upgrades) as long as the customer's
      // email matches a pigmint user.
      const sub = event.data.object as Stripe.Subscription;
      const userId = await resolveUserIdForCustomer(c.env, s, sub.customer as string);
      if (userId) {
        await upsertSubscriptionFromSub(c.env, userId, sub);
        if (event.type === "customer.subscription.created") {
          await grantCredits(
            c.env,
            userId,
            PRO_MONTHLY_CREDITS,
            "subscription",
            `sub_created:${sub.id}`,
          );
        }
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await c.env.DB.prepare(
        "UPDATE stripe_customers SET subscription_id = NULL, plan = NULL, renews_at = NULL WHERE stripe_customer_id = ?",
      )
        .bind(sub.customer as string)
        .run();
      await c.env.DB.prepare(
        "UPDATE users SET plan = 'free' WHERE id = (SELECT user_id FROM stripe_customers WHERE stripe_customer_id = ?)",
      )
        .bind(sub.customer as string)
        .run();
      break;
    }
    case "invoice.paid": {
      // Monthly renewal — credit the plan's monthly grant.
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.billing_reason === "subscription_cycle" && invoice.customer) {
        const row = await c.env.DB.prepare(
          "SELECT user_id FROM stripe_customers WHERE stripe_customer_id = ?",
        )
          .bind(invoice.customer as string)
          .first<{ user_id: string }>();
        if (row) {
          await grantCredits(c.env, row.user_id, PRO_MONTHLY_CREDITS, "subscription", event.id);
        }
      }
      break;
    }
  }

  return c.json({ received: true });
});

async function upsertSubscriptionFromSession(
  env: Env,
  userId: string,
  session: Stripe.Checkout.Session,
) {
  const customerId = session.customer as string;
  const subscriptionId = session.subscription as string;
  await upsertStripeCustomerRow(env, userId, customerId, subscriptionId, null);
  await grantCredits(env, userId, PRO_MONTHLY_CREDITS, "subscription", session.id);
}

async function upsertSubscriptionFromSub(
  env: Env,
  userId: string,
  sub: Stripe.Subscription,
) {
  const renewsAt = sub.current_period_end ?? null;
  // If the subscription is past-due / cancelled, don't flip plan to pro.
  const isActive = sub.status === "active" || sub.status === "trialing";
  if (!isActive) {
    await env.DB.prepare(
      `UPDATE stripe_customers SET subscription_id = ?, plan = NULL, renews_at = ?
       WHERE stripe_customer_id = ?`,
    )
      .bind(sub.id, renewsAt, sub.customer as string)
      .run();
    await env.DB.prepare("UPDATE users SET plan = 'free' WHERE id = ?")
      .bind(userId)
      .run();
    return;
  }
  await upsertStripeCustomerRow(env, userId, sub.customer as string, sub.id, renewsAt);
}

async function upsertStripeCustomerRow(
  env: Env,
  userId: string,
  customerId: string,
  subscriptionId: string,
  renewsAt: number | null,
) {
  const effectiveRenewsAt = renewsAt ?? now() + 60 * 60 * 24 * 30;
  await env.DB.prepare(
    `INSERT INTO stripe_customers (user_id, stripe_customer_id, subscription_id, plan, renews_at)
     VALUES (?, ?, ?, 'pro', ?)
     ON CONFLICT(user_id) DO UPDATE SET
       stripe_customer_id = excluded.stripe_customer_id,
       subscription_id = excluded.subscription_id,
       plan = 'pro',
       renews_at = excluded.renews_at`,
  )
    .bind(userId, customerId, subscriptionId, effectiveRenewsAt)
    .run();
  await env.DB.prepare("UPDATE users SET plan = 'pro' WHERE id = ?")
    .bind(userId)
    .run();
}

/**
 * Find the pigmint user for a Stripe customer. First check our existing
 * mapping; if none, fetch the customer's email from Stripe and look up by
 * email. Returns null if no pigmint user exists with that email.
 */
async function resolveUserIdForCustomer(
  env: Env,
  s: Stripe,
  customerId: string,
): Promise<string | null> {
  const existing = await env.DB.prepare(
    "SELECT user_id FROM stripe_customers WHERE stripe_customer_id = ?",
  )
    .bind(customerId)
    .first<{ user_id: string }>();
  if (existing) return existing.user_id;

  try {
    const customer = await s.customers.retrieve(customerId);
    if (customer.deleted) return null;
    const email = customer.email?.toLowerCase();
    if (!email) return null;
    const user = await env.DB.prepare(
      "SELECT id FROM users WHERE LOWER(email) = ?",
    )
      .bind(email)
      .first<{ id: string }>();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

async function grantCredits(
  env: Env,
  userId: string,
  amount: number,
  reason: string,
  eventId: string,
) {
  const already = await env.DB.prepare(
    "SELECT 1 FROM credit_ledger WHERE stripe_event_id = ?",
  )
    .bind(eventId)
    .first();
  if (already) return;
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET credits = credits + ? WHERE id = ?")
      .bind(amount, userId),
    env.DB.prepare(
      "INSERT INTO credit_ledger (id, user_id, delta, reason, stripe_event_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(id("led"), userId, amount, reason, eventId, now()),
  ]);
}
