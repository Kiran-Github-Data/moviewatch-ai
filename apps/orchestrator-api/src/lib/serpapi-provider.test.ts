import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SerpApiTicketProvider,
  theaterNameMatches,
  movieTitleMatches,
  parseShowtime,
  formatShowtimeDisplay,
  normalizeName,
  PRICE_UNKNOWN,
  type SerpApiProviderOptions,
} from "./serpapi-provider.js";
import {
  selectTicketProvider,
  EnvTicketProvider,
  MockTicketProvider,
} from "./monitor.js";
import type { WatchForCheck } from "./monitor.js";

function makeWatch(overrides: Partial<WatchForCheck> = {}): WatchForCheck {
  return {
    id: "w1",
    userId: "u1",
    userEmail: "fan@example.com",
    movieTitle: "Dune: Part Two",
    tmdbId: 42,
    status: "MONITORING",
    zip: "75078",
    actionMode: "notify",
    autoBookEnabled: false,
    consentAt: null,
    maxTotalCents: null,
    ticketCount: 2,
    maxTicketPriceCents: 2000,
    theatersRank1: ["t1"],
    theatersRank2: ["t2"],
    defaultPaymentMethodId: null,
    defaultPaymentMethodLast4: null,
    stripeCustomerId: null,
    ...overrides,
  };
}

const SERPAPI_JSON = {
  showtimes: [
    {
      day: "Tomorrow",
      theaters: [
        {
          name: "Cinemark Frisco Square",
          address: "6969 Shimmer Way, Frisco, TX",
          movies: [
            {
              name: "Dune: Part Two",
              link: "https://www.google.com/search?q=dune",
              showing: [
                { time: ["7:30pm", "10:15pm"], type: "Standard" },
                { time: ["8:00pm"], type: "IMAX" },
              ],
            },
            {
              name: "Some Other Movie",
              showing: [{ time: ["6:00pm"], type: "Standard" }],
            },
          ],
        },
        {
          name: "Unrelated Theater Far Away",
          movies: [
            {
              name: "Dune: Part Two",
              showing: [{ time: ["9:00pm"], type: "Standard" }],
            },
          ],
        },
      ],
    },
  ],
};

function mockFetch(json: unknown, ok = true): typeof fetch {
  return (async () =>
    ({
      ok,
      json: async () => json,
    }) as Response) as typeof fetch;
}

function providerWith(
  json: unknown,
  opts: SerpApiProviderOptions = {},
): { provider: SerpApiTicketProvider; calls: string[] } {
  const calls: string[] = [];
  const fetchFn = (async (url: string) => {
    calls.push(url);
    return { ok: true, json: async () => json } as Response;
  }) as unknown as typeof fetch;
  const provider = new SerpApiTicketProvider({
    apiKey: "test-key",
    fetchFn,
    resolveTheaterNames: async (ids) =>
      new Map(ids.map((id) => [id, id === "t1" ? "Cinemark Frisco Square & XD" : "Flix Brewhouse"])),
    ...opts,
  });
  return { provider, calls };
}

describe("normalizeName / theaterNameMatches / movieTitleMatches", () => {
  it("matches Cinemark name variants", () => {
    assert.equal(theaterNameMatches("Cinemark Frisco Square & XD", "Cinemark Frisco Square"), true);
    assert.equal(theaterNameMatches("Cinemark Frisco Square", "Cinemark Frisco Square & XD"), true);
  });
  it("rejects unrelated theaters", () => {
    assert.equal(theaterNameMatches("Cinemark Frisco Square", "AMC NorthPark 15"), false);
    assert.equal(theaterNameMatches("Cinemark Frisco Square", "Unrelated Theater Far Away"), false);
  });
  it("matches movie titles fuzzily", () => {
    assert.equal(movieTitleMatches("Dune: Part Two", "Dune: Part Two (2024)"), true);
    assert.equal(movieTitleMatches("dune part two", "DUNE: PART TWO"), true);
    assert.equal(movieTitleMatches("Dune: Part Two", "Oppenheimer"), false);
  });
  it("handles empty inputs", () => {
    assert.equal(theaterNameMatches("", "AMC"), false);
    assert.equal(normalizeName("  A&B!! "), "aandb");
  });
});

describe("parseShowtime / formatShowtimeDisplay", () => {
  it("parses Tomorrow 7:30pm", () => {
    const now = new Date("2026-10-04T12:00:00");
    const d = parseShowtime("Tomorrow", "7:30pm", now);
    assert.ok(d);
    assert.equal(d.getDate(), 5);
    assert.equal(d.getHours(), 19);
    assert.equal(d.getMinutes(), 30);
  });
  it("parses explicit dates", () => {
    const now = new Date("2026-10-04T12:00:00");
    const d = parseShowtime("Fri, Dec 18", "8:00 PM", now);
    assert.ok(d);
    assert.equal(d.getMonth(), 11);
    assert.equal(d.getDate(), 18);
    assert.equal(d.getHours(), 20);
  });
  it("returns null for garbage", () => {
    assert.equal(parseShowtime("Someday", "whenever"), null);
  });
  it("formats display strings", () => {
    const s = formatShowtimeDisplay(new Date("2026-12-18T19:30:00"));
    assert.match(s, /Fri, Dec 18 · 7:30 PM/);
  });
});

describe("SerpApiTicketProvider", () => {
  it("returns [] when no API key is configured", async () => {
    delete process.env.SERPAPI_API_KEY;
    const p = new SerpApiTicketProvider({ apiKey: undefined, fetchFn: mockFetch({}) });
    assert.equal(p.isConfigured(), false);
    assert.deepEqual(await p.findOffers(makeWatch()), []);
  });

  it("maps showtimes to offers, filtering by theater preference", async () => {
    const { provider, calls } = providerWith(SERPAPI_JSON);
    const offers = await provider.findOffers(makeWatch());
    assert.equal(calls.length, 1);
    assert.ok(calls[0]?.includes("engine=google_showtimes"));
    assert.ok(calls[0]?.includes("75078"));
    // 2 standard + 1 IMAX at the matching theater; unrelated theater + other movie excluded.
    assert.equal(offers.length, 3);
    assert.ok(offers.every((o) => o.theaterName.includes("Cinemark Frisco Square")));
    assert.ok(offers.some((o) => o.showtime.includes("IMAX")));
    assert.ok(offers.every((o) => o.pricePerTicketCents === PRICE_UNKNOWN));
    assert.ok(offers.every((o) => o.bookingUrl.startsWith("http")));
    assert.ok(offers.every((o) => o.theaterId.startsWith("serpapi:")));
  });

  it("keeps all theaters when the watch has no preferences", async () => {
    const { provider } = providerWith(SERPAPI_JSON);
    const offers = await provider.findOffers(
      makeWatch({ theatersRank1: [], theatersRank2: [] }),
    );
    // 3 matching-theater + 1 unrelated-theater offer
    assert.equal(offers.length, 4);
  });

  it("returns [] on HTTP error", async () => {
    const p = new SerpApiTicketProvider({ apiKey: "k", fetchFn: mockFetch({}, false) });
    assert.deepEqual(await p.findOffers(makeWatch()), []);
  });

  it("returns [] on network failure", async () => {
    const p = new SerpApiTicketProvider({
      apiKey: "k",
      fetchFn: (async () => {
        throw new Error("boom");
      }) as typeof fetch,
    });
    assert.deepEqual(await p.findOffers(makeWatch()), []);
  });

  it("returns [] for malformed responses", async () => {
    const p = new SerpApiTicketProvider({ apiKey: "k", fetchFn: mockFetch({ nope: 1 }) });
    assert.deepEqual(await p.findOffers(makeWatch()), []);
  });
});

describe("selectTicketProvider", () => {
  it("prefers EnvTicketProvider when MOCK_TICKETS_JSON is set", () => {
    process.env.MOCK_TICKETS_JSON = "[]";
    process.env.SERPAPI_API_KEY = "serp-key";
    try {
      assert.ok(selectTicketProvider() instanceof EnvTicketProvider);
    } finally {
      delete process.env.MOCK_TICKETS_JSON;
      delete process.env.SERPAPI_API_KEY;
    }
  });

  it("uses SerpApiTicketProvider when SERPAPI_API_KEY is set", () => {
    delete process.env.MOCK_TICKETS_JSON;
    process.env.SERPAPI_API_KEY = "serp-key";
    try {
      const p = selectTicketProvider();
      assert.ok(p instanceof SerpApiTicketProvider);
      assert.equal((p as SerpApiTicketProvider).isConfigured(), true);
    } finally {
      delete process.env.SERPAPI_API_KEY;
    }
  });

  it("falls back to MockTicketProvider with no keys", () => {
    delete process.env.MOCK_TICKETS_JSON;
    delete process.env.SERPAPI_API_KEY;
    assert.ok(selectTicketProvider() instanceof MockTicketProvider);
  });
});
