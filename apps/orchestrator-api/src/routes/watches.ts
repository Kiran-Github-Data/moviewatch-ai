import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  DatabaseNotConfiguredError,
  getPrisma,
  type BookingPreference,
  type MovieWatch,
  type PrismaClient,
} from "@moviewatch/database";
import {
  ArmWatchInputSchema,
  CreateWatchInputSchema,
  UpdateWatchInputSchema,
  canTransition,
  type BookingPreferenceInput,
  type WatchStatus,
} from "@moviewatch/contracts";
import {
  buildPolicyDocument,
  mintPolicy,
  policyHash,
  policyTerms,
  policyTermsHash,
  PolicyError,
  PolicySigningNotConfiguredError,
  type MintPolicyInput,
  type PolicyDocument,
} from "@moviewatch/policy-engine";
import { sendError } from "../lib/errors.js";
import { writeAudit } from "../lib/audit.js";
import { sendEmail, watchCreatedEmail, watchArmedEmail } from "../lib/email.js";

function webOrigin(): string {
  return process.env.WEB_ORIGIN ?? "http://localhost:3000";
}

/** Best-effort "watch created" notification. Never throws (caller catches). */
async function sendWatchCreatedEmail(
  watch: WatchWithPrefs,
  userEmail: string,
): Promise<void> {
  const pref = watch.preferences[0];
  if (!pref) return;
  const { subject, html } = watchCreatedEmail({
    movieTitle: watch.movieTitle,
    zip: watch.zip,
    ticketCount: pref.ticketCount,
    maxTicketPriceCents: pref.maxTicketPriceCents,
    maxTotalCents: watch.maxTotalCents ?? pref.maxTicketPriceCents * pref.ticketCount,
    autoBookEnabled: watch.autoBookEnabled,
    appUrl: `${webOrigin()}/watches`,
  });
  await sendEmail({ to: userEmail, subject, html });
}

/** Best-effort "monitoring armed" notification. Never throws. */
async function sendWatchArmedEmail(watch: WatchWithPrefs, userEmail: string): Promise<void> {
  const { subject, html } = watchArmedEmail({
    movieTitle: watch.movieTitle,
    appUrl: `${webOrigin()}/watches`,
  });
  await sendEmail({ to: userEmail, subject, html });
}

/**
 * Watch lifecycle routes (Milestone 3). All routes are protected and
 * ownership-checked: a user can only ever touch their own watches.
 *
 *   POST   /api/v1/watches              create (CREATED) + policy preview
 *   GET    /api/v1/watches              list own watches
 *   GET    /api/v1/watches/:id          detail
 *   PATCH  /api/v1/watches/:id          edit while CREATED
 *   POST   /api/v1/watches/:id/arm      arm (requires accepted policy hash + consent)
 *   POST   /api/v1/watches/:id/disarm   ARMED → CREATED
 *   POST   /api/v1/watches/:id/cancel   → CANCELLED
 */

type Db = PrismaClient;
type WatchWithPrefs = MovieWatch & { preferences: BookingPreference[] };

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

function zodDetails(err: { issues: { message: string }[] }): string {
  return err.issues.map((i) => i.message).join("; ");
}

function toPreferenceInput(p: {
  theatersRank1: string[];
  theatersRank2: string[];
  daysRank1: number[];
  daysRank2: number[];
  dateFrom: Date | null;
  dateTo: Date | null;
  timeWindowsRank1: string[];
  timeWindowsRank2: string[];
  formatsRank1: string[];
  formatsRank2: string[];
  ticketCount: number;
  maxTicketPriceCents: number;
  seatRules: string | null;
}) {
  return {
    theatersRank1: p.theatersRank1,
    theatersRank2: p.theatersRank2,
    daysRank1: p.daysRank1,
    daysRank2: p.daysRank2,
    dateFrom: p.dateFrom?.toISOString() ?? null,
    dateTo: p.dateTo?.toISOString() ?? null,
    timeWindowsRank1: p.timeWindowsRank1,
    timeWindowsRank2: p.timeWindowsRank2,
    formatsRank1: p.formatsRank1,
    formatsRank2: p.formatsRank2,
    ticketCount: p.ticketCount,
    maxTicketPriceCents: p.maxTicketPriceCents,
    seatRules: p.seatRules ? JSON.parse(p.seatRules) : null,
  };
}

function presentWatch(w: {
  id: string;
  tmdbId: number;
  movieTitle: string;
  status: string;
  zip: string;
  armedAt: Date | null;
  expiresAt: Date | null;
  cadenceMinutes: number;
  policyVersion: number;
  policyDocument: string | null;
  consentRecord: string | null;
  autoBookEnabled: boolean;
  consentAt: Date | null;
  maxTotalCents: number | null;
  checkFrequency: string;
  lastCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  preferences: Parameters<typeof toPreferenceInput>[0][];
}) {
  let policy: null | {
    hash: string;
    terms: ReturnType<typeof policyTerms>;
    consent: unknown;
  } = null;
  if (w.policyDocument) {
    const doc = JSON.parse(w.policyDocument);
    policy = {
      hash: policyHash(doc),
      terms: policyTerms(doc),
      consent: w.consentRecord ? JSON.parse(w.consentRecord) : null,
    };
  }
  return {
    id: w.id,
    tmdbId: w.tmdbId,
    movieTitle: w.movieTitle,
    status: w.status,
    zip: w.zip,
    armedAt: w.armedAt?.toISOString() ?? null,
    expiresAt: w.expiresAt?.toISOString() ?? null,
    cadenceMinutes: w.cadenceMinutes,
    policyVersion: w.policyVersion,
    preferences: w.preferences.map(toPreferenceInput),
    policy,
    autoBookEnabled: w.autoBookEnabled,
    consentAt: w.consentAt?.toISOString() ?? null,
    maxTotalCents: w.maxTotalCents,
    checkFrequency: w.checkFrequency,
    lastCheckedAt: w.lastCheckedAt?.toISOString() ?? null,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

function policyInputFor(
  watch: { id: string; userId: string; tmdbId: number; expiresAt: Date | null },
  preference: { maxTicketPriceCents: number; ticketCount: number; theatersRank1: string[]; theatersRank2: string[] },
  maxTotalCents?: number,
): MintPolicyInput {
  return {
    watchId: watch.id,
    userId: watch.userId,
    tmdbId: watch.tmdbId,
    preference,
    expiresAt: (watch.expiresAt ?? new Date(Date.now() + 180 * 24 * 3600 * 1000)).toISOString(),
    ...(maxTotalCents !== undefined ? { maxTotalCents } : {}),
  };
}

function preferenceData(p: BookingPreferenceInput) {
  return {
    theatersRank1: p.theatersRank1,
    theatersRank2: p.theatersRank2,
    daysRank1: p.daysRank1,
    daysRank2: p.daysRank2,
    dateFrom: p.dateFrom ? new Date(p.dateFrom) : null,
    dateTo: p.dateTo ? new Date(p.dateTo) : null,
    timeWindowsRank1: p.timeWindowsRank1 as string[],
    timeWindowsRank2: p.timeWindowsRank2 as string[],
    formatsRank1: p.formatsRank1,
    formatsRank2: p.formatsRank2,
    ticketCount: p.ticketCount,
    maxTicketPriceCents: p.maxTicketPriceCents,
    seatRules: JSON.stringify(p.seatRules),
  };
}

function validatePreferenceDates(p: BookingPreferenceInput, reply: FastifyReply): boolean {
  if (p.dateFrom && p.dateTo && new Date(p.dateFrom) > new Date(p.dateTo)) {
    sendError(reply, 400, "Preference dateFrom must not be after dateTo");
    return false;
  }
  return true;
}

export async function watchesRoutes(app: FastifyInstance) {
  const prefsInclude = { preferences: true };

  // --- Create ------------------------------------------------------------
  app.post("/watches", async (req, reply) => {
    const parsed = CreateWatchInputSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, "Invalid watch", undefined, zodDetails(parsed.error));
    const input = parsed.data;
    if (!validatePreferenceDates(input.preference, reply)) return;
    if (input.expiresAt && new Date(input.expiresAt) <= new Date()) {
      return sendError(reply, 400, "expiresAt must be in the future");
    }

    const db = dbOr503(reply);
    if (!db) return;
    const userId = req.auth.userId;

    // Action mode: "notify" (email alert) or "autobook" (auto-purchase).
    // Auto-booking requires a spending cap; validate now so the policy preview
    // covers exactly what the user will be asked to authorize.
    const actionMode = input.actionMode;
    const autoBookEnabled = actionMode === "autobook" && input.autoBook.enabled;
    const requestedMaxTotalCents = autoBookEnabled ? input.autoBook.maxTotalCents : undefined;
    if (actionMode === "autobook" && !requestedMaxTotalCents) {
      return sendError(reply, 400, "Auto-booking requires maxTotalCents (spending cap)");
    }

    const watch: WatchWithPrefs = await db.movieWatch.create({
      data: {
        userId,
        tmdbId: input.tmdbId,
        movieTitle: input.movieTitle,
        zip: input.zip,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        actionMode,
        autoBookEnabled,
        maxTotalCents: requestedMaxTotalCents ?? null,
        checkFrequency: input.checkFrequency,
        preferences: { create: preferenceData(input.preference) },
      },
      include: prefsInclude,
    });

    await writeAudit(db, {
      actorType: "user",
      actorId: userId,
      action: "watch.created",
      resourceType: "MovieWatch",
      resourceId: watch.id,
    });

    // Best-effort "watch created" email — never fails the request.
    void sendWatchCreatedEmail(watch, req.auth.email).catch((err) =>
      req.log.warn({ err }, "watch-created email failed"),
    );

    // Policy preview: terms the user will review before arming (unsigned).
    let preview: { terms: unknown; termsHash: string } | null = null;
    try {
      const pref = watch.preferences[0];
      if (!pref) throw new PolicyError("watch has no preference");
      const doc = buildPolicyDocument(
        policyInputFor(
          watch,
          {
            maxTicketPriceCents: pref.maxTicketPriceCents,
            ticketCount: pref.ticketCount,
            theatersRank1: pref.theatersRank1,
            theatersRank2: pref.theatersRank2,
          },
          requestedMaxTotalCents,
        ),
      );
      preview = { terms: policyTerms(doc), termsHash: policyTermsHash(doc) };
    } catch (err) {
      if (err instanceof PolicyError) {
        return sendError(reply, 400, "Policy rejected", undefined, err.message);
      }
      throw err;
    }

    return reply.status(201).send({ watch: presentWatch(watch), policyPreview: preview });
  });

  // --- List --------------------------------------------------------------
  app.get("/watches", async (req, reply) => {
    const db = dbOr503(reply);
    if (!db) return;
    const watches: WatchWithPrefs[] = await db.movieWatch.findMany({
      where: { userId: req.auth.userId },
      include: prefsInclude,
      orderBy: { createdAt: "desc" },
    });
    return { watches: watches.map((w) => presentWatch(w)) };
  });

  // --- Detail ------------------------------------------------------------
  app.get("/watches/:id", async (req, reply) => {
    const db = dbOr503(reply);
    if (!db) return;
    const watch: WatchWithPrefs | null = await db.movieWatch.findFirst({
      where: { id: (req.params as { id: string }).id, userId: req.auth.userId },
      include: prefsInclude,
    });
    if (!watch) return sendError(reply, 404, "Watch not found");
    return presentWatch(watch);
  });

  // --- Update (CREATED only) ----------------------------------------------
  app.patch("/watches/:id", async (req, reply) => {
    const parsed = UpdateWatchInputSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, "Invalid update", undefined, zodDetails(parsed.error));
    const input = parsed.data;

    const db = dbOr503(reply);
    if (!db) return;
    const userId = req.auth.userId;

    const watch: WatchWithPrefs | null = await db.movieWatch.findFirst({
      where: { id: (req.params as { id: string }).id, userId },
      include: prefsInclude,
    });
    if (!watch) return sendError(reply, 404, "Watch not found");
    if (watch.status !== "CREATED") {
      return sendError(reply, 409, "Only unarmed watches can be edited — disarm first");
    }
    if (input.preference && !validatePreferenceDates(input.preference, reply)) return;

    const updated: WatchWithPrefs = await db.$transaction(async (tx) => {
      if (input.preference) {
        await tx.bookingPreference.deleteMany({ where: { watchId: watch.id } });
        await tx.bookingPreference.create({
          data: { watchId: watch.id, ...preferenceData(input.preference) },
        });
      }
      return tx.movieWatch.update({
        where: { id: watch.id },
        data: {
          ...(input.zip !== undefined ? { zip: input.zip } : {}),
          ...(input.expiresAt !== undefined
            ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }
            : {}),
        },
        include: prefsInclude,
      });
    });

    await writeAudit(db, {
      actorType: "user",
      actorId: userId,
      action: "watch.updated",
      resourceType: "MovieWatch",
      resourceId: watch.id,
    });
    return presentWatch(updated);
  });

  // --- Arm -----------------------------------------------------------------
  app.post("/watches/:id/arm", async (req, reply) => {
    const parsed = ArmWatchInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(
        reply,
        400,
        "Arming requires the accepted policy hash and recorded consent",
        undefined,
        zodDetails(parsed.error),
      );
    }

    const db = dbOr503(reply);
    if (!db) return;
    const userId = req.auth.userId;

    const watch: WatchWithPrefs | null = await db.movieWatch.findFirst({
      where: { id: (req.params as { id: string }).id, userId },
      include: prefsInclude,
    });
    if (!watch) return sendError(reply, 404, "Watch not found");
    if (watch.status !== "CREATED") {
      return sendError(reply, 409, `Watch is ${watch.status} — only CREATED watches can be armed`);
    }

    // --- Auto-booking gate -------------------------------------------------
    // When auto-book is enabled the user must have explicitly authorized a
    // purchase: a saved card on file, a spending cap, and the authorization
    // text. No charge can ever happen without all three.
    const autoBook = parsed.data.autoBook;
    let paymentMethodId: string | null = null;
    if (autoBook.enabled) {
      if (!autoBook.maxTotalCents) {
        return sendError(reply, 400, "Auto-booking requires maxTotalCents (spending cap)");
      }
      if (watch.maxTotalCents !== null && autoBook.maxTotalCents !== watch.maxTotalCents) {
        return sendError(
          reply,
          400,
          "Spending cap changed since review",
          undefined,
          "Recreate the watch with the new cap and review the policy again.",
        );
      }
      if (!autoBook.paymentMethodId) {
        return sendError(reply, 400, "Auto-booking requires a saved payment method");
      }
      if (!autoBook.purchaseAuthorization) {
        return sendError(reply, 400, "Auto-booking requires explicit purchase authorization");
      }
      const pm = await db.paymentMethod.findFirst({
        where: { id: autoBook.paymentMethodId, userId },
      });
      if (!pm) {
        return sendError(reply, 400, "Payment method not found — add a card first");
      }
      paymentMethodId = pm.id;
    }

    // Re-mint from server-side state and bind the user's acceptance to it.
    // The cap flows into the policy so the signed document can never
    // authorize more than the user allowed.
    let minted: { document: PolicyDocument; signature: string };
    try {
      const pref = watch.preferences[0];
      if (!pref) throw new PolicyError("watch has no preference");
      minted = mintPolicy(
        policyInputFor(
          watch,
          {
            maxTicketPriceCents: pref.maxTicketPriceCents,
            ticketCount: pref.ticketCount,
            theatersRank1: pref.theatersRank1,
            theatersRank2: pref.theatersRank2,
          },
          autoBook.enabled ? (autoBook.maxTotalCents ?? undefined) : undefined,
        ),
      );
    } catch (err) {
      if (err instanceof PolicyError) return sendError(reply, 400, "Policy rejected", undefined, err.message);
      if (err instanceof PolicySigningNotConfiguredError) return sendError(reply, 503, err.message);
      throw err;
    }
    if (policyTermsHash(minted.document) !== parsed.data.acceptedPolicyHash) {
      return sendError(
        reply,
        400,
        "Policy changed since review",
        undefined,
        "Fetch a fresh policy preview and accept it again.",
      );
    }

    const next = "ARMED" as WatchStatus;
    if (!canTransition(watch.status as WatchStatus, next)) {
      return sendError(reply, 409, `Cannot transition ${watch.status} → ${next}`);
    }

    const consentAt = new Date();
    const consentRecord = JSON.stringify({
      accepted: true,
      summary: parsed.data.consent.summary,
      acceptedAt: consentAt.toISOString(),
      actorId: userId,
      // Auto-booking authorization (only present when enabled). The monitor
      // may charge paymentMethodId off-session, never above maxTotalCents.
      ...(autoBook.enabled
        ? {
            autoBook: {
              enabled: true,
              maxTotalCents: autoBook.maxTotalCents,
              paymentMethodId,
              purchaseAuthorization: autoBook.purchaseAuthorization,
            },
          }
        : {}),
    });

    const armed: WatchWithPrefs = await db.movieWatch.update({
      where: { id: watch.id },
      data: {
        status: next,
        armedAt: new Date(),
        policyDocument: JSON.stringify(minted.document),
        policySignature: minted.signature,
        policyVersion: { increment: 1 },
        consentRecord,
        actionMode: parsed.data.actionMode ?? watch.actionMode,
        autoBookEnabled: autoBook.enabled,
        consentAt,
        maxTotalCents: autoBook.enabled ? (autoBook.maxTotalCents ?? null) : null,
        checkFrequency: parsed.data.checkFrequency ?? watch.checkFrequency,
      },
      include: prefsInclude,
    });

    await writeAudit(db, {
      actorType: "user",
      actorId: userId,
      action: "watch.armed",
      resourceType: "MovieWatch",
      resourceId: watch.id,
      policyVersion: armed.policyVersion,
    });

    // Best-effort "armed" email — never fails the request.
    void sendWatchArmedEmail(armed, req.auth.email).catch((err) =>
      req.log.warn({ err }, "watch-armed email failed"),
    );

    return presentWatch(armed);
  });

  // --- Disarm ---------------------------------------------------------------
  app.post("/watches/:id/disarm", async (req, reply) => {
    const db = dbOr503(reply);
    if (!db) return;
    const userId = req.auth.userId;

    const watch: WatchWithPrefs | null = await db.movieWatch.findFirst({
      where: { id: (req.params as { id: string }).id, userId },
      include: prefsInclude,
    });
    if (!watch) return sendError(reply, 404, "Watch not found");

    const next = "CREATED" as WatchStatus;
    if (!canTransition(watch.status as WatchStatus, next)) {
      return sendError(reply, 409, `Cannot disarm a watch in status ${watch.status}`);
    }

    const updated: WatchWithPrefs = await db.movieWatch.update({
      where: { id: watch.id },
      data: {
        status: next,
        armedAt: null,
        policyDocument: null,
        policySignature: null,
        consentRecord: null,
        // Standing down revokes auto-booking — re-arming requires fresh
        // consent and a fresh spending authorization.
        autoBookEnabled: false,
        consentAt: null,
        maxTotalCents: null,
      },
      include: prefsInclude,
    });
    await writeAudit(db, {
      actorType: "user",
      actorId: userId,
      action: "watch.disarmed",
      resourceType: "MovieWatch",
      resourceId: watch.id,
    });
    return presentWatch(updated);
  });

  // --- Cancel ----------------------------------------------------------------
  app.post("/watches/:id/cancel", async (req, reply) => {
    const db = dbOr503(reply);
    if (!db) return;
    const userId = req.auth.userId;

    const watch: WatchWithPrefs | null = await db.movieWatch.findFirst({
      where: { id: (req.params as { id: string }).id, userId },
      include: prefsInclude,
    });
    if (!watch) return sendError(reply, 404, "Watch not found");

    const next = "CANCELLED" as WatchStatus;
    if (!canTransition(watch.status as WatchStatus, next)) {
      return sendError(reply, 409, `Cannot cancel a watch in status ${watch.status}`);
    }

    const updated: WatchWithPrefs = await db.movieWatch.update({
      where: { id: watch.id },
      data: { status: next },
      include: prefsInclude,
    });
    await writeAudit(db, {
      actorType: "user",
      actorId: userId,
      action: "watch.cancelled",
      resourceType: "MovieWatch",
      resourceId: watch.id,
    });
    return presentWatch(updated);
  });
}
