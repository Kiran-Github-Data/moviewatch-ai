import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  checkWatchAvailability,
  runMonitorCycle,
  MockTicketProvider,
  type TicketOffer,
  type WatchForCheck,
} from "./monitor.js";

// Emails are naturally stubbed: with no RESEND_API_KEY, sendEmail is a no-op.
delete process.env.RESEND_API_KEY;
delete process.env.STRIPE_SECRET_KEY;

interface FakeDb {
  watch: Record<string, unknown>;
  audits: Record<string, unknown>[];
  updates: { id: string; status: string }[];
  paymentMethod: Record<string, unknown> | null;
}

function makeWatch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "w1",
    userId: "u1",
    movieTitle: "Dune 3",
    tmdbId: 42,
    status: "ARMED",
    zip: "75078",
    autoBookEnabled: false,
    consentAt: null,
    maxTotalCents: null,
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
      stripeCustomerId: null,
      paymentMethods: [],
    },
    ...overrides,
  };
}

function makeDb(watch: Record<string, unknown> | null, opts: { paymentMethod?: Record<string, unknown> | null } = {}): {
  db: unknown;
  state: { updates: { id: string; status: string }[]; audits: Record<string, unknown>[] };
} {
  const state = { updates: [] as { id: string; status: string }[], audits: [] as Record<string, unknown>[] };
  const db = {
    movieWatch: {
      findUnique: async () => watch,
      findMany: async () => (watch ? [{ id: watch.id }] : []),
      update: async (args: { where: { id: string }; data: { status: string } }) => {
        state.updates.push({ id: args.where.id, status: args.data.status });
        if (watch) watch.status = args.data.status;
        return watch;
      },
    },
    paymentMethod: {
      findFirst: async () => opts.paymentMethod ?? null,
    },
    auditLog: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        const filtered = state.audits.filter((a) =>
          Object.entries(args.where).every(([k, v]) => (a as Record<string, unknown>)[k] === v),
        );
        return filtered[filtered.length - 1] ?? null;
      },
      create: async (args: { data: Record<string, unknown> }) => {
        state.audits.push({ ...args.data, createdAt: new Date() });
        return args.data;
      },
    },
  };
  return { db, state };
}

const offer = (overrides: Partial<TicketOffer> = {}): TicketOffer => ({
  theaterId: "t1",
  theaterName: "Cinemark Frisco",
  showtime: "Fri 7:30 PM",
  pricePerTicketCents: 1800,
  bookingUrl: "https://tickets.example.com/x",
  ...overrides,
});

class ListProvider extends MockTicketProvider {
  constructor(private offers: TicketOffer[]) {
    super();
  }
  override async findOffers(_w: WatchForCheck): Promise<TicketOffer[]> {
    return this.offers;
  }
}

describe("checkWatchAvailability", () => {
  it("skips watches that are not ARMED/MONITORING", async () => {
    const { db } = makeDb(makeWatch({ status: "BOOKED" }));
    const res = await checkWatchAvailability("w1", { db: db as never });
    assert.equal(res.outcome, "skipped");
  });

  it("moves ARMED → MONITORING and reports no_tickets when the provider is empty", async () => {
    const { db, state } = makeDb(makeWatch());
    const res = await checkWatchAvailability("w1", { db: db as never, provider: new MockTicketProvider() });
    assert.equal(res.outcome, "no_tickets");
    assert.deepEqual(state.updates, [{ id: "w1", status: "MONITORING" }]);
    assert.ok(state.audits.some((a) => a.action === "monitor.started"));
  });

  it("notifies (no charge) when tickets are found but auto-book is off", async () => {
    const { db, state } = makeDb(makeWatch({ status: "MONITORING" }));
    const res = await checkWatchAvailability("w1", {
      db: db as never,
      provider: new ListProvider([offer()]),
    });
    assert.equal(res.outcome, "tickets_notified");
    assert.ok(state.updates.some((u) => u.status === "TICKETS_DETECTED"));
  });

  it("ignores offers above the per-ticket max", async () => {
    const { db } = makeDb(makeWatch({ status: "MONITORING" }));
    const res = await checkWatchAvailability("w1", {
      db: db as never,
      provider: new ListProvider([offer({ pricePerTicketCents: 9999 })]),
    });
    assert.equal(res.outcome, "no_tickets");
  });

  it("refuses to exceed maxTotalCents even when per-ticket price is fine", async () => {
    const { db, state } = makeDb(
      makeWatch({
        status: "MONITORING",
        autoBookEnabled: true,
        consentAt: new Date(),
        maxTotalCents: 3000, // 2 × $18 = $36 > $30 cap
        user: {
          email: "fan@example.com",
          stripeCustomerId: "cus_1",
          paymentMethods: [{ id: "pmdb_1", last4: "4242", isDefault: true }],
        },
      }),
      { paymentMethod: { id: "pmdb_1", stripePaymentMethodId: "pm_1", last4: "4242" } },
    );
    let charged = false;
    const res = await checkWatchAvailability("w1", {
      db: db as never,
      provider: new ListProvider([offer()]),
      stripeClient: { paymentIntents: { create: async () => { charged = true; return { status: "succeeded" }; } } },
    });
    assert.equal(res.outcome, "over_cap");
    assert.equal(charged, false);
    assert.ok(state.updates.some((u) => u.status === "TICKETS_DETECTED"));
  });

  it("books and walks to BOOKED on successful charge", async () => {
    const { db, state } = makeDb(
      makeWatch({
        status: "MONITORING",
        autoBookEnabled: true,
        consentAt: new Date(),
        maxTotalCents: 4000,
        user: {
          email: "fan@example.com",
          stripeCustomerId: "cus_1",
          paymentMethods: [{ id: "pmdb_1", last4: "4242", isDefault: true }],
        },
      }),
      { paymentMethod: { id: "pmdb_1", stripePaymentMethodId: "pm_1", last4: "4242" } },
    );
    let chargeParams: Record<string, unknown> = {};
    const res = await checkWatchAvailability("w1", {
      db: db as never,
      provider: new ListProvider([offer()]),
      stripeClient: {
        paymentIntents: {
          create: async (p) => {
            chargeParams = p as Record<string, unknown>;
            return { status: "succeeded" };
          },
        },
      },
    });
    assert.equal(res.outcome, "booked");
    assert.equal(chargeParams.amount, 3600); // 2 × $18
    assert.ok(state.updates.some((u) => u.status === "BOOKED"));
    assert.ok(state.audits.some((a) => a.action === "booking.charged"));
  });

  it("goes to PAYMENT_FAILED (no charge recorded) when Stripe declines", async () => {
    const { db, state } = makeDb(
      makeWatch({
        status: "MONITORING",
        autoBookEnabled: true,
        consentAt: new Date(),
        maxTotalCents: 4000,
        user: {
          email: "fan@example.com",
          stripeCustomerId: "cus_1",
          paymentMethods: [{ id: "pmdb_1", last4: "4242", isDefault: true }],
        },
      }),
      { paymentMethod: { id: "pmdb_1", stripePaymentMethodId: "pm_1", last4: "4242" } },
    );
    const res = await checkWatchAvailability("w1", {
      db: db as never,
      provider: new ListProvider([offer()]),
      stripeClient: {
        paymentIntents: {
          create: async () => {
            throw new Error("Your card was declined.");
          },
        },
      },
    });
    assert.equal(res.outcome, "payment_failed");
    assert.ok(state.updates.some((u) => u.status === "PAYMENT_FAILED"));
    assert.ok(state.audits.some((a) => a.action === "booking.payment_failed"));
  });

  it("suppresses re-attempts within an hour of a failure", async () => {
    const { db } = makeDb(
      makeWatch({
        status: "MONITORING",
        autoBookEnabled: true,
        consentAt: new Date(),
        maxTotalCents: 4000,
        user: {
          email: "fan@example.com",
          stripeCustomerId: "cus_1",
          paymentMethods: [{ id: "pmdb_1", last4: "4242", isDefault: true }],
        },
      }),
      { paymentMethod: { id: "pmdb_1", stripePaymentMethodId: "pm_1", last4: "4242" } },
    );
    // Seed a recent failure audit.
    const fakeDb = db as {
      auditLog: { create(a: { data: Record<string, unknown> }): Promise<unknown> };
    };
    await fakeDb.auditLog.create({
      data: {
        action: "booking.payment_failed",
        resourceType: "MovieWatch",
        resourceId: "w1",
        createdAt: new Date(),
      },
    });
    let charged = false;
    const res = await checkWatchAvailability("w1", {
      db: db as never,
      provider: new ListProvider([offer()]),
      stripeClient: { paymentIntents: { create: async () => { charged = true; return { status: "succeeded" }; } } },
    });
    assert.equal(res.outcome, "payment_failed");
    assert.equal(charged, false);
  });
});

describe("runMonitorCycle", () => {
  it("checks every ARMED/MONITORING watch and summarizes", async () => {
    const { db } = makeDb(makeWatch());
    const summary = await runMonitorCycle({ db: db as never, provider: new MockTicketProvider() });
    assert.equal(summary.no_tickets, 1);
  });
});
