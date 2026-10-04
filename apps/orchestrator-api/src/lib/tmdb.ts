import {
  TmdbClient,
  TmdbNotConfiguredError,
  tmdbConfiguredFromEnv,
  type TmdbClientOptions,
} from "@moviewatch/tmdb";

let cached: TmdbClient | undefined;

/**
 * Server-side TMDB singleton. Throws TmdbNotConfiguredError (mapped to
 * 503) when neither TMDB_READ_ACCESS_TOKEN nor TMDB_API_KEY is set.
 * The credential never leaves the server — the web app only calls /movies.
 */
export function getTmdbClient(opts: TmdbClientOptions = {}): TmdbClient {
  if (!tmdbConfiguredFromEnv() && !opts.readAccessToken && !opts.apiKey) {
    throw new TmdbNotConfiguredError();
  }
  cached ??= new TmdbClient(opts);
  return cached;
}
