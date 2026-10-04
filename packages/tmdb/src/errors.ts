/** Typed errors for the TMDB client. Never include the API key in messages. */

export class TmdbNotConfiguredError extends Error {
  constructor() {
    super(
      "TMDB is not configured. Set TMDB_READ_ACCESS_TOKEN (v4) or TMDB_API_KEY (v3) on the server.",
    );
    this.name = "TmdbNotConfiguredError";
  }
}

export class TmdbApiError extends Error {
  readonly status: number;
  readonly tmdbMessage: string;

  constructor(status: number, tmdbMessage: string) {
    super(`TMDB API error ${status}: ${tmdbMessage}`);
    this.name = "TmdbApiError";
    this.status = status;
    this.tmdbMessage = tmdbMessage;
  }
}

export class TmdbRateLimitError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(`TMDB rate limit exceeded; retry after ${retryAfterMs}ms`);
    this.name = "TmdbRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}
