import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TmdbClient } from "./client.js";
import { TmdbApiError, TmdbNotConfiguredError, TmdbRateLimitError } from "./errors.js";
import { TokenBucket } from "./rate-limit.js";

const summary = {
  id: 1, title: "Test Movie", overview: "An overview.", release_date: "2027-05-01",
  poster_path: "/p.jpg", backdrop_path: "/b.jpg", genre_ids: [28, 878],
  popularity: 10.5, vote_average: 7.2,
};

function mockFetch(handler: (url: string) => Response | Promise<Response>): typeof fetch {
  return (async (url: unknown) => handler(url as string)) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const clientWith = (handler: (url: string) => Response | Promise<Response>) =>
  new TmdbClient({
    readAccessToken: "test-token",
    fetchImpl: mockFetch(handler),
    bucket: new TokenBucket(1000, 1000), // effectively unlimited for tests
  });

describe("TmdbClient", () => {
  it("throws TmdbNotConfiguredError without any credential", () => {
    const env = { ...process.env };
    delete env.TMDB_READ_ACCESS_TOKEN;
    delete env.TMDB_API_KEY;
    const orig = process.env;
    process.env = env as NodeJS.ProcessEnv;
    try {
      assert.throws(() => new TmdbClient({ readAccessToken: undefined, apiKey: undefined }), TmdbNotConfiguredError);
    } finally {
      process.env = orig;
    }
  });

  it("parses upcoming results and normalizes fields", async () => {
    const seen: string[] = [];
    const client = clientWith((url) => {
      seen.push(url);
      return jsonResponse({ page: 1, results: [summary], total_pages: 3, total_results: 60 });
    });
    const paged = await client.upcoming(2);
    assert.equal(paged.page, 1);
    assert.equal(paged.totalPages, 3);
    assert.equal(paged.movies.length, 1);
    assert.equal(paged.movies[0]?.title, "Test Movie");
    assert.ok(seen[0]?.includes("/movie/upcoming"), "hits the upcoming endpoint");
    assert.ok(seen[0]?.includes("page=2"), "passes the page param");
  });

  it("sends the v4 token as a Bearer header", async () => {
    let authHeader: string | null = null;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      authHeader = (init?.headers as Record<string, string>).authorization ?? null;
      return jsonResponse({ page: 1, results: [], total_pages: 0, total_results: 0 });
    }) as typeof fetch;
    const client = new TmdbClient({
      readAccessToken: "secret-token",
      fetchImpl,
      bucket: new TokenBucket(1000, 1000),
    });
    await client.trending();
    assert.equal(authHeader, "Bearer secret-token");
  });

  it("falls back to the v3 api_key query param", async () => {
    let seenUrl = "";
    const fetchImpl = (async (url: unknown) => {
      seenUrl = url as string;
      return jsonResponse({ page: 1, results: [], total_pages: 0, total_results: 0 });
    }) as typeof fetch;
    const client = new TmdbClient({
      readAccessToken: undefined,
      apiKey: "v3-key",
      fetchImpl,
      bucket: new TokenBucket(1000, 1000),
    });
    await client.nowPlaying();
    assert.ok(seenUrl.includes("api_key=v3-key"), "v3 key sent as query param");
  });

  it("normalizes details: cast sorted, trailer picked, dates parsed", async () => {
    const client = clientWith(() =>
      jsonResponse({
        ...summary,
        runtime: 142,
        genres: [{ id: 28, name: "Action" }],
        credits: {
          cast: [
            { id: 2, name: "Second", character: "Side", profile_path: null, order: 1 },
            { id: 1, name: "First", character: "Lead", profile_path: "/f.jpg", order: 0 },
          ],
        },
        videos: {
          results: [
            { key: "teaser1", site: "YouTube", type: "Teaser", official: true },
            { key: "trailer1", site: "YouTube", type: "Trailer", official: true },
            { key: "trailer2", site: "YouTube", type: "Trailer", official: false },
          ],
        },
      }),
    );
    const details = await client.details(1);
    assert.equal(details.runtime, 142);
    assert.deepEqual(details.genres, [{ id: 28, name: "Action" }]);
    assert.equal(details.cast[0]?.name, "First", "cast sorted by order");
    assert.equal(details.cast.length, 2);
    assert.equal(details.trailerKey, "trailer1", "prefers the official trailer");
    assert.equal(details.releaseDate?.toISOString(), "2027-05-01T00:00:00.000Z");
  });

  it("maps HTTP errors to TmdbApiError with the TMDB message", async () => {
    const client = clientWith(() =>
      jsonResponse({ status_message: "Invalid API key", status_code: 7 }, 401),
    );
    await assert.rejects(() => client.search("x"), (err: unknown) => {
      assert.ok(err instanceof TmdbApiError);
      assert.equal(err.status, 401);
      assert.ok(err.message.includes("Invalid API key"));
      return true;
    });
  });

  it("maps 429 to TmdbRateLimitError with retry-after", async () => {
    const client = clientWith(() =>
      new Response("slow down", { status: 429, headers: { "retry-after": "5" } }),
    );
    await assert.rejects(() => client.upcoming(), (err: unknown) => {
      assert.ok(err instanceof TmdbRateLimitError);
      assert.equal(err.retryAfterMs, 5000);
      return true;
    });
  });

  it("maps network failures to TmdbApiError", async () => {
    const client = new TmdbClient({
      readAccessToken: "t",
      fetchImpl: (async () => { throw new Error("boom"); }) as typeof fetch,
      bucket: new TokenBucket(1000, 1000),
    });
    await assert.rejects(() => client.upcoming(), TmdbApiError);
  });
});
