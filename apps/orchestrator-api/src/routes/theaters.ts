import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DatabaseNotConfiguredError, getPrisma } from "@moviewatch/database";
import { sendError } from "../lib/errors.js";
import {
  UpstreamError,
  ZipNotFoundError,
  dedupeCinemas,
  fetchCinemas,
  geocodeZip,
  haversineKm,
  isCacheFresh,
  round1,
  zipSchema,
  type RawCinema,
  type ZipGeo,
} from "../lib/theater-lookup.js";

/**
 * Public theater-lookup route (no auth — the watch wizard needs theaters
 * before the user signs in).
 *
 *   GET /api/v1/theaters?zip=75078
 *
 * ZIP is geocoded via Zippopotam.us, then OSM Overpass is queried for
 * amenity=cinema within ~25km. Results are cached in the Theater table for
 * 30 days (provider="osm") so repeat ZIPs don't hammer Overpass.
 *
 * Response: { zip, theaters: [{ id, name, address, city, distanceKm }] }
 * sorted by distance, max 20.
 */

const PROVIDER = "osm";
const MAX_THEATERS = 20;

interface TheaterRow {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  updatedAt: Date;
}

export interface TheaterSearchResponse {
  zip: string;
  theaters: {
    id: string;
    name: string;
    address: string;
    city: string;
    distanceKm: number;
  }[];
}

function toResponse(zip: string, geo: ZipGeo, rows: TheaterRow[]): TheaterSearchResponse {
  const theaters = rows
    .filter(
      (r): r is TheaterRow & { latitude: number; longitude: number } =>
        r.latitude !== null && r.longitude !== null,
    )
    .map((r) => ({
      id: r.id,
      name: r.name,
      address: r.address ?? "",
      city: r.city && r.city.length > 0 ? r.city : geo.city,
      distanceKm: round1(haversineKm(geo.lat, geo.lon, r.latitude, r.longitude)),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, MAX_THEATERS);
  return { zip, theaters };
}

/** Best-effort cache read. Returns null when DB is unavailable or unusable. */
async function readCache(
  log: FastifyRequest["log"],
  zip: string,
): Promise<TheaterRow[] | null> {
  try {
    const rows = await getPrisma().theater.findMany({
      where: { provider: PROVIDER, zip },
    });
    if (rows.length === 0) return null;
    if (!rows.every((r) => isCacheFresh(r.updatedAt))) {
      log.info({ zip }, "theater cache stale; refreshing from Overpass");
      return null;
    }
    log.info({ zip, count: rows.length }, "theater cache hit");
    return rows;
  } catch (err) {
    if (!(err instanceof DatabaseNotConfiguredError)) {
      log.warn({ err, zip }, "theater cache read failed; falling back to live lookup");
    }
    return null;
  }
}

/** Best-effort cache write. Never throws; returns rows for the response. */
async function writeCache(
  log: FastifyRequest["log"],
  zip: string,
  cinemas: RawCinema[],
): Promise<TheaterRow[]> {
  const fallback: TheaterRow[] = cinemas.map((c) => ({
    id: c.providerId,
    name: c.name,
    address: c.address,
    city: c.city,
    latitude: c.lat,
    longitude: c.lon,
    updatedAt: new Date(),
  }));
  if (cinemas.length === 0) return fallback;
  try {
    const db = getPrisma();
    const rows = await db.$transaction(
      cinemas.map((c) =>
        db.theater.upsert({
          where: {
            provider_providerTheaterId: { provider: PROVIDER, providerTheaterId: c.providerId },
          },
          update: {
            name: c.name,
            address: c.address,
            city: c.city,
            zip,
            latitude: c.lat,
            longitude: c.lon,
          },
          create: {
            provider: PROVIDER,
            providerTheaterId: c.providerId,
            name: c.name,
            address: c.address,
            city: c.city,
            zip,
            latitude: c.lat,
            longitude: c.lon,
          },
        }),
      ),
    );
    return rows;
  } catch (err) {
    if (!(err instanceof DatabaseNotConfiguredError)) {
      log.warn({ err, zip }, "theater cache write failed; serving live results");
    }
    return fallback;
  }
}

async function handleTheaters(req: FastifyRequest, reply: FastifyReply) {
  const parsed = zipSchema.safeParse((req.query as Record<string, unknown>).zip);
  if (!parsed.success) {
    return sendError(reply, 400, "Query parameter 'zip' (5 digits) is required");
  }
  const zip = parsed.data;

  let geo: ZipGeo;
  try {
    geo = await geocodeZip(zip);
  } catch (err) {
    if (err instanceof ZipNotFoundError) {
      return sendError(reply, 404, `Unknown ZIP code: ${zip}`);
    }
    req.log.warn({ err, zip }, "zip geocode upstream failure");
    return sendError(reply, 502, "Location lookup temporarily unavailable");
  }

  const cached = await readCache(req.log, zip);
  if (cached) return toResponse(zip, geo, cached);

  let cinemas: RawCinema[];
  try {
    cinemas = dedupeCinemas(await fetchCinemas(geo.lat, geo.lon));
  } catch (err) {
    if (err instanceof UpstreamError) {
      req.log.warn({ err: err.message, zip }, "theater upstream failure");
    } else {
      req.log.warn({ err, zip }, "theater lookup unexpected failure");
    }
    return sendError(reply, 502, "Theater lookup temporarily unavailable");
  }

  const rows = await writeCache(req.log, zip, cinemas);
  return toResponse(zip, geo, rows);
}

export async function theatersRoutes(app: FastifyInstance) {
  app.get("/theaters", handleTheaters);
}
