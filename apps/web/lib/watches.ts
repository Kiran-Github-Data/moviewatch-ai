import type { WatchStatus } from "@moviewatch/contracts";

/** Mirrors the API contract for POST /watches preferences. */
export interface SeatRulesInput {
  zone: string;
  rows: string;
  adjacencyRequired: boolean;
  avoidFrontRows: number;
  accessibility: boolean;
  premiumFormatBias: boolean;
}

export interface PreferenceInput {
  rank: number;
  theaterIds: string[];
  daysOfWeek: number[];
  dateFrom: null;
  dateTo: null;
  timeWindows: string[];
  formats: string[];
  ticketCount: number;
  maxTicketPriceCents: number;
  seatRules: SeatRulesInput;
}

export interface PolicyTerms {
  version: number;
  watchId: string;
  userId: string;
  tmdbId: number;
  maxTicketPriceCents: number;
  maxTotalCents: number;
  maxTickets: number;
  allowedTheaterIds: string[];
  allowedProvider: string;
  expiresAt: string;
  requireHumanApprovalAboveCents: number;
}

export interface WatchT {
  id: string;
  tmdbId: number;
  movieTitle: string;
  status: WatchStatus;
  zip: string;
  armedAt: string | null;
  expiresAt: string;
  cadenceMinutes: number;
  policyVersion: number;
  preferences: PreferenceInput[];
  policy: null | { hash: string; terms: PolicyTerms; consent: unknown };
  createdAt: string;
  updatedAt: string;
}

export interface CreateWatchResponse {
  watch: WatchT;
  policyPreview: { terms: PolicyTerms; termsHash: string };
}

export const TIME_WINDOW_PRESETS = ["morning", "afternoon", "evening", "late-night"] as const;
export const FORMAT_OPTIONS = ["IMAX", "XD", "Dolby", "Standard"] as const;
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const ZONE_OPTIONS = ["any", "center", "left", "right"];
export const ROW_OPTIONS = ["any", "front", "middle", "back"];

export function defaultSeatRules(): SeatRulesInput {
  return {
    zone: "center",
    rows: "middle",
    adjacencyRequired: true,
    avoidFrontRows: 3,
    accessibility: false,
    premiumFormatBias: false,
  };
}

export function defaultPreference(rank: number): PreferenceInput {
  return {
    rank,
    theaterIds: [],
    daysOfWeek: [],
    dateFrom: null,
    dateTo: null,
    timeWindows: ["evening"],
    formats: [],
    ticketCount: 2,
    maxTicketPriceCents: 2000,
    seatRules: defaultSeatRules(),
  };
}

/** Turn an apiFetch throw into a human-readable message. */
export function friendlyWatchError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/API (\d+) on ([^:]+):?\s?(.*)/);
  if (!m) return msg;
  const status = Number(m[1]);
  const detail = (m[3] ?? "").trim();
  if (status === 400)
    return detail
      ? `Please check your inputs: ${detail}`
      : "Some inputs were invalid. Please review each step.";
  if (status === 401) return "Your session expired. Please sign in again.";
  if (status === 409)
    return detail || "This watch isn't in the right state for that action. Refresh and try again.";
  if (status === 503)
    return "The database isn't configured yet. Set DATABASE_URL on the API server, then try again.";
  return detail || `Request failed (status ${status}).`;
}

/** Human-readable spending authorization summary, built from the signed terms. */
export function consentSummary(terms: PolicyTerms): string {
  const per = (terms.maxTicketPriceCents / 100).toFixed(2);
  const total = (terms.maxTotalCents / 100).toFixed(2);
  const theaters = terms.allowedTheaterIds.length > 0 ? terms.allowedTheaterIds.join(", ") : "any theater";
  const exp = new Date(terms.expiresAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    `Book up to ${terms.maxTickets} ticket${terms.maxTickets === 1 ? "" : "s"}, ` +
    `max $${per} per ticket ($${total} total), at ${theaters}. ` +
    `Authorization expires ${exp}.`
  );
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatDateShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
