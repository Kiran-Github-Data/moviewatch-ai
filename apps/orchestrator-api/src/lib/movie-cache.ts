import {
  backdropUrl,
  genreNames,
  normalizeSummary,
  posterUrl,
  type NormalizedMovie,
  type NormalizedMovieDetails,
  type TmdbPagedMovies,
} from "@moviewatch/tmdb";
import type { MovieDetails, MovieSummary, PagedMovies } from "@moviewatch/contracts";

/**
 * TMDB cache policy (PLAN.md Milestone 2):
 * - Unreleased movies change often (dates, posters) → 7-day TTL.
 * - Released movies are stable → 90-day TTL.
 * - Hard cap: 6 months, per TMDB's caching guidance.
 */
export const UNRELEASED_TTL_MS = 7 * 24 * 3600 * 1000;
export const RELEASED_TTL_MS = 90 * 24 * 3600 * 1000;
export const TMDB_MAX_CACHE_MS = 180 * 24 * 3600 * 1000;

export function cacheTtlMs(releaseDate: Date | null, now: Date): number {
  const upcoming = releaseDate !== null && releaseDate.getTime() > now.getTime();
  return Math.min(upcoming ? UNRELEASED_TTL_MS : RELEASED_TTL_MS, TMDB_MAX_CACHE_MS);
}

export type CacheDecision = "hit" | "miss" | "expired";

/** Pure cache lookup decision — unit-tested without a database. */
export function cacheDecision(
  cached: { tmdbCacheExpiresAt: Date | null } | null,
  now: Date,
): CacheDecision {
  if (!cached?.tmdbCacheExpiresAt) return "miss";
  return cached.tmdbCacheExpiresAt.getTime() > now.getTime() ? "hit" : "expired";
}

export async function resolveMovieDetail<T>(
  cached: (T & { tmdbCacheExpiresAt: Date | null }) | null,
  now: Date,
  fetchFresh: () => Promise<T>,
): Promise<{ movie: T; source: "cache" | "fresh" }> {
  if (cached && cacheDecision(cached, now) === "hit") {
    return { movie: cached, source: "cache" };
  }
  return { movie: await fetchFresh(), source: "fresh" };
}

// --- Presenters: TMDB/DB shapes → API contracts ----------------------------

export function toMovieSummary(m: NormalizedMovie): MovieSummary {
  return {
    tmdbId: m.tmdbId,
    title: m.title,
    overview: m.overview,
    releaseDate: m.releaseDate ? m.releaseDate.toISOString() : null,
    posterUrl: posterUrl(m.posterPath, "w500"),
    backdropUrl: backdropUrl(m.backdropPath, "w1280"),
    genres: genreNames(m.genreIds),
    popularity: m.popularity,
    voteAverage: m.voteAverage,
  };
}

export function toMovieDetails(
  d: NormalizedMovieDetails,
  source: "cache" | "fresh",
): MovieDetails {
  return {
    ...toMovieSummary(d),
    runtime: d.runtime,
    cast: d.cast.map((c) => ({
      id: c.id,
      name: c.name,
      character: c.character,
      profileUrl: posterUrl(c.profilePath, "w185"),
    })),
    trailerKey: d.trailerKey,
    trailerUrl: d.trailerKey ? `https://www.youtube.com/watch?v=${d.trailerKey}` : null,
    genres: d.genres.map((g) => g.name),
    cacheSource: source,
  };
}

export function toPagedMovies(paged: TmdbPagedMovies): PagedMovies {
  return {
    page: paged.page,
    totalPages: paged.totalPages,
    totalResults: paged.totalResults,
    movies: paged.movies.map((m) => toMovieSummary(normalizeSummary(m))),
  };
}

// --- Prisma upsert payloads ------------------------------------------------

function baseUpsert(m: NormalizedMovie, now: Date) {
  return {
    tmdbId: m.tmdbId,
    title: m.title,
    overview: m.overview,
    releaseDate: m.releaseDate,
    posterPath: m.posterPath,
    backdropPath: m.backdropPath,
    popularity: m.popularity,
    voteAverage: m.voteAverage,
    tmdbCacheExpiresAt: new Date(now.getTime() + cacheTtlMs(m.releaseDate, now)),
  };
}

/** Lightweight row from a list result (no cast/trailer yet). */
export function toMovieUpsertFromSummary(m: NormalizedMovie, now: Date) {
  return {
    ...baseUpsert(m, now),
    genres: genreNames(m.genreIds),
  };
}

/** Full row from a details fetch, incl. the JSON details cache. */
export function toMovieUpsertFromDetails(d: NormalizedMovieDetails, now: Date) {
  return {
    ...baseUpsert(d, now),
    runtime: d.runtime,
    genres: d.genres.map((g) => g.name),
    trailerKey: d.trailerKey,
    detailsJson: JSON.stringify(d),
  };
}
