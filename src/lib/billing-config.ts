// Stripe price IDs. Swap these for live IDs when moving out of test mode.
// Price IDs are not secret — safe to ship in the client bundle.

export const SUBSCRIPTION_PRICE_ID = "price_REPLACE_SUBSCRIPTION";

export const TOPUPS = [
  { priceId: "price_REPLACE_TOPUP_500", label: "500 credits", credits: 500 },
  { priceId: "price_REPLACE_TOPUP_1500", label: "1,500 credits", credits: 1500 },
  { priceId: "price_REPLACE_TOPUP_5000", label: "5,000 credits", credits: 5000 },
];
