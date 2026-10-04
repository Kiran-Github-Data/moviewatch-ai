import type { PrismaClient } from "@moviewatch/database";
import { canTransition, type WatchStatus } from "@moviewatch/contracts";
import { requireStripe, StripeNotConfiguredError } from "./stripe.js";
import { writeAudit } from "./audit.js";
import { SerpApiTicketProvider } from "./serpapi-provider.js";
import {
  sendEmail,
  ticketsAvailableEmail,
  bookingConfirmedEmail,
  paymentFailedEmail,
  money,
} from "./email.js";

/**
 * Watch monitoring agent (Milestone 5).
 *
 * Every cycle the worker asks each ARMED/MONITORING watch: are tickets
 * available within the user's rules? The `TicketProvider` interface is the
 * seam — `MockTicketProvider` returns nothing by default (safe), while the
 * production Atom Tickets provider plugs in here (PLAN.md §6).
 *
 * Safety invariants (enforced in code, not just docs):
 * - NEVER charge without autoBookEnabled + consentAt + a saved card.
 * - NEVER charge more than the watch's maxTotalCents.
 * - Every charge attempt and state transition is hash-chained in AuditLog.
 * - A failed payment attempt suppresses re-attempts for 1h (audit-checked)
 *   so a bad card isn't hammered every cycle.
 */

export interface TicketOffer {
  theaterId: string;
  theaterName: string;
  /** Human display, e.g. "Fri, Dec 18 · 7:30 PM". */
  showtime: string;
  /** Price per ticket in cents. 0 = "price unknown" (provider has no pricing). */
  pricePerTicketCents: number;
  bookingUrl: string;
  /** Seats remaining, when the provider reports it. */
  availableInventory?: number;
}

export interface WatchForCheck {
  id: string;
  userId: string;
  userEmail: string;
  movieTitle: string;
  tmdbId: number;
  status: string;
  zip: string;
  actionMode: string;
  autoBookEnabled: boolean;
  consentAt: Date | null;
  maxTotalCents: number | null;
  ticketCount: number;
  maxTicketPriceCents: number;
  theatersRank1: string[];
  theatersRank2: string[];
  defaultPaymentMethodId: string | null;
  defaultPaymentMethodLast4: string | null;
  stripeCustomerId: string | null;
}

export interface TicketProvider {
  findOffers(watch: WatchForCheck): Promise<TicketOffer[]>;
}

/** Default provider: no tickets, ever. Safe until a real rail is wired. */
export class MockTicketProvider implements TicketProvider {
  async findOffers(_watch: WatchForCheck): Promise<TicketOffer[]> {
    return [];
  }
}

/**
 * Demo/test provider driven by `MOCK_TICKETS_JSON` env var:
 * a JSON array of TicketOffer. Lets the full auto-book flow run end to end
 * without a ticketing partnership.
 */
export class EnvTicketProvider implements TicketProvider {
  async findOffers(watch: WatchForCheck): Promise<TicketOffer[]> {
    const raw = process.env.MOCK_TICKETS_JSON;
    if (!raw) return [];
    try {
      const offers = JSON.parse(raw) as TicketOffer[];
      if (!Array.isArray(offers)) return [];
      return offers.filter(
        (o) =>
          typeof o.theaterId === "string" &&
          typeof o.pricePerTicketCents === "number" &&
          watch.theatersRank1.concat(watch.theatersRank2).includes(o.theaterId),
      );
    } catch {
      return [];
    }
  }
}

/**
 * Resolve watch theater IDs (our directory) to display names for providers
 * that match on names (e.g. SerpApi). Best-effort: missing rows resolve to
 * the raw ID, which still matches when IDs are human-readable.
 */
export async function resolveTheaterNames(
  db: PrismaClient,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  try {
    const rows = await db.theater.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    for (const r of rows) map.set(r.id, r.name);
  } catch {
    // Best-effort: fall through with an empty map.
  }
  return map;
}

/**
 * Provider selection (single authority):
 *  1. MOCK_TICKETS_JSON set → EnvTicketProvider (demos/tests).
 *  2. SERPAPI_API_KEY set → SerpApiTicketProvider (interim real feed).
 *  3. otherwise → MockTicketProvider (safe: no tickets, ever).
 */
export function selectTicketProvider(db?: PrismaClient): TicketProvider {
  if (process.env.MOCK_TICKETS_JSON) return new EnvTicketProvider();
  if (process.env.SERPAPI_API_KEY) {
    return new SerpApiTicketProvider({
      resolveTheaterNames: db ? (ids) => resolveTheaterNames(db, ids) : undefined,
    });
  }
  return new MockTicketProvider();
}

/** Minimal Stripe surface the monitor needs (injectable for tests). */
export interface ChargeClient {
  paymentIntents: {
    create(
      params: Record<string, unknown>,
      opts?: Record<string, unknown>,
    ): Promise<{ status: string }>;
  };
}

export interface MonitorDeps {
  db: PrismaClient;
  provider?: TicketProvider;
  stripeClient?: ChargeClient;
  now?: Date;
}

export type CheckResult =
  | { outcome: "skipped"; reason: string }
  | { outcome: "no_tickets" }
  | { outcome: "tickets_notified" }
  | { outcome: "booked"; totalCents: number }
  | { outcome: "payment_failed"; reason: string }
  | { outcome: "over_cap"; totalCents: number };

const PAYMENT_RETRY_SUPPRESS_MS = 60 * 60 * 1000; // 1h

function webOrigin(): string {
  return process.env.WEB_ORIGIN ?? "http://localhost:3000";
}

async function transition(
  db: PrismaClient,
  watchId: string,
  from: string,
  to: WatchStatus,
  action: string,
  actorId: string,
): Promise<boolean> {
  if (!canTransition(from as WatchStatus, to)) {
    await writeAudit(db, {
      actorType: "system",
      actorId: "monitor",
      action: "monitor.invalid_transition_skipped",
      resourceType: "MovieWatch",
      resourceId: watchId,
    });
    return false;
  }
  await db.movieWatch.update({ where: { id: watchId }, data: { status: to } });
  await writeAudit(db, {
    actorType: "system",
    actorId,
    action,
    resourceType: "MovieWatch",
    resourceId: watchId,
  });
  return true;
}

async function recentPaymentFailure(db: PrismaClient, watchId: string, now: Date): Promise<boolean> {
  const last = await db.auditLog.findFirst({
    where: { resourceType: "MovieWatch", resourceId: watchId, action: "booking.payment_failed" },
    orderBy: { createdAt: "desc" },
  });
  return !!last && now.getTime() - last.createdAt.getTime() < PAYMENT_RETRY_SUPPRESS_MS;
}

async function loadWatchForCheck(db: PrismaClient, watchId: string): Promise<WatchForCheck | null> {
  const w = await db.movieWatch.findUnique({
    where: { id: watchId },
    include: { preferences: true, user: { include: { paymentMethods: true } } },
  });
  if (!w || !w.preferences[0]) return null;
  const pref = w.preferences[0];
  const def = w.user.paymentMethods.find((p) => p.isDefault) ?? w.user.paymentMethods[0];
  return {
    id: w.id,
    userId: w.userId,
    userEmail: w.user.email,
    movieTitle: w.movieTitle,
    tmdbId: w.tmdbId,
    status: w.status,
    zip: w.zip,
    actionMode: w.actionMode,
    autoBookEnabled: w.autoBookEnabled,
    consentAt: w.consentAt,
    maxTotalCents: w.maxTotalCents,
    ticketCount: pref.ticketCount,
    maxTicketPriceCents: pref.maxTicketPriceCents,
    theatersRank1: pref.theatersRank1,
    theatersRank2: pref.theatersRank2,
    defaultPaymentMethodId: def?.id ?? null,
    defaultPaymentMethodLast4: def?.last4 ?? null,
    stripeCustomerId: w.user.stripeCustomerId,
  };
}

/**
 * One monitoring pass for a single watch. All side effects (state,
 * charges, emails, audits) happen here.
 */
export async function checkWatchAvailability(
  watchId: string,
  deps: MonitorDeps,
): Promise<CheckResult> {
  const db = deps.db;
  const now = deps.now ?? new Date();
  const provider = deps.provider ?? selectTicketProvider(db);

  const watch = await loadWatchForCheck(db, watchId);
  if (!watch) return { outcome: "skipped", reason: "watch not found" };
  if (watch.status !== "ARMED" && watch.status !== "MONITORING") {
    return { outcome: "skipped", reason: `status ${watch.status} is not monitored` };
  }

  // First check moves ARMED → MONITORING (audit-chained).
  let status = watch.status;
  if (status === "ARMED") {
    const ok = await transition(db, watch.id, status, "MONITORING", "monitor.started", "monitor");
    if (ok) status = "MONITORING";
  }

  const offers = await provider.findOffers(watch);
  const matching = offers.filter((o) => o.pricePerTicketCents <= watch.maxTicketPriceCents);
  if (matching.length === 0) return { outcome: "no_tickets" };

  // Cheapest matching offer wins.
  const best = matching.reduce((a, b) => (a.pricePerTicketCents <= b.pricePerTicketCents ? a : b));
  const totalCents = best.pricePerTicketCents * watch.ticketCount;

  const canAutoBook =
    watch.actionMode === "autobook" &&
    watch.autoBookEnabled &&
    watch.consentAt !== null &&
    watch.maxTotalCents !== null &&
    watch.defaultPaymentMethodId !== null &&
    watch.stripeCustomerId !== null;

  // Providers without pricing (e.g. SerpApi) report pricePerTicketCents = 0
  // ("price unknown"). Never auto-charge an unknown price — fall back to the
  // notify path so the user sees real prices via the booking link.
  const priceKnown = best.pricePerTicketCents > 0;

  if (!canAutoBook || !priceKnown) {
    // User chose "notify" mode, or auto-book prerequisites aren't met:
    // send an email alert with booking link.
    await transition(db, watch.id, status, "TICKETS_DETECTED", "monitor.tickets_detected", "monitor");
    const { subject, html } = ticketsAvailableEmail({
      movieTitle: watch.movieTitle,
      theaterName: best.theaterName,
      showtime: best.showtime,
      pricePerTicketCents: best.pricePerTicketCents,
      ticketCount: watch.ticketCount,
      bookingUrl: best.bookingUrl,
    });
    await sendEmail({ to: watch.userEmail, subject, html });
    return { outcome: "tickets_notified" };
  }

  // Safety: never exceed the user's cap, even if per-ticket price is fine.
  const cap = watch.maxTotalCents as number;
  if (totalCents > cap) {
    await transition(db, watch.id, status, "TICKETS_DETECTED", "monitor.tickets_over_cap", "monitor");
    return { outcome: "over_cap", totalCents };
  }

  // Suppress re-attempts shortly after a failure (bad card hammering).
  if (await recentPaymentFailure(db, watch.id, now)) {
    return { outcome: "payment_failed", reason: "suppressed: recent failure" };
  }

  // --- Attempt the off-session charge ------------------------------------
  // Safety: the client is injectable for tests; in production it is the
  // real Stripe client built from STRIPE_SECRET_KEY.
  let stripe: ChargeClient | undefined = deps.stripeClient;
  if (!stripe) {
    try {
      stripe = requireStripe() as unknown as ChargeClient;
    } catch (err) {
      if (err instanceof StripeNotConfiguredError) {
        return { outcome: "skipped", reason: "stripe not configured" };
      }
      throw err;
    }
  }

  const pmRow = await db.paymentMethod.findFirst({
    where: { id: watch.defaultPaymentMethodId as string, userId: watch.userId },
  });
  if (!pmRow) return { outcome: "payment_failed", reason: "saved card not found" };

  // Walk the state machine toward CHECKOUT (each step audit-chained).
  const chain: WatchStatus[] = [
    "TICKETS_DETECTED",
    "MATCHING_OPTIONS",
    "OPTION_SELECTED",
    "RESERVING_SEATS",
    "CHECKOUT",
  ];
  let cur = status;
  for (const next of chain) {
    if (cur === next) continue;
    const ok = await transition(db, watch.id, cur, next, `monitor.${next.toLowerCase()}`, "monitor");
    if (!ok) return { outcome: "skipped", reason: `cannot transition ${cur} → ${next}` };
    cur = next;
  }

  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create(
      {
        amount: totalCents,
        currency: "usd",
        customer: watch.stripeCustomerId as string,
        payment_method: pmRow.stripePaymentMethodId,
        off_session: true,
        confirm: true,
        description: `MovieWatch AI: ${watch.ticketCount}x ${watch.movieTitle} @ ${best.theaterName}`,
        metadata: { watchId: watch.id, userId: watch.userId, offerTheater: best.theaterId },
      },
      { idempotencyKey: `mw-${watch.id}-${now.toISOString().slice(0, 10)}` },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await transition(db, watch.id, cur, "PAYMENT_FAILED", "booking.payment_failed", "monitor");
    await writeAudit(db, {
      actorType: "system",
      actorId: "monitor",
      action: "booking.payment_failed",
      resourceType: "MovieWatch",
      resourceId: watch.id,
    });
    const { subject, html } = paymentFailedEmail({
      movieTitle: watch.movieTitle,
      amountCents: totalCents,
      reason: friendlyStripeError(reason),
      appUrl: `${webOrigin()}/watches/new?payment=failed`,
    });
    await sendEmail({ to: watch.userEmail, subject, html });
    return { outcome: "payment_failed", reason: reason.slice(0, 200) };
  }

  if (paymentIntent.status !== "succeeded") {
    await transition(db, watch.id, cur, "PAYMENT_FAILED", "booking.payment_failed", "monitor");
    return { outcome: "payment_failed", reason: `intent status ${paymentIntent.status}` };
  }

  await transition(db, watch.id, cur, "BOOKED", "booking.confirmed", "monitor");
  await writeAudit(db, {
    actorType: "system",
    actorId: "monitor",
    action: "booking.charged",
    resourceType: "MovieWatch",
    resourceId: watch.id,
  });

  const { subject, html } = bookingConfirmedEmail({
    movieTitle: watch.movieTitle,
    theaterName: best.theaterName,
    showtime: best.showtime,
    ticketCount: watch.ticketCount,
    totalChargedCents: totalCents,
    last4: pmRow.last4,
    appUrl: `${webOrigin()}/watches`,
  });
  await sendEmail({ to: watch.userEmail, subject, html });

  return { outcome: "booked", totalCents };
}

function friendlyStripeError(raw: string): string {
  if (/declined|card_declined/i.test(raw)) return "Your card was declined.";
  if (/insufficient/i.test(raw)) return "Insufficient funds on the card.";
  if (/expired/i.test(raw)) return "The card has expired.";
  return "The charge could not be completed. Please check your payment method.";
}

/** One full cycle: check every ARMED/MONITORING watch. Returns a summary. */
export async function runMonitorCycle(deps: MonitorDeps): Promise<Record<string, number>> {
  const summary: Record<string, number> = {};
  const watches = await deps.db.movieWatch.findMany({
    where: { status: { in: ["ARMED", "MONITORING"] } },
    select: { id: true },
  });
  for (const w of watches) {
    try {
      const res = await checkWatchAvailability(w.id, deps);
      summary[res.outcome] = (summary[res.outcome] ?? 0) + 1;
    } catch (err) {
      summary.error = (summary.error ?? 0) + 1;
      await writeAudit(deps.db, {
        actorType: "system",
        actorId: "monitor",
        action: "monitor.check_error",
        resourceType: "MovieWatch",
        resourceId: w.id,
      }).catch(() => {});
      void err;
    }
  }
  return summary;
}

export function formatMoney(cents: number): string {
  return money(cents);
}
