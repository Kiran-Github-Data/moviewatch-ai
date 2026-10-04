import { z } from "zod";

/**
 * Theater lookup plumbing: US ZIP → geocode (Zippopotam.us, free, no key) →
 * cinemas (OpenStreetMap Nominatim search API). Overpass was replaced because
 * it blocks datacenter/cloud IPs (Fly.io, CI runners) with connection
 * timeouts; Nominatim search with a viewbox is reachable and returns the same
 * OSM amenity=cinema data. HTTP is injectable so tests never hit real APIs.
 * Pure helpers (dedupe, distance, cache freshness) are exported for unit
 * testing.
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

/** Thrown when an upstream provider (Zippopotam / Nominatim) fails. Maps to 502. */
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

/** A cinema as returned by the Nominatim API, before persistence. */
export interface RawCinema {
  /** e.g. "osm:way/739855750" — matches Theater.providerTheaterId. */
  providerId: string;
  name: string;
  address: string;
  city: string;
  lat: number;
  lon: number;
}

/** Cached theater rows are considered fresh for 30 days (avoids hammering Nominatim). */
export const THEATER_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function isCacheFresh(updatedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - updatedAt.getTime() < THEATER_CACHE_TTL_MS;
}

type FetchFn = typeof fetch;

const ZIPPOPOTAM_URL = "https://api.zippopotam.us/us";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
/** ~25km viewbox half-extents in degrees (lon wider at US latitudes). */
const VIEWBOX_LAT_DEG = 0.25;
const VIEWBOX_LON_DEG = 0.3;
const NOMINATIM_TIMEOUT_S = 15;
/** Nominatim usage policy requires an identifying User-Agent. */
const NOMINATIM_USER_AGENT = "MovieWatchAI/1.0 (theater lookup)";

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

interface NominatimAddress {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  suburb?: string;
}

interface NominatimResult {
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  name?: string;
  address?: NominatimAddress;
}

/**
 * Query OSM Nominatim for cinemas within ~25km of a point, via a bounded
 * viewbox search for "cinema". Throws UpstreamError on timeout / HTTP error /
 * network failure.
 */
export async function fetchCinemas(
  lat: number,
  lon: number,
  fetchFn: FetchFn = fetch,
): Promise<RawCinema[]> {
  const left = lon - VIEWBOX_LON_DEG;
  const top = lat + VIEWBOX_LAT_DEG;
  const right = lon + VIEWBOX_LON_DEG;
  const bottom = lat - VIEWBOX_LAT_DEG;
  const params = new URLSearchParams({
    format: "json",
    q: "cinema",
    viewbox: `${left},${top},${right},${bottom}`,
    bounded: "1",
    limit: "20",
    addressdetails: "1",
  });

  let res: Response;
  try {
    res = await fetchFn(`${NOMINATIM_URL}?${params.toString()}`, {
      headers: { "User-Agent": NOMINATIM_USER_AGENT },
      signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_S * 1000),
    });
  } catch (err) {
    throw new UpstreamError("nominatim", err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) throw new UpstreamError("nominatim", `HTTP ${res.status}`);

  let body: unknown;
  try {
    body = (await res.json()) as unknown;
  } catch {
    throw new UpstreamError("nominatim", "invalid JSON response");
  }
  return parseNominatimResults(body);
}

function parseNominatimResults(body: unknown): RawCinema[] {
  if (!Array.isArray(body)) return [];

  const out: RawCinema[] = [];
  for (const item of body as NominatimResult[]) {
    if (!item || typeof item !== "object") continue;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) continue; // unnamed results are not useful for selection

    const lat = Number(item.lat);
    const lon = Number(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const osmType = item.osm_type === "way" || item.osm_type === "relation" ? item.osm_type : "node";
    const osmId = typeof item.osm_id === "number" ? item.osm_id : 0;
    const address = item.address ?? {};

    out.push({
      providerId: `osm:${osmType}/${osmId}`,
      name,
      address: formatNominatimAddress(address),
      city:
        address.city ?? address.town ?? address.village ?? address.suburb ?? "",
      lat,
      lon,
    });
  }
  return out;
}

function formatNominatimAddress(address: NominatimAddress): string {
  const num = address.house_number;
  const street = address.road;
  return [num, street].filter((s): s is string => !!s).join(" ");
}

/**
 * Deduplicate cinemas by normalized name + rounded coordinates. Nominatim can
 * return the same venue twice across viewbox edges.
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
