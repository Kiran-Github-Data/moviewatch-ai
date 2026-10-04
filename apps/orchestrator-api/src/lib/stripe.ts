import Stripe from "stripe";

/**
 * Stripe client for saved cards + off-session auto-booking charges.
 *
 * The secret key is read lazily (not at import time) so unit tests and
 * unconfigured environments boot fine. `requireStripe()` throws a 503-style
 * error when STRIPE_SECRET_KEY is missing — callers map it to 503.
 *
 * SECURITY: the secret key must never be logged or returned to clients.
 * Raw card PANs never touch our systems — only Stripe payment-method IDs.
 */

let cached: Stripe | null = null;

export class StripeNotConfiguredError extends Error {
  readonly statusCode = 503;
  constructor() {
    super("Stripe is not configured. Set STRIPE_SECRET_KEY on the API server.");
    this.name = "StripeNotConfiguredError";
  }
}

/** Returns a Stripe client, or throws StripeNotConfiguredError. */
export function requireStripe(apiKey?: string): Stripe {
  const key = apiKey ?? process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeNotConfiguredError();
  // Cache per key so repeated calls don't rebuild the client.
  if (cached && (cached as unknown as { _mwKey?: string })._mwKey === key) return cached;
  const client = new Stripe(key, { apiVersion: "2026-09-30.endive" });
  (client as unknown as { _mwKey?: string })._mwKey = key;
  cached = client;
  return client;
}

/** For tests: drop the cached client. */
export function resetStripeCache(): void {
  cached = null;
}

/** Display metadata for a Stripe payment method (safe to store/return). */
export function paymentMethodMeta(pm: Stripe.PaymentMethod): {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
} {
  const card = pm.card;
  return {
    brand: card?.brand ?? "unknown",
    last4: card?.last4 ?? "••••",
    expMonth: card?.exp_month ?? 0,
    expYear: card?.exp_year ?? 0,
  };
}
