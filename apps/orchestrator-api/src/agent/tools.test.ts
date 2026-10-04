/**
 * Safety tests for the purchase_tickets deep-agent tool.
 *
 * The money gates live in evaluatePurchaseGuards() — code, not the LLM.
 * These tests verify every gate refuses correctly and that a fully-authorized
 * purchase charges exactly the offer total through the injected Stripe client.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  evaluatePurchaseGuards,
  purchaseTickets,
  type AgentDeps,
} from "./tools.js";
import type { TicketOffer, TicketProvider } from "../lib/monitor.js";

// Emails are naturally stubbed: with no RESEND_API_KEY, sendEmail is a no-op.
delete process.env.RESEND_API_KEY;
delete process.env.STRIPE_SECRET_KEY;

const OFFER: TicketOffer = {
  theaterId: "t1",
  theaterName: "Cinemark Frisco Square",
  showtime: "Fri, Dec 18 · 7:30 PM",
  pricePerTicketCents: 1500,
  bookingUrl: "https://example.com/book/t1",
};

class FixedProvider implements TicketProvider {
  constructor(private offers: TicketOffer[]) {}
  async findOffers(): Promise<TicketOffer[]> {
    return this.offers;
  }
}

function makeWatch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "w1",
    userId: "u1",
    movieTitle: "Dune 3",
    tmdbId: 42,
    status: "MONITORING",
    zip: "75078",
    actionMode: "autobook",
    autoBookEnabled: true,
    consentAt: new Date("2026-10-01T00:00:00Z"),
    maxTotalCents: 5000,
    preferences: [
      {
        ticketCount: 2,
        maxTicketPriceCents: 2000,
        theatersRank1: ["t1"],
        theatersRank2: ["t2"],
      },
    ],
    user: {
      email: "fan@example.com",
      stripeCustomerId: "cus_123",
      paymentMethods: [{ id: "pmdb_1", last4: "4242", isDefault: true }],
    },
    ...overrides,
  };
}

function makeDb(
  watch: Record<string, unknown> | null,
  opts: { paymentMethod?: Record<string, unknown> | null } = {},
): { db: unknown; state: { updates: string[]; audits: string[]; charges: Record<string, unknown>[] } } {
  const state = { updates: [] as string[], audits: [] as string[], charges: [] as Record<string, unknown>[] };
  const db = {
    movieWatch: {
      findUnique: async () => watch,
      update: async (args: { where: { id: string }; data: { status: string } }) => {
        state.updates.push(args.data.status);
        if (watch) watch.status = args.data.status;
        return watch;
      },
    },
    paymentMethod: {
      findFirst: async () =>
        "paymentMethod" in opts
          ? opts.paymentMethod
          : {
              id: "pmdb_1",
              stripePaymentMethodId: "pm_123",
              last4: "4242",
              userId: "u1",
            },
    },
    auditLog: {
      findFirst: async () => null,
      create: async (args: { data: Record<string, unknown> }) => {
        state.audits.push(String(args.data.action));
        return args.data;
      },
    },
  };
  return { db, state };
}

function makeStripe() {
  const charges: Record<string, unknown>[] = [];
  return {
    charges,
    client: {
      paymentIntents: {
        create: async (params: Record<string, unknown>) => {
          charges.push(params);
          return { status: "succeeded", id: "pi_test" };
        },
      },
    },
  };
}

describe("evaluatePurchaseGuards", () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("refuses when actionMode is 'notify' (user chose email alerts)", async () => {
    const { db } = makeDb(makeWatch({ actionMode: "notify", autoBookEnabled: false }));
    const g = await evaluatePurchaseGuards(
      db as never,
      new FixedProvider([OFFER]),
      "w1",
      "t1",
    );
    assert.equal(g.allowed, false);
    assert.match(g.reason ?? "", /not "autobook"/);
  });

  it("refuses when there is no explicit consent", async () => {
    const { db } = makeDb(makeWatch({ consentAt: null, autoBookEnabled: false }));
    const g = await evaluatePurchaseGuards(
      db as never,
      new FixedProvider([OFFER]),
      "w1",
      "t1",
    );
    assert.equal(g.allowed, false);
    assert.match(g.reason ?? "", /consent/i);
  });

  it("refuses when the total exceeds the spending cap", async () => {
    // 2 x 1500c = 3000c > 2000c cap
    const { db } = makeDb(makeWatch({ maxTotalCents: 2000 }));
    const g = await evaluatePurchaseGuards(
      db as never,
      new FixedProvider([OFFER]),
      "w1",
      "t1",
    );
    assert.equal(g.allowed, false);
    assert.match(g.reason ?? "", /exceeds spending cap/);
    assert.equal(g.totalCents, 3000);
  });

  it("refuses when no payment method is saved", async () => {
    const watch = makeWatch();
    (watch.user as Record<string, unknown>).paymentMethods = [];
    (watch.user as Record<string, unknown>).stripeCustomerId = null;
    const { db } = makeDb(watch);
    const g = await evaluatePurchaseGuards(
      db as never,
      new FixedProvider([OFFER]),
      "w1",
      "t1",
    );
    assert.equal(g.allowed, false);
    assert.match(g.reason ?? "", /payment method/);
  });

  it("refuses when the offer is not in current offers (stale LLM pick)", async () => {
    const { db } = makeDb(makeWatch());
    const g = await evaluatePurchaseGuards(
      db as never,
      new FixedProvider([OFFER]),
      "w1",
      "t-nonexistent",
    );
    assert.equal(g.allowed, false);
    assert.match(g.reason ?? "", /not found in current offers/);
  });

  it("refuses when the offer price is unknown (provider reports no pricing)", async () => {
    const { db } = makeDb(makeWatch());
    const unknownPriceOffer = { ...OFFER, pricePerTicketCents: 0 };
    const g = await evaluatePurchaseGuards(
      db as never,
      new FixedProvider([unknownPriceOffer]),
      "w1",
      "t1",
    );
    assert.equal(g.allowed, false);
    assert.match(g.reason ?? "", /price unknown/);
  });

  it("allows when all gates pass", async () => {
    const { db } = makeDb(makeWatch());
    const g = await evaluatePurchaseGuards(
      db as never,
      new FixedProvider([OFFER]),
      "w1",
      "t1",
    );
    assert.equal(g.allowed, true);
    assert.equal(g.totalCents, 3000);
  });
});

describe("purchaseTickets tool", () => {
  it("returns REFUSED without charging when actionMode is notify", async () => {
    const stripe = makeStripe();
    const { db, state } = makeDb(makeWatch({ actionMode: "notify", autoBookEnabled: false }));
    const deps: AgentDeps = {
      db: db as never,
      provider: new FixedProvider([OFFER]),
      stripeClient: stripe.client,
    };
    const result = await purchaseTickets(deps).invoke({ watchId: "w1", offerId: "t1" });
    assert.match(String(result), /^REFUSED/);
    assert.equal(stripe.charges.length, 0, "must not charge on refusal");
    assert.ok(state.audits.includes("agent.purchase_refused"));
  });

  it("returns REFUSED without charging when over the spending cap", async () => {
    const stripe = makeStripe();
    const { db } = makeDb(makeWatch({ maxTotalCents: 2000 }));
    const deps: AgentDeps = {
      db: db as never,
      provider: new FixedProvider([OFFER]),
      stripeClient: stripe.client,
    };
    const result = await purchaseTickets(deps).invoke({ watchId: "w1", offerId: "t1" });
    assert.match(String(result), /^REFUSED/);
    assert.equal(stripe.charges.length, 0, "must not charge over cap");
  });

  it("charges exactly the offer total and marks BOOKED when authorized", async () => {
    const stripe = makeStripe();
    const { db, state } = makeDb(makeWatch());
    const deps: AgentDeps = {
      db: db as never,
      provider: new FixedProvider([OFFER]),
      stripeClient: stripe.client,
    };
    const result = await purchaseTickets(deps).invoke({ watchId: "w1", offerId: "t1" });
    assert.match(String(result), /Purchased 2 ticket/);
    assert.equal(stripe.charges.length, 1);
    const charge = stripe.charges[0] as Record<string, unknown>;
    assert.equal(charge.amount, 3000, "charges 2 x 1500c");
    assert.equal((charge.metadata as Record<string, unknown>).watchId, "w1");
    assert.ok(state.updates.includes("BOOKED"));
    assert.ok(state.audits.includes("agent.purchase_charged"));
  });

  it("refuses when the saved card row is missing", async () => {
    const stripe = makeStripe();
    const { db } = makeDb(makeWatch(), { paymentMethod: null });
    const deps: AgentDeps = {
      db: db as never,
      provider: new FixedProvider([OFFER]),
      stripeClient: stripe.client,
    };
    const result = await purchaseTickets(deps).invoke({ watchId: "w1", offerId: "t1" });
    assert.match(String(result), /^REFUSED/);
    assert.equal(stripe.charges.length, 0);
  });
});
