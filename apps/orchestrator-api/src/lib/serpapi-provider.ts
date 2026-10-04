/**
 * SerpApi ticket provider (interim real-data feed).
 *
 * Uses SerpApi's `google_showtimes` engine to pull showtimes for a movie near
 * the watch's ZIP. This is an interim rail until the Atom Tickets partnership
 * API is available — Google showtimes aggregate listings from many theater
 * chains, but they do NOT include pricing, so every offer reports
 * `pricePerTicketCents: 0` ("price unknown"). Downstream:
 *  - the deterministic monitor treats unknown-price offers as notify-only
 *    (never auto-charges an unknown price),
 *  - the agent's purchase_tickets tool REFUSES unknown-price offers,
 *  - the tickets-available email always includes the bookingUrl so the user
 *    sees real prices before paying.
 *
 * Auth: SERPAPI_API_KEY env var (https://serpapi.com/manage-api-key).
 * Endpoint: https://serpapi.com/search?engine=google_showtimes
 */
import type { TicketOffer, TicketProvider, WatchForCheck } from "./monitor.js";

const SERPAPI_ENDPOINT = "https://serpapi.com/search";
const REQUEST_TIMEOUT_MS = 15_000;

/** Price reported when the provider has no pricing data. */
export const PRICE_UNKNOWN = 0;

export interface SerpApiProviderOptions {
  /** Defaults to process.env.SERPAPI_API_KEY. */
  apiKey?: string;
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetchFn?: typeof fetch;
  /**
   * Resolve watch theater IDs (our directory) to display names for fuzzy
   * matching against SerpApi's theater names. When omitted, IDs are matched
   * against names directly (works when IDs are human-readable).
   */
  resolveTheaterNames?: (ids: string[]) => Promise<Map<string, string>>;
  timeoutMs?: number;
}

interface SerpApiShowing {
  time?: string[];
  type?: string;
}

interface SerpApiMovie {
  name?: string;
  link?: string;
  showing?: SerpApiShowing[];
}

interface SerpApiTheater {
  name?: string;
  address?: string;
  movies?: SerpApiMovie[];
}

interface SerpApiDay {
  day?: string;
  theaters?: SerpApiTheater[];
  /** Theater-centric queries return movies at top level instead. */
  movies?: SerpApiMovie[];
}

interface SerpApiResponse {
  showtimes?: SerpApiDay[];
  error?: string;
}

/** Normalize for fuzzy comparison: lowercase, strip punctuation/extra spaces. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fuzzy theater-name match: true when one normalized name contains the other,
 * or when they share at least 2 significant tokens (>=3 chars).
 * "Cinemark Frisco Square & XD" matches "Cinemark Frisco Square".
 */
export function theaterNameMatches(preferred: string, candidate: string): boolean {
  const a = normalizeName(preferred);
  const b = normalizeName(candidate);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const tokensA = new Set(a.split(" ").filter((t) => t.length >= 3));
  const tokensB = new Set(b.split(" ").filter((t) => t.length >= 3));
  let shared = 0;
  for (const t of tokensA) if (tokensB.has(t)) shared += 1;
  return shared >= 2;
}

/** Fuzzy movie-title match: normalized inclusion either way. */
export function movieTitleMatches(watchTitle: string, serpTitle: string): boolean {
  const a = normalizeName(watchTitle);
  const b = normalizeName(serpTitle);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function slugify(name: string): string {
  return normalizeName(name).replace(/\s+/g, "-").slice(0, 64) || "unknown";
}

/**
 * Parse a SerpApi day label ("Today", "Tomorrow", "Fri, Dec 18") plus a time
 * ("7:30pm") into a Date. Returns null when unparseable.
 */
export function parseShowtime(dayLabel: string, time: string, now = new Date()): Date | null {
  const t = time.trim().toLowerCase().replace(/\s+/g, "");
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (!m || !m[1] || !m[3]) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3];
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  const base = new Date(now);
  const lower = dayLabel.trim().toLowerCase();
  if (lower === "today") {
    // keep base date
  } else if (lower === "tomorrow") {
    base.setDate(base.getDate() + 1);
  } else {
    // "Fri, Dec 18" or "Dec 18" — parse month/day in the current year,
    // rolling to next year if the date already passed.
    const dm = dayLabel.match(/([a-z]+)\s+(\d{1,2})/i);
    if (!dm || !dm[1] || !dm[2]) return null;
    const monthNames = [
      "jan", "feb", "mar", "apr", "may", "jun",
      "jul", "aug", "sep", "oct", "nov", "dec",
    ];
    const month = monthNames.indexOf(dm[1].slice(0, 3).toLowerCase());
    if (month < 0) return null;
    const day = parseInt(dm[2], 10);
    base.setMonth(month, day);
    if (base < now && base.toDateString() !== now.toDateString()) {
      base.setFullYear(base.getFullYear() + 1);
    }
  }
  base.setHours(hour, minute, 0, 0);
  return base;
}

/** Human display matching the TicketOffer convention: "Fri, Dec 18 · 7:30 PM". */
export function formatShowtimeDisplay(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  let hour = d.getHours();
  const ampm = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()} · ${hour}:${min} ${ampm}`;
}

export class SerpApiTicketProvider implements TicketProvider {
  private readonly apiKey?: string;
  private readonly fetchFn: typeof fetch;
  private readonly resolveTheaterNames?: (ids: string[]) => Promise<Map<string, string>>;
  private readonly timeoutMs: number;

  constructor(opts: SerpApiProviderOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.SERPAPI_API_KEY;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.resolveTheaterNames = opts.resolveTheaterNames;
    this.timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  /** False when no API key is configured (provider safely returns no offers). */
  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async findOffers(watch: WatchForCheck): Promise<TicketOffer[]> {
    if (!this.apiKey) return [];

    const params = new URLSearchParams({
      engine: "google_showtimes",
      q: `${watch.movieTitle} showtimes`,
      location: watch.zip,
      hl: "en",
      gl: "us",
      api_key: this.apiKey,
    });

    let data: SerpApiResponse;
    try {
      const res = await this.fetchFn(`${SERPAPI_ENDPOINT}?${params.toString()}`, {
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return [];
      data = (await res.json()) as SerpApiResponse;
    } catch {
      return [];
    }
    if (!data.showtimes || !Array.isArray(data.showtimes)) return [];

    // Resolve preferred theater IDs → names for fuzzy matching.
    const preferredIds = [...watch.theatersRank1, ...watch.theatersRank2];
    let idToName = new Map<string, string>();
    if (this.resolveTheaterNames && preferredIds.length > 0) {
      try {
        idToName = await this.resolveTheaterNames(preferredIds);
      } catch {
        idToName = new Map();
      }
    }
    const preferredNames = preferredIds.map((id) => idToName.get(id) ?? id);

    const offers: TicketOffer[] = [];
    const now = new Date();
    for (const day of data.showtimes) {
      const theaters = day.theaters ?? [];
      for (const theater of theaters) {
        const theaterName = theater.name ?? "";
        if (!theaterName) continue;
        // Filter: keep only theaters matching the user's preferences.
        // No preferences configured → keep everything (agent decides).
        if (
          preferredNames.length > 0 &&
          !preferredNames.some((p) => theaterNameMatches(p, theaterName))
        ) {
          continue;
        }
        for (const movie of theater.movies ?? []) {
          if (!movie.name || !movieTitleMatches(watch.movieTitle, movie.name)) continue;
          const bookingUrl =
            movie.link && movie.link.startsWith("http")
              ? movie.link
              : `https://www.google.com/search?q=${encodeURIComponent(`${movie.name} ${theaterName} tickets`)}`;
          for (const showing of movie.showing ?? []) {
            const format = showing.type ? ` (${showing.type})` : "";
            for (const time of showing.time ?? []) {
              const dt = parseShowtime(day.day ?? "", time, now);
              // Skip past showtimes; keep unparseable ones with raw display.
              if (dt && dt.getTime() < now.getTime() - 30 * 60 * 1000) continue;
              offers.push({
                theaterId: `serpapi:${slugify(theaterName)}`,
                theaterName: theater.address
                  ? `${theaterName} — ${theater.address}`
                  : theaterName,
                showtime: dt ? formatShowtimeDisplay(dt) + format : `${day.day ?? ""} ${time}${format}`.trim(),
                // SerpApi/Google showtimes expose no pricing — downstream
                // treats 0 as "price unknown" (notify-only, never auto-charge).
                pricePerTicketCents: PRICE_UNKNOWN,
                bookingUrl,
                availableInventory: undefined,
              });
            }
          }
        }
      }
    }
    return offers;
  }
}
