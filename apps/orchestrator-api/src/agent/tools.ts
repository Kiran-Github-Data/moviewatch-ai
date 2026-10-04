/**
 * LangChain tools for the MovieWatch ticket-monitoring deep agent.
 *
 * Three tools:
 *  - check_showtimes  — deterministic fetch of current ticket offers via the
 *                       existing TicketProvider seam (src/lib/monitor.ts).
 *  - send_email_alert — sends an email via the existing Resend helper.
 *  - purchase_tickets — SAFETY-CRITICAL. All money gates are enforced here in
 *                       CODE. The LLM can never bypass them:
 *                         1. watch.actionMode must be "autobook"
 *                         2. watch.consentAt must be set (explicit purchase auth)
 *                         3. totalCents must be <= watch.maxTotalCents
 *                         4. a default payment method + Stripe customer must exist
 *                       If ANY gate fails the tool returns "REFUSED: <reason>"
 *                       and no charge is attempted.
 */
import { tool } from "langchain";
import { z } from "zod";
import type { PrismaClient } from "@moviewatch/database";
import {
  EnvTicketProvider,
  MockTicketProvider,
  type TicketOffer,
  type TicketProvider,
  type WatchForCheck,
} from "../lib/monitor.js";
import {
  sendEmail,
  ticketsAvailableEmail,
  bookingConfirmedEmail,
  paymentFailedEmail,
} from "../lib/email.js";
import { requireStripe, StripeNotConfiguredError } from "../lib/stripe.js";
import { writeAudit } from "../lib/audit.js";

export interface AgentDeps {
  db: PrismaClient;
  provider?: TicketProvider;
  /** Injectable Stripe client (tests). Defaults to requireStripe(). */
  stripeClient?: {
    paymentIntents: {
      create(
        params: Record<string, unknown>,
        opts?: Record<string, unknown>,
      ): Promise<{ status: string; id?: string }>;
    };
  };
}

function defaultProvider(): TicketProvider {
  return process.env.MOCK_TICKETS_JSON ? new EnvTicketProvider() : new MockTicketProvider();
}

function webOrigin(): string {
  return process.env.WEB_ORIGIN ?? "http://localhost:3000";
}

/** Load a watch in the shape the monitor/agent needs. Returns null if missing. */
export async function loadWatchForAgent(
  db: PrismaClient,
  watchId: string,
): Promise<WatchForCheck | null> {
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

const checkShowtimesSchema = z.object({
  watchId: z.string().describe("The MovieWatch ID to check for ticket offers."),
});

const sendEmailAlertSchema = z.object({
  to: z.string().email().describe("Recipient email address."),
  subject: z.string().describe("Email subject line."),
  html: z.string().describe("Full HTML body of the alert email."),
});

const purchaseTicketsSchema = z.object({
  watchId: z.string().describe("The MovieWatch ID to purchase tickets for."),
  offerId: z
    .string()
    .describe(
      "The offerId (theaterId) from check_showtimes for the offer to purchase.",
    ),
});

/** Deterministic: fetch current offers for a watch. No LLM judgment. */
export function checkShowtimes(deps: AgentDeps) {
  const provider = deps.provider ?? defaultProvider();
  return tool(
    async ({ watchId }: z.infer<typeof checkShowtimesSchema>): Promise<string> => {
      const watch = await loadWatchForAgent(deps.db, watchId);
      if (!watch) return JSON.stringify({ error: "watch not found" });
      const offers: TicketOffer[] = await provider.findOffers(watch);
      return JSON.stringify(
        offers.map((o) => ({
          offerId: o.theaterId,
          theaterName: o.theaterName,
          showtime: o.showtime,
          pricePerTicketCents: o.pricePerTicketCents,
          bookingUrl: o.bookingUrl,
        })),
      );
    },
    {
      name: "check_showtimes",
      description:
        "Fetch current ticket offers for a watch. Returns a JSON array of offers " +
        "with offerId, theaterName, showtime, pricePerTicketCents, bookingUrl. " +
        "Returns an empty array when no tickets are available.",
      schema: checkShowtimesSchema,
    },
  );
}

/** Deterministic: send an email alert. Best-effort (never throws). */
export function sendEmailAlert(deps: AgentDeps) {
  return tool(
    async ({ to, subject, html }: z.infer<typeof sendEmailAlertSchema>): Promise<string> => {
      const result = await sendEmail({ to, subject, html });
      if (result.sent) {
        await writeAudit(deps.db, {
          actorType: "agent",
          actorId: "watch-agent",
          action: "agent.email_alert_sent",
          resourceType: "Email",
          resourceId: result.id ?? "unknown",
        }).catch(() => {});
        return `Email sent: ${result.id ?? "ok"}`;
      }
      return `Email NOT sent: ${result.reason ?? "unknown reason"}`;
    },
    {
      name: "send_email_alert",
      description:
        "Send an email alert to the user. Use for 'notify' mode watches when a " +
        "matching offer is found. Input: to, subject, html (full HTML body).",
      schema: sendEmailAlertSchema,
    },
  );
}

export interface PurchaseGuards {
  allowed: boolean;
  reason?: string;
  watch?: WatchForCheck;
  offer?: TicketOffer;
  totalCents?: number;
}

/**
 * Evaluate the hard purchase gates in code. The LLM never decides these —
 * this function is the single authority on whether a charge may proceed.
 */
export async function evaluatePurchaseGuards(
  db: PrismaClient,
  provider: TicketProvider,
  watchId: string,
  offerId: string,
): Promise<PurchaseGuards> {
  const watch = await loadWatchForAgent(db, watchId);
  if (!watch) return { allowed: false, reason: "watch not found" };

  // GATE 1: actionMode must be "autobook". This is set at watch creation by
  // the user — the LLM cannot change it.
  if (watch.actionMode !== "autobook") {
    return {
      allowed: false,
      reason: `actionMode is "${watch.actionMode}", not "autobook". Purchase refused.`,
    };
  }
  // GATE 2: explicit purchase authorization must exist.
  if (!watch.autoBookEnabled || watch.consentAt === null) {
    return {
      allowed: false,
      reason: "no explicit purchase authorization (consentAt missing). Purchase refused.",
    };
  }

  const offers = await provider.findOffers(watch);
  const offer = offers.find((o) => o.theaterId === offerId);
  if (!offer) {
    return { allowed: false, reason: `offer "${offerId}" not found in current offers. Purchase refused.` };
  }

  const totalCents = offer.pricePerTicketCents * watch.ticketCount;

  // GATE 3: spending cap. The policy engine can only lower this, never raise.
  if (watch.maxTotalCents === null) {
    return { allowed: false, reason: "no spending cap configured. Purchase refused." };
  }
  if (totalCents > watch.maxTotalCents) {
    return {
      allowed: false,
      reason: `total ${totalCents}c exceeds spending cap ${watch.maxTotalCents}c. Purchase refused.`,
      watch,
      offer,
      totalCents,
    };
  }

  // GATE 4: a saved card + Stripe customer must exist.
  if (!watch.defaultPaymentMethodId || !watch.stripeCustomerId) {
    return {
      allowed: false,
      reason: "no saved payment method or Stripe customer. Purchase refused.",
      watch,
      offer,
      totalCents,
    };
  }

  return { allowed: true, watch, offer, totalCents };
}

/**
 * SAFETY-CRITICAL tool. Charges the user's saved card for the selected offer.
 * Every money decision is gated by evaluatePurchaseGuards() — the LLM's only
 * job is picking which offer matches the user's fuzzy preferences.
 */
export function purchaseTickets(deps: AgentDeps) {
  const provider = deps.provider ?? defaultProvider();
  return tool(
    async ({ watchId, offerId }: z.infer<typeof purchaseTicketsSchema>): Promise<string> => {
      const guards = await evaluatePurchaseGuards(deps.db, provider, watchId, offerId);
      if (!guards.allowed) {
        await writeAudit(deps.db, {
          actorType: "agent",
          actorId: "watch-agent",
          action: "agent.purchase_refused",
          resourceType: "MovieWatch",
          resourceId: watchId,
        }).catch(() => {});
        return `REFUSED: ${guards.reason}`;
      }

      const { watch, offer, totalCents } = guards as Required<
        Pick<PurchaseGuards, "watch" | "offer" | "totalCents">
      >;

      // Resolve the Stripe payment-method ID for the default card.
      const pmRow = await deps.db.paymentMethod.findFirst({
        where: { id: watch.defaultPaymentMethodId as string, userId: watch.userId },
      });
      if (!pmRow) {
        return "REFUSED: saved card not found in database.";
      }

      let stripe = deps.stripeClient;
      if (!stripe) {
        try {
          stripe = requireStripe() as unknown as NonNullable<AgentDeps["stripeClient"]>;
        } catch (err) {
          if (err instanceof StripeNotConfiguredError) {
            return "REFUSED: Stripe is not configured on the server.";
          }
          throw err;
        }
      }

      let intent: { status: string; id?: string };
      try {
        intent = await stripe.paymentIntents.create(
          {
            amount: totalCents,
            currency: "usd",
            customer: watch.stripeCustomerId as string,
            payment_method: pmRow.stripePaymentMethodId,
            off_session: true,
            confirm: true,
            description: `MovieWatch AI agent: ${watch.ticketCount}x ${watch.movieTitle} @ ${offer.theaterName}`,
            metadata: {
              watchId: watch.id,
              userId: watch.userId,
              offerTheater: offer.theaterId,
              agent: "watch-agent",
            },
          },
          { idempotencyKey: `mw-agent-${watch.id}-${new Date().toISOString().slice(0, 10)}` },
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        await deps.db.movieWatch
          .update({ where: { id: watch.id }, data: { status: "PAYMENT_FAILED" } })
          .catch(() => {});
        await writeAudit(deps.db, {
          actorType: "agent",
          actorId: "watch-agent",
          action: "agent.purchase_payment_failed",
          resourceType: "MovieWatch",
          resourceId: watch.id,
        }).catch(() => {});
        const { subject, html } = paymentFailedEmail({
          movieTitle: watch.movieTitle,
          amountCents: totalCents,
          reason: "The agent's charge could not be completed. Please check your payment method.",
          appUrl: `${webOrigin()}/watches/new?payment=failed`,
        });
        await sendEmail({ to: watch.userEmail, subject, html });
        return `Payment failed: ${reason.slice(0, 200)}`;
      }

      if (intent.status !== "succeeded") {
        await deps.db.movieWatch
          .update({ where: { id: watch.id }, data: { status: "PAYMENT_FAILED" } })
          .catch(() => {});
        return `Payment failed: intent status ${intent.status}`;
      }

      // Success: mark booked, audit-chain, confirm by email.
      await deps.db.movieWatch
        .update({ where: { id: watch.id }, data: { status: "BOOKED" } })
        .catch(() => {});
      await writeAudit(deps.db, {
        actorType: "agent",
        actorId: "watch-agent",
        action: "agent.purchase_charged",
        resourceType: "MovieWatch",
        resourceId: watch.id,
      }).catch(() => {});
      const { subject, html } = bookingConfirmedEmail({
        movieTitle: watch.movieTitle,
        theaterName: offer.theaterName,
        showtime: offer.showtime,
        ticketCount: watch.ticketCount,
        totalChargedCents: totalCents,
        last4: pmRow.last4,
        appUrl: `${webOrigin()}/watches`,
      });
      await sendEmail({ to: watch.userEmail, subject, html });

      return (
        `Purchased ${watch.ticketCount} ticket(s) for "${watch.movieTitle}" ` +
        `at ${offer.theaterName} (${offer.showtime}) — charged ${totalCents}c. ` +
        `Confirmation email sent.`
      );
    },
    {
      name: "purchase_tickets",
      description:
        "Purchase tickets for the selected offer using the user's saved card. " +
        "SAFETY: spending caps, consent, and payment-method checks are enforced " +
        "by the tool itself — it returns REFUSED when any gate fails. Only call " +
        "for watches whose actionMode is 'autobook'.",
      schema: purchaseTicketsSchema,
    },
  );
}

/** Build the alert email body for a notify-mode match (used by the agent). */
export function buildNotifyAlertEmail(args: {
  movieTitle: string;
  theaterName: string;
  showtime: string;
  pricePerTicketCents: number;
  ticketCount: number;
  bookingUrl: string;
}): { subject: string; html: string } {
  return ticketsAvailableEmail({
    movieTitle: args.movieTitle,
    theaterName: args.theaterName,
    showtime: args.showtime,
    pricePerTicketCents: args.pricePerTicketCents,
    ticketCount: args.ticketCount,
    bookingUrl: args.bookingUrl,
  });
}
