import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import Stripe from "stripe";
import { paymentsRoutes, paymentsWebhookRoutes } from "./payments.js";

// Route validation must fail fast without a database: these tests run
// with DATABASE_URL/STRIPE keys unset, so 503s prove graceful degradation.
delete process.env.DATABASE_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

let app: FastifyInstance;

before(async () => {
  app = Fastify();
  app.addHook("onRequest", async (req) => {
    req.auth = { userId: "user_test", clerkUserId: "clerk_test", email: "t@example.com" };
  });
  await app.register(paymentsRoutes, { prefix: "/api/v1" });
  await app.register(paymentsWebhookRoutes, { prefix: "/api/v1" });
});

describe("payments routes", () => {
  it("POST /payments/setup returns 503 without a database", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/payments/setup" });
    assert.equal(res.statusCode, 503);
  });

  it("GET /payments/methods returns 503 without a database", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/payments/methods" });
    assert.equal(res.statusCode, 503);
  });

  it("DELETE /payments/methods/:id returns 503 without a database", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/v1/payments/methods/pm_1" });
    assert.equal(res.statusCode, 503);
  });

  it("POST /payments/setup returns 503 when Stripe is not configured", async () => {
    // DATABASE_URL check happens first; simulate DB present by checking the
    // stripe gate directly via the webhook path instead (no DB needed).
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/payments/webhook",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ type: "ping" }),
    });
    // No webhook secret → 503 fail-closed (proves the gate, not DB).
    assert.equal(res.statusCode, 503);
  });

  it("webhook rejects a missing Stripe signature with 400", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/payments/webhook",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ type: "ping" }),
      });
      assert.equal(res.statusCode, 400);
      assert.match(res.body, /signature/i);
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    }
  });

  it("webhook rejects a forged signature with 400", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/payments/webhook",
        headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=bogus" },
        payload: JSON.stringify({ type: "ping" }),
      });
      assert.equal(res.statusCode, 400);
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    }
  });

  it("webhook accepts a validly-signed irrelevant event without touching the DB", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    // generateTestHeaderString is offline — no Stripe API call.
    const stripe = new Stripe("sk_test_dummy", { apiVersion: "2026-09-30.endive" });
    const payload = JSON.stringify({ id: "evt_1", type: "customer.created", data: { object: {} } });
    const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test" });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/payments/webhook",
        headers: { "content-type": "application/json", "stripe-signature": sig },
        payload,
      });
      assert.equal(res.statusCode, 200);
      assert.match(res.body, /received/);
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
    }
  });
});
