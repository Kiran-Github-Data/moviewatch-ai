import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cacheDecision,
  cacheTtlMs,
  resolveMovieDetail,
  toMovieDetails,
  toMovieSummary,
  TMDB_MAX_CACHE_MS,
  RELEASED_TTL_MS,
  UNRELEASED_TTL_MS,
} from "./movie-cache.js";
import type { NormalizedMovieDetails } from "@moviewatch/tmdb";

const NOW = new Date("2026-10-03T12:00:00Z");

const details: NormalizedMovieDetails = {
  tmdbId: 42,
  title: "Future Film",
  overview: "A film.",
  releaseDate: new Date("2027-06-01T00:00:00Z"),
  posterPath: "/p.jpg",
  backdropPath: "/b.jpg",
  genreIds: [28, 878],
  popularity: 99.1,
  voteAverage: 8.4,
  runtime: 150,
  genres: [{ id: 28, name: "Action" }, { id: 878, name: "Sci-Fi" }],
  cast: [{ id: 7, name: "Star", character: "Hero", profilePath: "/s.jpg" }],
  trailerKey: "abc123",
};

describe("cacheTtlMs", () => {
  it("gives unreleased movies a short TTL", () => {
    assert.equal(cacheTtlMs(new Date("2027-01-01T00:00:00Z"), NOW), UNRELEASED_TTL_MS);
  });
  it("gives released movies a long TTL", () => {
    assert.equal(cacheTtlMs(new Date("2020-01-01T00:00:00Z"), NOW), RELEASED_TTL_MS);
  });
  it("gives dateless movies the released TTL", () => {
    assert.equal(cacheTtlMs(null, NOW), RELEASED_TTL_MS);
  });
  it("never exceeds the 6-month TMDB cap", () => {
    assert.ok(RELEASED_TTL_MS <= TMDB_MAX_CACHE_MS);
    assert.ok(UNRELEASED_TTL_MS <= TMDB_MAX_CACHE_MS);
  });
});

describe("cacheDecision", () => {
  it("misses when there is no row", () => {
    assert.equal(cacheDecision(null, NOW), "miss");
  });
  it("misses when the row was never stamped", () => {
    assert.equal(cacheDecision({ tmdbCacheExpiresAt: null }, NOW), "miss");
  });
  it("hits when the stamp is in the future", () => {
    assert.equal(
      cacheDecision({ tmdbCacheExpiresAt: new Date("2026-10-10T00:00:00Z") }, NOW),
      "hit",
    );
  });
  it("expires when the stamp is in the past", () => {
    assert.equal(
      cacheDecision({ tmdbCacheExpiresAt: new Date("2026-10-01T00:00:00Z") }, NOW),
      "expired",
    );
  });
});

describe("resolveMovieDetail", () => {
  it("returns the cached row without fetching on a hit", async () => {
    let fetched = false;
    const res = await resolveMovieDetail(
      { tmdbCacheExpiresAt: new Date("2026-12-01T00:00:00Z"), title: "cached" },
      NOW,
      async () => { fetched = true; return { title: "fresh" }; },
    );
    assert.equal(res.source, "cache");
    assert.equal((res.movie as { title: string }).title, "cached");
    assert.equal(fetched, false);
  });

  it("fetches fresh on a miss", async () => {
    const res = await resolveMovieDetail(null, NOW, async () => ({ title: "fresh" }));
    assert.equal(res.source, "fresh");
    assert.equal((res.movie as { title: string }).title, "fresh");
  });

  it("fetches fresh when expired", async () => {
    const res = await resolveMovieDetail(
      { tmdbCacheExpiresAt: new Date("2026-01-01T00:00:00Z"), title: "stale" },
      NOW,
      async () => ({ title: "fresh" }),
    );
    assert.equal(res.source, "fresh");
  });
});

describe("presenters", () => {
  it("toMovieSummary builds full image URLs and genre names", () => {
    const s = toMovieSummary(details);
    assert.equal(s.tmdbId, 42);
    assert.equal(s.posterUrl, "https://image.tmdb.org/t/p/w500/p.jpg");
    assert.equal(s.backdropUrl, "https://image.tmdb.org/t/p/w1280/b.jpg");
    assert.deepEqual(s.genres, ["Action", "Sci-Fi"]);
    assert.equal(s.releaseDate, "2027-06-01T00:00:00.000Z");
  });

  it("toMovieSummary tolerates missing images", () => {
    const s = toMovieSummary({ ...details, posterPath: null, backdropPath: null, releaseDate: null });
    assert.equal(s.posterUrl, null);
    assert.equal(s.backdropUrl, null);
    assert.equal(s.releaseDate, null);
  });

  it("toMovieDetails adds cast, trailer and cache source", () => {
    const d = toMovieDetails(details, "fresh");
    assert.equal(d.runtime, 150);
    assert.equal(d.cast[0]?.profileUrl, "https://image.tmdb.org/t/p/w185/s.jpg");
    assert.equal(d.trailerUrl, "https://www.youtube.com/watch?v=abc123");
    assert.equal(d.cacheSource, "fresh");
    assert.deepEqual(d.genres, ["Action", "Sci-Fi"]);
  });
});
