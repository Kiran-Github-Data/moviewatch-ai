import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { DatabaseNotConfiguredError, getPrisma } from "@moviewatch/database";
import {
  TmdbApiError,
  TmdbNotConfiguredError,
  TmdbRateLimitError,
  normalizeSummary,
  type NormalizedMovie,
  type NormalizedMovieDetails,
  type TmdbPagedMovies,
} from "@moviewatch/tmdb";
import { getTmdbClient } from "../lib/tmdb.js";
import {
  cacheDecision,
  toMovieDetails,
  toPagedMovies,
  toMovieUpsertFromDetails,
  toMovieUpsertFromSummary,
} from "../lib/movie-cache.js";
import { sendError } from "../lib/errors.js";

/**
 * Public movie-discovery routes (Milestone 2). Browsing is intentionally
 * public — no auth needed to see what's coming soon. All TMDB access stays
 * server-side; the web app never sees the TMDB credential.
 *
 *   GET /api/v1/movies/upcoming?page=
 *   GET /api/v1/movies/trending?page=
 *   GET /api/v1/movies/now-playing?page=
 *   GET /api/v1/movies/search?q=&page=
 *   GET /api/v1/movies/:id          (tmdbId; DB-first with cache enforcement)
 */

const pageSchema = z.coerce.number().int().min(1).max(500).default(1);

type ListKind = "upcoming" | "trending" | "now-playing" | "search";

/** Short in-memory cache for list endpoints — 10 minutes. */
const listCache = new Map<string, { expiresAt: number; body: unknown }>();
const LIST_TTL_MS = 10 * 60 * 1000;

function mapTmdbError(reply: FastifyReply, err: unknown) {
  if (err instanceof TmdbRateLimitError) {
    reply.header("retry-after", String(Math.ceil(err.retryAfterMs / 1000)));
    return sendError(reply, 429, "Movie provider rate limit exceeded — try again shortly");
  }
  if (err instanceof TmdbApiError) {
    if (err.status === 404) return sendError(reply, 404, "Movie not found");
    return sendError(reply, 502, "Movie provider error", undefined, err.tmdbMessage);
  }
  throw err;
}

/** Best-effort durable cache of list summaries. Never fails the request. */
function cacheSummariesBestEffort(
  log: FastifyRequest["log"],
  movies: NormalizedMovie[],
): void {
  void (async () => {
    try {
      const db = getPrisma();
      const now = new Date();
      await db.$transaction(
        movies.slice(0, 20).map((m) => {
          const data = toMovieUpsertFromSummary(m, now);
          const { tmdbId, ...rest } = data;
          return db.movie.upsert({ where: { tmdbId }, update: rest, create: data });
        }),
      );
    } catch (err) {
      if (!(err instanceof DatabaseNotConfiguredError)) {
        log.warn({ err }, "movie summary cache write failed");
      }
    }
  })();
}

async function handleList(
  req: FastifyRequest,
  reply: FastifyReply,
  kind: ListKind,
  query?: string,
) {
  const parsed = pageSchema.safeParse((req.query as Record<string, unknown>).page);
  if (!parsed.success) return sendError(reply, 400, "Invalid page parameter");
  const page = parsed.data;

  let client;
  try {
    client = getTmdbClient();
  } catch (err) {
    if (err instanceof TmdbNotConfiguredError) {
      return sendError(
        reply,
        503,
        "Movie discovery is not configured",
        undefined,
        "Set TMDB_READ_ACCESS_TOKEN or TMDB_API_KEY on the API server.",
      );
    }
    throw err;
  }

  const cacheKey = `${kind}:${query ?? ""}:${page}`;
  const nowMs = Date.now();
  const cached = listCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) return cached.body;

  let paged: TmdbPagedMovies;
  try {
    paged =
      kind === "upcoming"
        ? await client.upcoming(page)
        : kind === "trending"
          ? await client.trending(page)
          : kind === "now-playing"
            ? await client.nowPlaying(page)
            : await client.search(query as string, page);
  } catch (err) {
    return mapTmdbError(reply, err);
  }

  const body = toPagedMovies(paged);
  listCache.set(cacheKey, { expiresAt: nowMs + LIST_TTL_MS, body });
  cacheSummariesBestEffort(req.log, paged.movies.map(normalizeSummary));
  return body;
}

async function handleDetail(req: FastifyRequest, reply: FastifyReply, tmdbId: number) {
  let client;
  try {
    client = getTmdbClient();
  } catch (err) {
    if (err instanceof TmdbNotConfiguredError) {
      return sendError(
        reply,
        503,
        "Movie discovery is not configured",
        undefined,
        "Set TMDB_READ_ACCESS_TOKEN or TMDB_API_KEY on the API server.",
      );
    }
    throw err;
  }

  const now = new Date();
  let row: { tmdbCacheExpiresAt: Date | null; detailsJson: string | null } | null = null;
  try {
    row = await getPrisma().movie.findUnique({
      where: { tmdbId },
      select: { tmdbCacheExpiresAt: true, detailsJson: true },
    });
  } catch (err) {
    if (!(err instanceof DatabaseNotConfiguredError)) throw err;
  }

  if (cacheDecision(row, now) === "hit" && row?.detailsJson) {
    try {
      const parsed = JSON.parse(row.detailsJson) as NormalizedMovieDetails;
      return toMovieDetails(parsed, "cache");
    } catch {
      req.log.warn({ tmdbId }, "corrupt detailsJson cache; refetching");
    }
  }

  let fresh: NormalizedMovieDetails;
  try {
    fresh = await client.details(tmdbId);
  } catch (err) {
    return mapTmdbError(reply, err);
  }

  try {
    const data = toMovieUpsertFromDetails(fresh, now);
    const { tmdbId: id, ...rest } = data;
    await getPrisma().movie.upsert({ where: { tmdbId: id }, update: rest, create: data });
  } catch (err) {
    if (!(err instanceof DatabaseNotConfiguredError)) {
      req.log.warn({ err, tmdbId }, "movie detail cache write failed");
    }
  }

  return toMovieDetails(fresh, "fresh");
}

export async function moviesRoutes(app: FastifyInstance) {
  app.get("/movies/upcoming", (req, reply) => handleList(req, reply, "upcoming"));
  app.get("/movies/trending", (req, reply) => handleList(req, reply, "trending"));
  app.get("/movies/now-playing", (req, reply) => handleList(req, reply, "now-playing"));

  app.get("/movies/search", (req, reply) => {
    const q = (req.query as Record<string, unknown>).q;
    if (typeof q !== "string" || q.trim().length < 2) {
      return sendError(reply, 400, "Query parameter 'q' (min 2 characters) is required");
    }
    return handleList(req, reply, "search", q.trim());
  });

  app.get("/movies/:id", (req, reply) => {
    const tmdbId = Number((req.params as Record<string, string>).id);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      return sendError(reply, 400, "Invalid movie id");
    }
    return handleDetail(req, reply, tmdbId);
  });
}
