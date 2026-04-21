import type { Env } from "../env";
import { id, now } from "../lib/ids";
import { PRO_MONTHLY_CREDITS } from "../lib/pricing";

// Daily cron: top up pro users whose last refill was > 30 days ago.
export async function runCreditRefill(env: Env) {
  const thirtyDays = 60 * 60 * 24 * 30;
  const threshold = now() - thirtyDays;

  const due = await env.DB.prepare(
    `SELECT sc.user_id FROM stripe_customers sc
     JOIN users u ON u.id = sc.user_id
     WHERE sc.plan = 'pro'
       AND u.status = 'active'
       AND (sc.last_refill_at IS NULL OR sc.last_refill_at <= ?)`,
  )
    .bind(threshold)
    .all<{ user_id: string }>();

  for (const row of due.results) {
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET credits = credits + ? WHERE id = ?")
        .bind(PRO_MONTHLY_CREDITS, row.user_id),
      env.DB.prepare(
        "INSERT INTO credit_ledger (id, user_id, delta, reason, created_at) VALUES (?, ?, ?, 'monthly_refill', ?)",
      ).bind(id("led"), row.user_id, PRO_MONTHLY_CREDITS, now()),
      env.DB.prepare("UPDATE stripe_customers SET last_refill_at = ? WHERE user_id = ?")
        .bind(now(), row.user_id),
    ]);
  }
}
