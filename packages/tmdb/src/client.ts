import {
  TmdbApiError,
  TmdbNotConfiguredError,
  TmdbRateLimitError,
} from "./errors.js";
import { TokenBucket } from "./rate-limit.js";
import {
  parseMovieDetails,
  parsePagedMovies,
  type NormalizedMovieDetails,
  type TmdbPagedMovies,
} from "./types.js";

const API_BASE = "https://api.themoviedb.org/3";

export interface TmdbClientOptions {
  /** v4 read-access token (preferred). Falls back to TMDB_API_KEY (v3). */
  readAccessToken?: string;
  apiKey?: string;
  language?: string;
  region?: string;
  fetchImpl?: typeof fetch;
  bucket?: TokenBucket;
}

export function tmdbConfiguredFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TMDB_READ_ACCESS_TOKEN ?? env.TMDB_API_KEY);
}

/**
 * Server-side TMDB client. The key/token must NEVER leave the server —
 * the web app only ever talks to our /movies API, never to TMDB directly.
 */
export class TmdbClient {
  private readonly headers: Record<string, string>;
  private readonly query: URLSearchParams;
  private readonly language: string;
  private readonly region: string;
  private readonly fetchImpl: typeof fetch;
  private readonly bucket: TokenBucket;

  constructor(opts: TmdbClientOptions = {}) {
    const token = opts.readAccessToken ?? process.env.TMDB_READ_ACCESS_TOKEN;
    const apiKey = opts.apiKey ?? process.env.TMDB_API_KEY;
    if (!token && !apiKey) throw new TmdbNotConfiguredError();

    this.headers = { accept: "application/json" };
    this.query = new URLSearchParams();
    if (token) {
      this.headers.authorization = `Bearer ${token}`;
    } else {
      this.query.set("api_key", apiKey as string);
    }
    this.language = opts.language ?? "en-US";
    this.region = opts.region ?? "US";
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.bucket = opts.bucket ?? new TokenBucket();
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    await this.bucket.take();
    const url = new URL(`${API_BASE}${path}`);
    for (const [k, v] of this.query) url.searchParams.set(k, v);
    url.searchParams.set("language", this.language);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), { headers: this.headers });
    } catch (err) {
      throw new TmdbApiError(0, `network error: ${(err as Error).message}`);
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "2");
      throw new TmdbRateLimitError(retryAfter * 1000);
    }
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const body = (await res.json()) as { status_message?: string };
        if (body?.status_message) msg = body.status_message;
      } catch { /* keep statusText */ }
      throw new TmdbApiError(res.status, msg);
    }
    return (await res.json()) as T;
  }

  /** Upcoming theatrical releases, soonest first. */
  async upcoming(page = 1): Promise<TmdbPagedMovies> {
    return parsePagedMovies(await this.get("/movie/upcoming", { region: this.region, page: String(page) }));
  }

  /** What's trending this week, by TMDB's ranking. */
  async trending(page = 1): Promise<TmdbPagedMovies> {
    return parsePagedMovies(await this.get("/trending/movie/week", { page: String(page) }));
  }

  /** Currently in theaters. */
  async nowPlaying(page = 1): Promise<TmdbPagedMovies> {
    return parsePagedMovies(await this.get("/movie/now_playing", { region: this.region, page: String(page) }));
  }

  /** Title search (adult results excluded). */
  async search(query: string, page = 1): Promise<TmdbPagedMovies> {
    return parsePagedMovies(
      await this.get("/search/movie", {
        query,
        page: String(page),
        include_adult: "false",
        region: this.region,
      }),
    );
  }

  /** Full details incl. cast + trailer, normalized for our domain. */
  async details(tmdbId: number): Promise<NormalizedMovieDetails> {
    return parseMovieDetails(
      await this.get(`/movie/${tmdbId}`, { append_to_response: "credits,videos" }),
    );
  }
}
