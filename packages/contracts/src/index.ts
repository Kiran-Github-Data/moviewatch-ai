import { z } from "zod";

/**
 * Shared contracts between apps/web, apps/orchestrator-api and workers.
 * Zod schemas are the single source of truth: API validation and
 * TypeScript types derive from the same definitions.
 */

// --- Health ---------------------------------------------------------------

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
  time: z.string().datetime(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// --- Auth -----------------------------------------------------------------

export const AuthContextSchema = z.object({
  userId: z.string().min(1), // our internal User.id
  clerkUserId: z.string().min(1),
  email: z.string().email(),
});
export type AuthContext = z.infer<typeof AuthContextSchema>;

// --- Watch lifecycle (Milestone 1: status enum only; full schemas in M3) ---

export const WatchStatusSchema = z.enum([
  "CREATED",
  "ARMED",
  "MONITORING",
  "WAITING_FOR_RELEASE",
  "TICKETS_DETECTED",
  "MATCHING_OPTIONS",
  "OPTION_SELECTED",
  "RESERVING_SEATS",
  "CHECKOUT",
  "BOOKED",
  "RETRYING",
  "USER_ACTION_REQUIRED",
  "AUTHENTICATION_REQUIRED",
  "PAYMENT_FAILED",
  "SOLD_OUT",
  "EXPIRED",
  "CANCELLED",
  "FAILED",
]);
export type WatchStatus = z.infer<typeof WatchStatusSchema>;

/** Allowed state transitions — enforced in code, see PLAN.md §11. */
export const WATCH_TRANSITIONS: Record<WatchStatus, WatchStatus[]> = {
  CREATED: ["ARMED", "CANCELLED"],
  // ARMED → CREATED is the user "stand down" path (disarm before monitoring starts).
  ARMED: ["CREATED", "MONITORING", "CANCELLED"],
  MONITORING: ["WAITING_FOR_RELEASE", "TICKETS_DETECTED", "CANCELLED", "EXPIRED"],
  WAITING_FOR_RELEASE: ["MONITORING", "CANCELLED", "EXPIRED"],
  TICKETS_DETECTED: ["MATCHING_OPTIONS", "MONITORING"],
  MATCHING_OPTIONS: ["OPTION_SELECTED", "SOLD_OUT", "MONITORING"],
  OPTION_SELECTED: ["RESERVING_SEATS", "MATCHING_OPTIONS", "SOLD_OUT"],
  RESERVING_SEATS: ["CHECKOUT", "RETRYING", "SOLD_OUT"],
  CHECKOUT: [
    "BOOKED",
    "PAYMENT_FAILED",
    "USER_ACTION_REQUIRED",
    "AUTHENTICATION_REQUIRED",
    "RETRYING",
    "FAILED",
  ],
  BOOKED: [],
  RETRYING: [
    "MONITORING",
    "MATCHING_OPTIONS",
    "RESERVING_SEATS",
    "CHECKOUT",
    "FAILED",
    "CANCELLED",
  ],
  USER_ACTION_REQUIRED: ["RESERVING_SEATS", "CHECKOUT", "CANCELLED", "EXPIRED"],
  AUTHENTICATION_REQUIRED: ["RESERVING_SEATS", "CANCELLED", "EXPIRED"],
  PAYMENT_FAILED: ["USER_ACTION_REQUIRED", "CANCELLED", "FAILED"],
  SOLD_OUT: ["MONITORING", "CANCELLED", "EXPIRED"],
  EXPIRED: [],
  CANCELLED: [],
  FAILED: [],
};

export function canTransition(from: WatchStatus, to: WatchStatus): boolean {
  return WATCH_TRANSITIONS[from]?.includes(to) ?? false;
}

// --- Errors ----------------------------------------------------------------

export const ErrorResponseSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number(),
  detail: z.string().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// --- Movies (Milestone 2: TMDB-backed discovery) ----------------------------

export const MovieSummarySchema = z.object({
  tmdbId: z.number(),
  title: z.string(),
  overview: z.string().nullable(),
  releaseDate: z.string().datetime().nullable(),
  posterUrl: z.string().url().nullable(),
  backdropUrl: z.string().url().nullable(),
  genres: z.array(z.string()),
  popularity: z.number(),
  voteAverage: z.number(),
});
export type MovieSummary = z.infer<typeof MovieSummarySchema>;

export const MovieDetailsSchema = MovieSummarySchema.extend({
  runtime: z.number().nullable(),
  cast: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      character: z.string(),
      profileUrl: z.string().url().nullable(),
    }),
  ),
  trailerKey: z.string().nullable(),
  trailerUrl: z.string().url().nullable(),
  cacheSource: z.enum(["cache", "fresh"]),
});
export type MovieDetails = z.infer<typeof MovieDetailsSchema>;

export const PagedMoviesSchema = z.object({
  page: z.number(),
  totalPages: z.number(),
  totalResults: z.number(),
  movies: z.array(MovieSummarySchema),
});
export type PagedMovies = z.infer<typeof PagedMoviesSchema>;

// --- Watches (Milestone 3: creation workflow + spending authorization) -----

const timeWindowSchema = z.union([
  z.enum(["morning", "afternoon", "evening", "late-night"]),
  z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/, "expected HH:MM-HH:MM"),
]);

export const SeatRulesSchema = z.object({
  zone: z.enum(["center", "front", "back", "any"]).default("center"),
  rows: z.enum(["front", "middle", "back", "any"]).default("middle"),
  adjacencyRequired: z.boolean().default(true),
  avoidFrontRows: z.number().int().min(0).max(10).default(3),
  accessibility: z.boolean().default(false),
  premiumFormatBias: z.boolean().default(false),
});
export type SeatRules = z.infer<typeof SeatRulesSchema>;

export const BookingPreferenceInputSchema = z.object({
  // Theaters: first choice + backup (Theater IDs from the directory)
  theatersRank1: z.array(z.string().min(1)).min(1).max(10),
  theatersRank2: z.array(z.string().min(1)).max(10).default([]),
  // Days of week: first choice + backup (0=Sun..6=Sat; empty = any day)
  daysRank1: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  daysRank2: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  dateFrom: z.string().datetime().nullable().default(null),
  dateTo: z.string().datetime().nullable().default(null),
  // Showtime windows: first choice + backup
  timeWindowsRank1: z.array(timeWindowSchema).min(1).max(8),
  timeWindowsRank2: z.array(timeWindowSchema).max(8).default([]),
  // Formats: first choice + backup
  formatsRank1: z.array(z.string().min(1)).max(6).default([]),
  formatsRank2: z.array(z.string().min(1)).max(6).default([]),
  ticketCount: z.number().int().min(1).max(10).default(2),
  maxTicketPriceCents: z.number().int().positive().max(50_000),
  seatRules: SeatRulesSchema.default({}),
});
export type BookingPreferenceInput = z.infer<typeof BookingPreferenceInputSchema>;

export const CreateWatchInputSchema = z.object({
  tmdbId: z.number().int().positive(),
  movieTitle: z.string().min(1).max(200),
  zip: z.string().regex(/^\d{5}$/, "expected 5-digit ZIP"),
  expiresAt: z.string().datetime().optional(),
  // One preference per watch; each dimension carries rank 1 (first choice)
  // and rank 2 (backup).
  preference: BookingPreferenceInputSchema,
});
export type CreateWatchInput = z.infer<typeof CreateWatchInputSchema>;

export const UpdateWatchInputSchema = z.object({
  zip: z.string().regex(/^\d{5}$/).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  preference: BookingPreferenceInputSchema.optional(),
});
export type UpdateWatchInput = z.infer<typeof UpdateWatchInputSchema>;

/** Signed spending policy minted at arm time (PLAN.md §8). Fail-closed. */
export const PolicyDocumentSchema = z.object({
  version: z.literal(1),
  watchId: z.string().min(1),
  userId: z.string().min(1),
  tmdbId: z.number().int().positive(),
  maxTicketPriceCents: z.number().int().positive(),
  maxTotalCents: z.number().int().positive(),
  maxTickets: z.number().int().positive().max(10),
  allowedTheaterIds: z.array(z.string().min(1)).min(1),
  allowedProvider: z.string().min(1),
  expiresAt: z.string().datetime(),
  requireHumanApprovalAboveCents: z.number().int().nonnegative(),
  issuedAt: z.string().datetime(),
});
export type PolicyDocument = z.infer<typeof PolicyDocumentSchema>;

export const ArmWatchInputSchema = z.object({
  /** sha256 of the exact policy document the user reviewed. */
  acceptedPolicyHash: z.string().regex(/^[0-9a-f]{64}$/),
  consent: z.object({
    accepted: z.literal(true),
    summary: z.string().min(1).max(2000),
  }),
});
export type ArmWatchInput = z.infer<typeof ArmWatchInputSchema>;
