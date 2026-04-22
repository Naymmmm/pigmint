// Single source of truth for Stripe price IDs. Imported by both the Vite
// frontend and the Cloudflare Worker. Price IDs are not secret — safe to
// ship in the client bundle.

export const SUBSCRIPTION_PRICE_ID = "price_1TOcJJRo6CcfGQ6O4wKys4pJ";

export interface TopupOption {
  priceId: string;
  label: string;
  credits: number;
}

export const TOPUPS: TopupOption[] = [
  { priceId: "price_1TOcdIRo6CcfGQ6OwIEVsLsk", label: "500 credits", credits: 500 },
  { priceId: "price_1TOceLRo6CcfGQ6OyGxqVETR", label: "1,500 credits", credits: 1500 },
  { priceId: "price_1TOcg7Ro6CcfGQ6OVe1zCmUX", label: "5,000 credits", credits: 5000 },
];

// Server uses these for validation; derived from the single source above.
export const SUBSCRIPTION_PRICE_IDS = new Set<string>([SUBSCRIPTION_PRICE_ID]);
export const TOPUP_CREDITS: Record<string, number> = Object.fromEntries(
  TOPUPS.map((t) => [t.priceId, t.credits]),
);
