import { z } from "zod";

/**
 * Theater lookup plumbing: US ZIP → geocode (Zippopotam.us, free, no key) →
 * cinemas (OpenStreetMap Overpass API). HTTP is injectable so tests never hit
 * real APIs. Pure helpers (dedupe, distance, cache freshness) are exported
 * for unit testing.
 */

/** ZIP must be exactly 5 digits. Anything else is a 400. */
export const zipSchema = z.string().regex(/^\d{5}$/, "ZIP code must be 5 digits");

/** Thrown when Zippopotam.us reports the ZIP does not exist (HTTP 404). */
export class ZipNotFoundError extends Error {
  readonly zip: string;
  constructor(zip: string) {
    super(`Unknown ZIP code: ${zip}`);
    this.name = "ZipNotFoundError";
    this.zip = zip;
  }
}

/** Thrown when an upstream provider (Zippopotam / Overpass) fails. Maps to 502. */
export class UpstreamError extends Error {
  readonly provider: string;
  constructor(provider: string, message: string) {
    super(`${provider}: ${message}`);
    this.name = "UpstreamError";
    this.provider = provider;
  }
}

export interface ZipGeo {
  zip: string;
  lat: number;
  lon: number;
  city: string;
}

/** A cinema as returned by the Overpass API, before persistence. */
export interface RawCinema {
  /** e.g. "osm:node/123456" — matches Theater.providerTheaterId. */
  providerId: string;
  name: string;
  address: string;
  city: string;
  lat: number;
  lon: number;
}

/** Cached theater rows are considered fresh for 30 days (avoids hammering Overpass). */
export const THEATER_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function isCacheFresh(updatedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - updatedAt.getTime() < THEATER_CACHE_TTL_MS;
}

type FetchFn = typeof fetch;

const ZIPPOPOTAM_URL = "https://api.zippopotam.us/us";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OVERPASS_RADIUS_M = 25000;
const OVERPASS_TIMEOUT_S = 15;

/**
 * Geocode a US ZIP via Zippopotam.us. Throws ZipNotFoundError on 404,
 * UpstreamError on any other failure.
 */
export async function geocodeZip(zip: string, fetchFn: FetchFn = fetch): Promise<ZipGeo> {
  let res: Response;
  try {
    res = await fetchFn(`${ZIPPOPOTAM_URL}/${zip}`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new UpstreamError("zippopotam", err instanceof Error ? err.message : String(err));
  }
  if (res.status === 404) throw new ZipNotFoundError(zip);
  if (!res.ok) throw new UpstreamError("zippopotam", `HTTP ${res.status}`);

  let body: unknown;
  try {
    body = (await res.json()) as unknown;
  } catch (err) {
    throw new UpstreamError("zippopotam", "invalid JSON response");
  }
  const place = parseZippopotamPlace(body);
  if (!place) throw new UpstreamError("zippopotam", "unexpected response shape");
  return { zip, lat: place.lat, lon: place.lon, city: place.city };
}

function parseZippopotamPlace(body: unknown): { lat: number; lon: number; city: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const places = (body as Record<string, unknown>).places;
  if (!Array.isArray(places) || places.length === 0) return null;
  const first = places[0] as Record<string, unknown> | undefined;
  if (!first || typeof first !== "object") return null;
  const lat = Number(first.latitude);
  const lon = Number(first.longitude);
  const city = typeof first["place name"] === "string" ? first["place name"] : "";
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, city };
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * Query OSM Overpass for amenity=cinema within ~25km of a point.
 * Throws UpstreamError on timeout / HTTP error / network failure.
 */
export async function fetchCinemas(
  lat: number,
  lon: number,
  fetchFn: FetchFn = fetch,
): Promise<RawCinema[]> {
  const query =
    `[out:json][timeout:${OVERPASS_TIMEOUT_S}];` +
    `(node["amenity"="cinema"](around:${OVERPASS_RADIUS_M},${lat},${lon});` +
    `way["amenity"="cinema"](around:${OVERPASS_RADIUS_M},${lat},${lon}););` +
    `out center 20;`;

  let res: Response;
  try {
    res = await fetchFn(OVERPASS_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout((OVERPASS_TIMEOUT_S + 10) * 1000),
    });
  } catch (err) {
    throw new UpstreamError("overpass", err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) throw new UpstreamError("overpass", `HTTP ${res.status}`);

  let body: unknown;
  try {
    body = (await res.json()) as unknown;
  } catch {
    throw new UpstreamError("overpass", "invalid JSON response");
  }
  return parseOverpassElements(body);
}

function parseOverpassElements(body: unknown): RawCinema[] {
  if (typeof body !== "object" || body === null) return [];
  const elements = (body as Record<string, unknown>).elements;
  if (!Array.isArray(elements)) return [];

  const out: RawCinema[] = [];
  for (const el of elements as OverpassElement[]) {
    if (!el || typeof el !== "object") continue;
    const tags = el.tags ?? {};
    const name = typeof tags.name === "string" ? tags.name.trim() : "";
    if (!name) continue; // unnamed cinemas are not useful for selection

    const coords =
      typeof el.lat === "number" && typeof el.lon === "number"
        ? { lat: el.lat, lon: el.lon }
        : el.center && typeof el.center.lat === "number" && typeof el.center.lon === "number"
          ? { lat: el.center.lat, lon: el.center.lon }
          : null;
    if (!coords) continue;

    const type = el.type === "way" ? "way" : "node";
    out.push({
      providerId: `osm:${type}/${el.id}`,
      name,
      address: formatAddress(tags),
      city: tags["addr:city"] ?? tags["addr:suburb"] ?? "",
      lat: coords.lat,
      lon: coords.lon,
    });
  }
  return out;
}

function formatAddress(tags: Record<string, string>): string {
  const num = tags["addr:housenumber"];
  const street = tags["addr:street"];
  return [num, street].filter((s): s is string => !!s).join(" ");
}

/**
 * Deduplicate cinemas by normalized name + rounded coordinates. Overpass can
 * return the same venue as both a node and a way (or twice across queries).
 */
export function dedupeCinemas(cinemas: RawCinema[]): RawCinema[] {
  const seen = new Set<string>();
  const out: RawCinema[] = [];
  for (const c of cinemas) {
    const key = `${c.name.toLowerCase().trim()}|${c.lat.toFixed(4)}|${c.lon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Great-circle distance in kilometers. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
