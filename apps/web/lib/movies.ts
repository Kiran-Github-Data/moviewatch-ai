import type { MovieDetails, PagedMovies } from "@moviewatch/contracts";
import { apiFetch } from "./api";

export type BrowseTab = "upcoming" | "trending" | "now-playing";

export async function fetchMovies(
  tab: BrowseTab | "search",
  opts: { q?: string; page?: number } = {},
): Promise<PagedMovies> {
  const params = new URLSearchParams();
  if (opts.page && opts.page > 1) params.set("page", String(opts.page));
  if (tab === "search") {
    params.set("q", opts.q ?? "");
    return apiFetch<PagedMovies>(`/movies/search?${params.toString()}`);
  }
  return apiFetch<PagedMovies>(`/movies/${tab}?${params.toString()}`);
}

export async function fetchMovieDetails(id: string): Promise<MovieDetails> {
  return apiFetch<MovieDetails>(`/movies/${encodeURIComponent(id)}`);
}

/** The API returns 503 when the TMDB credential isn't set server-side. */
export function isDiscoveryNotConfigured(err: unknown): boolean {
  return err instanceof Error && err.message.includes("API 503");
}
