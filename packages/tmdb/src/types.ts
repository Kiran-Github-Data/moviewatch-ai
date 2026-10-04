import { z } from "zod";

/**
 * Zod schemas for the TMDB v3 API responses we consume.
 * Schemas are strict about what we read and lenient about what TMDB adds.
 */

const movieSummarySchema = z.object({
  id: z.number(),
  title: z.string(),
  overview: z.string().catch(""),
  release_date: z.string().catch(""),
  poster_path: z.string().nullable().catch(null),
  backdrop_path: z.string().nullable().catch(null),
  genre_ids: z.array(z.number()).catch([]),
  popularity: z.number().catch(0),
  vote_average: z.number().catch(0),
});

const pagedResultsSchema = z.object({
  page: z.number(),
  results: z.array(movieSummarySchema),
  total_pages: z.number(),
  total_results: z.number(),
});

const genreSchema = z.object({ id: z.number(), name: z.string() });

const castMemberSchema = z.object({
  id: z.number(),
  name: z.string(),
  character: z.string().catch(""),
  profile_path: z.string().nullable().catch(null),
  order: z.number().catch(999),
});

const videoSchema = z.object({
  key: z.string(),
  site: z.string(),
  type: z.string(),
  official: z.boolean().catch(false),
});

const movieDetailsSchema = movieSummarySchema.extend({
  runtime: z.number().nullable().catch(null),
  genres: z.array(genreSchema).catch([]),
  credits: z.object({ cast: z.array(castMemberSchema).catch([]) }).catch({ cast: [] }),
  videos: z.object({ results: z.array(videoSchema).catch([]) }).catch({ results: [] }),
});

export type TmdbMovieSummary = z.infer<typeof movieSummarySchema>;
export type TmdbMovieDetails = z.infer<typeof movieDetailsSchema>;
export type TmdbCastMember = z.infer<typeof castMemberSchema>;

export interface TmdbPagedMovies {
  page: number;
  totalPages: number;
  totalResults: number;
  movies: TmdbMovieSummary[];
}

/** Normalized shape the rest of the app consumes (snake_case → our domain). */
export interface NormalizedMovie {
  tmdbId: number;
  title: string;
  overview: string | null;
  releaseDate: Date | null;
  posterPath: string | null;
  backdropPath: string | null;
  genreIds: number[];
  popularity: number;
  voteAverage: number;
}

export interface NormalizedMovieDetails extends NormalizedMovie {
  runtime: number | null;
  genres: { id: number; name: string }[];
  cast: { id: number; name: string; character: string; profilePath: string | null }[];
  trailerKey: string | null;
}

function parseDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pickTrailer(videos: z.infer<typeof videoSchema>[]): string | null {
  const yt = videos.filter((v) => v.site === "YouTube");
  return (
    yt.find((v) => v.type === "Trailer" && v.official)?.key ??
    yt.find((v) => v.type === "Trailer")?.key ??
    yt.find((v) => v.type === "Teaser" && v.official)?.key ??
    null
  );
}

export function parsePagedMovies(json: unknown): TmdbPagedMovies {
  const parsed = pagedResultsSchema.parse(json);
  return {
    page: parsed.page,
    totalPages: parsed.total_pages,
    totalResults: parsed.total_results,
    movies: parsed.results,
  };
}

export function normalizeSummary(m: TmdbMovieSummary): NormalizedMovie {
  return {
    tmdbId: m.id,
    title: m.title,
    overview: m.overview || null,
    releaseDate: parseDate(m.release_date),
    posterPath: m.poster_path,
    backdropPath: m.backdrop_path,
    genreIds: m.genre_ids,
    popularity: m.popularity,
    voteAverage: m.vote_average,
  };
}

export function normalizeDetails(m: TmdbMovieDetails): NormalizedMovieDetails {
  return {
    ...normalizeSummary(m),
    runtime: m.runtime,
    genres: m.genres,
    cast: [...m.credits.cast]
      .sort((a, b) => a.order - b.order)
      .slice(0, 12)
      .map((c) => ({ id: c.id, name: c.name, character: c.character, profilePath: c.profile_path })),
    trailerKey: pickTrailer(m.videos.results),
  };
}

export function parseMovieDetails(json: unknown): NormalizedMovieDetails {
  return normalizeDetails(movieDetailsSchema.parse(json));
}

/** TMDB genre id → name for the ids we care about (fallback when details aren't loaded). */
export const TMDB_GENRES: Record<number, string> = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi",
  10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
};

export function genreNames(ids: number[]): string[] {
  return ids.map((id) => TMDB_GENRES[id]).filter((n): n is string => Boolean(n));
}
