import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import Stripe from "stripe";
import {
  DatabaseNotConfiguredError,
  getPrisma,
  type PrismaClient,
} from "@moviewatch/database";
import { requireStripe, resetStripeCache, paymentMethodMeta, StripeNotConfiguredError } from "../lib/stripe.js";
import { writeAudit } from "../lib/audit.js";
import { sendError } from "../lib/errors.js";

/**
 * Payment routes (Milestone 5).
 *
 *   POST   /api/v1/payments/setup          (auth) create Stripe Checkout (setup mode)
 *   GET    /api/v1/payments/methods        (auth) list saved cards
 *   DELETE /api/v1/payments/methods/:id    (auth) detach + delete a card
 *
 * The webhook lives in `paymentsWebhookRoutes` (public — Stripe calls it,
 * signature-verified) and is registered OUTSIDE the auth plugin in index.ts.
 *
 * SECURITY: raw PANs never touch our systems. We store only Stripe's
 * payment-method IDs plus display metadata. Charges require explicit user
 * consent + spending caps (see monitor.ts).
 */

type Db = PrismaClient;

function dbOr503(reply: FastifyReply): Db | null {
  try {
    return getPrisma();
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      sendError(reply, 503, err.message);
      return null;
    }
    throw err;
  }
}

function stripeOr503(reply: FastifyReply): ReturnType<typeof requireStripe> | null {
  try {
    return requireStripe();
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      sendError(reply, 503, err.message);
      return null;
    }
    throw err;
  }
}

function webOrigin(): string {
  return process.env.WEB_ORIGIN ?? "http://localhost:3000";
}

export async function paymentsRoutes(app: FastifyInstance) {
  // --- Create a Checkout Session (setup mode) for card collection ----------
  app.post("/payments/setup", async (req, reply) => {
    const db = dbOr503(reply);
    if (!db) return;
    const stripe = stripeOr503(reply);
    if (!stripe) return;
    const userId = req.auth.userId;

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) return sendError(reply, 404, "User not found");

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id, clerkUserId: user.clerkUserId },
      });
      customerId = customer.id;
      await db.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
    }

    const origin = webOrigin();
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customerId,
      success_url: `${origin}/watches/new?payment=added`,
      cancel_url: `${origin}/watches/new?payment=cancelled`,
      metadata: { userId: user.id },
      currency: "usd",
    });

    await writeAudit(db, {
      actorType: "user",
      actorId: userId,
      action: "payment.setup_started",
      resourceType: "User",
      resourceId: userId,
    });

    return { checkoutUrl: session.url };
  });

  // --- List saved payment methods ------------------------------------------
  app.get("/payments/methods", async (req, reply) => {
    const db = dbOr503(reply);
    if (!db) return;
    const methods = await db.paymentMethod.findMany({
      where: { userId: req.auth.userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    });
    return {
      methods: methods.map((m) => ({
        id: m.id,
        brand: m.brand,
        last4: m.last4,
        expMonth: m.expMonth,
        expYear: m.expYear,
        isDefault: m.isDefault,
      })),
    };
  });

  // --- Delete a payment method ----------------------------------------------
  app.delete("/payments/methods/:id", async (req, reply) => {
    const db = dbOr503(reply);
    if (!db) return;
    const stripe = stripeOr503(reply);
    if (!stripe) return;
    const userId = req.auth.userId;
    const id = (req.params as { id: string }).id;

    const method = await db.paymentMethod.findFirst({ where: { id, userId } });
    if (!method) return sendError(reply, 404, "Payment method not found");

    // Detach in Stripe first; our row goes away only after Stripe confirms.
    try {
      await stripe.paymentMethods.detach(method.stripePaymentMethodId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendError(reply, 502, "Stripe detach failed", undefined, msg.slice(0, 200));
    }

    await db.$transaction(async (tx) => {
      await tx.paymentMethod.delete({ where: { id: method.id } });
      if (method.isDefault) {
        const next = await tx.paymentMethod.findFirst({
          where: { userId },
          orderBy: { createdAt: "asc" },
        });
        if (next) await tx.paymentMethod.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });

    await writeAudit(db, {
      actorType: "user",
      actorId: userId,
      action: "payment.method_removed",
      resourceType: "PaymentMethod",
      resourceId: method.id,
    });
    return { ok: true };
  });
}

/**
 * Stripe webhook — PUBLIC route. Signature verification is mandatory:
 * without STRIPE_WEBHOOK_SECRET we reject everything (fail closed).
 *
 * Needs the RAW body for signature verification, so this plugin installs a
 * string content-type parser scoped to its own routes only.
 */
export async function paymentsWebhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    done(null, body as string);
  });

  app.post("/payments/webhook", async (req, reply) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      return sendError(reply, 503, "Stripe webhook is not configured");
    }
    // Signature verification is pure cryptography — it needs no API key.
    // The API client (with secret) is only built when we must call Stripe.
    const verifier = new Stripe("sk_webhook_verify_only", { apiVersion: "2026-09-30.endive" });
    const sig = req.headers["stripe-signature"];
    if (typeof sig !== "string" || !sig) {
      return sendError(reply, 400, "Missing Stripe signature");
    }

    let event;
    try {
      event = verifier.webhooks.constructEvent(req.body as string, sig, secret);
    } catch {
      return sendError(reply, 400, "Invalid Stripe signature");
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as {
        mode?: string;
        setup_intent?: string;
        customer?: string;
        metadata?: Record<string, string>;
      };
      if (session.mode === "setup" && session.setup_intent && session.metadata?.userId) {
        const stripe = requireStripe();
        await handleSetupComplete(stripe, session.setup_intent as string, session.metadata.userId, session.customer as string | undefined);
      }
    }

    return { received: true };
  });
}

async function handleSetupComplete(
  stripe: ReturnType<typeof requireStripe>,
  setupIntentId: string,
  userId: string,
  customerId: string | undefined,
): Promise<void> {
  const db = getPrisma();
  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
  const pmId = typeof setupIntent.payment_method === "string" ? setupIntent.payment_method : null;
  if (!pmId) return;

  const pm = await stripe.paymentMethods.retrieve(pmId);
  const meta = paymentMethodMeta(pm);

  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) return;
    if (customerId && !user.stripeCustomerId) {
      await tx.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
    }
    const existing = await tx.paymentMethod.count({ where: { userId } });
    await tx.paymentMethod.upsert({
      where: { stripePaymentMethodId: pmId },
      update: { brand: meta.brand, last4: meta.last4, expMonth: meta.expMonth, expYear: meta.expYear },
      create: {
        userId,
        stripePaymentMethodId: pmId,
        brand: meta.brand,
        last4: meta.last4,
        expMonth: meta.expMonth,
        expYear: meta.expYear,
        isDefault: existing === 0,
      },
    });
  });

  await writeAudit(db, {
    actorType: "system",
    actorId: "stripe-webhook",
    action: "payment.method_added",
    resourceType: "User",
    resourceId: userId,
  });
}

/** For tests: reset module state. */
export function __resetPaymentsForTests(): void {
  resetStripeCache();
}
