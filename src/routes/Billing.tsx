import { useQuery, useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { SUBSCRIPTION_PRICE_ID, TOPUPS } from "@/lib/billing-config";

interface BillingStatus {
  user: { plan: string; credits: number; free_remaining: number } | null;
  subscription: { plan: string | null; renews_at: number | null } | null;
}

export default function Billing() {
  const { data } = useQuery<BillingStatus>({
    queryKey: ["billing-status"],
    queryFn: () => apiFetch("/billing/status"),
  });

  const checkout = useMutation({
    mutationFn: (vars: { kind: "subscription" | "topup"; priceId: string }) =>
      apiFetch<{ url: string }>("/billing/checkout", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: (d) => (window.location.href = d.url),
  });

  const portal = useMutation({
    mutationFn: () => apiFetch<{ url: string }>("/billing/portal", { method: "POST" }),
    onSuccess: (d) => (window.location.href = d.url),
  });

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Billing</h1>
      <section className="rounded-lg border border-border bg-card p-4 space-y-1">
        <div className="text-xs text-muted-foreground uppercase">Plan</div>
        <div className="text-lg">{data?.user?.plan ?? "…"}</div>
        <div className="text-sm text-muted-foreground">
          {data?.user?.credits ?? 0} credits · {data?.user?.free_remaining ?? 0} free image generations remaining
        </div>
      </section>

      {data?.user?.plan !== "pro" ? (
        <section className="rounded-lg border border-border p-4 space-y-3">
          <h2 className="font-medium">Upgrade to Pro</h2>
          <p className="text-sm text-muted-foreground">
            500 credits per month, access to video generation, and the prompting assistant.
          </p>
          <button
            onClick={() => checkout.mutate({ kind: "subscription", priceId: SUBSCRIPTION_PRICE_ID })}
            className="bg-primary text-primary-foreground px-4 py-2 rounded text-sm"
          >
            Subscribe
          </button>
        </section>
      ) : (
        <section className="rounded-lg border border-border p-4 space-y-3">
          <h2 className="font-medium">Top up credits</h2>
          <div className="flex gap-2 flex-wrap">
            {TOPUPS.map((t) => (
              <button
                key={t.priceId}
                onClick={() => checkout.mutate({ kind: "topup", priceId: t.priceId })}
                className="bg-secondary text-secondary-foreground px-3 py-2 rounded text-sm"
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => portal.mutate()}
            className="text-sm text-muted-foreground underline"
          >
            Manage subscription
          </button>
        </section>
      )}
    </div>
  );
}
