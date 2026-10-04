import { createHash } from "node:crypto";
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

async function writeAudit(
  db: Db,
  e: {
    actorType: string;
    actorId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    policyVersion?: number;
  },
): Promise<void> {
  const last = await db.auditLog.findFirst({
    where: { resourceType: e.resourceType, resourceId: e.resourceId },
    orderBy: { createdAt: "desc" },
    select: { hash: true },
  });
  const prevHash = last?.hash ?? null;
  const hash = createHash("sha256")
    .update(JSON.stringify({ ...e, prevHash, at: new Date().toISOString() }))
    .digest("hex");
  await db.auditLog.create({ data: { ...e, prevHash, hash } });
}

function toPreferenceInput(p: {
  rank: number;
  theaterIds: string[];
  daysOfWeek: number[];
  dateFrom: Date | null;
  dateTo: Date | null;
  timeWindows: string[];
  formats: string[];
  ticketCount: number;
  maxTicketPriceCents: number;
  seatRules: string | null;
}) {
  return {
    rank: p.rank,
    theaterIds: p.theaterIds,
    daysOfWeek: p.daysOfWeek,
    dateFrom: p.dateFrom?.toISOString() ?? null,
    dateTo: p.dateTo?.toISOString() ?? null,
    timeWindows: p.timeWindows,
    formats: p.formats,
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
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

function policyInputFor(
  watch: { id: string; userId: string; tmdbId: number; expiresAt: Date | null },
  preferences: { maxTicketPriceCents: number; ticketCount: number; theaterIds: string[] }[],
): MintPolicyInput {
  return {
    watchId: watch.id,
    userId: watch.userId,
    tmdbId: watch.tmdbId,
    preferences,
    expiresAt: (watch.expiresAt ?? new Date(Date.now() + 180 * 24 * 3600 * 1000)).toISOString(),
  };
}

function preferenceData(p: BookingPreferenceInput) {
  return {
    rank: p.rank,
    theaterIds: p.theaterIds,
    daysOfWeek: p.daysOfWeek,
    dateFrom: p.dateFrom ? new Date(p.dateFrom) : null,
    dateTo: p.dateTo ? new Date(p.dateTo) : null,
    timeWindows: p.timeWindows as string[],
    formats: p.formats,
    ticketCount: p.ticketCount,
    maxTicketPriceCents: p.maxTicketPriceCents,
    seatRules: JSON.stringify(p.seatRules),
  };
}

function validatePreferenceDates(prefs: BookingPreferenceInput[], reply: FastifyReply): boolean {
  for (const p of prefs) {
    if (p.dateFrom && p.dateTo && new Date(p.dateFrom) > new Date(p.dateTo)) {
      sendError(reply, 400, "Preference dateFrom must not be after dateTo");
      return false;
    }
  }
  return true;
}

export async function watchesRoutes(app: FastifyInstance) {
  const prefsInclude = { preferences: { orderBy: { rank: "asc" as const } } };

  // --- Create ------------------------------------------------------------
  app.post("/watches", async (req, reply) => {
    const parsed = CreateWatchInputSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, "Invalid watch", undefined, zodDetails(parsed.error));
    const input = parsed.data;
    if (!validatePreferenceDates(input.preferences, reply)) return;
    if (input.expiresAt && new Date(input.expiresAt) <= new Date()) {
      return sendError(reply, 400, "expiresAt must be in the future");
    }

    const db = dbOr503(reply);
    if (!db) return;
    const userId = req.auth.userId;

    const watch: WatchWithPrefs = await db.movieWatch.create({
      data: {
        userId,
        tmdbId: input.tmdbId,
        movieTitle: input.movieTitle,
        zip: input.zip,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        preferences: { create: input.preferences.map(preferenceData) },
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

    // Policy preview: terms the user will review before arming (unsigned).
    let preview: { terms: unknown; termsHash: string } | null = null;
    try {
      const doc = buildPolicyDocument(
        policyInputFor(watch, watch.preferences.map((p) => ({
          maxTicketPriceCents: p.maxTicketPriceCents,
          ticketCount: p.ticketCount,
          theaterIds: p.theaterIds,
        }))),
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
    if (input.preferences && !validatePreferenceDates(input.preferences, reply)) return;

    const updated: WatchWithPrefs = await db.$transaction(async (tx) => {
      if (input.preferences) {
        await tx.bookingPreference.deleteMany({ where: { watchId: watch.id } });
        await tx.bookingPreference.createMany({
          data: input.preferences.map((p) => ({ watchId: watch.id, ...preferenceData(p) })),
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

    // Re-mint from server-side state and bind the user's acceptance to it.
    let minted: { document: PolicyDocument; signature: string };
    try {
      minted = mintPolicy(
        policyInputFor(watch, watch.preferences.map((p) => ({
          maxTicketPriceCents: p.maxTicketPriceCents,
          ticketCount: p.ticketCount,
          theaterIds: p.theaterIds,
        }))),
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

    const consentRecord = JSON.stringify({
      accepted: true,
      summary: parsed.data.consent.summary,
      acceptedAt: new Date().toISOString(),
      actorId: userId,
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
