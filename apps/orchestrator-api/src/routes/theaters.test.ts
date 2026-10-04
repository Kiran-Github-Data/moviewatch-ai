import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import { theatersRoutes } from "./theaters.js";
import {
  UpstreamError,
  ZipNotFoundError,
  dedupeCinemas,
  fetchCinemas,
  geocodeZip,
  haversineKm,
  isCacheFresh,
  zipSchema,
  type RawCinema,
} from "../lib/theater-lookup.js";

// These tests run with DATABASE_URL unset: route validation (400/404/502)
// must fail fast without a database, and the happy path degrades to
// in-memory rows (providerId as id) when persistence is unavailable.
delete process.env.DATABASE_URL;

type FetchHandler = (url: string) => Response | Promise<Response>;

let restoreFetch: (() => void) | null = null;

function stubFetch(handler: FetchHandler): void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : String(input);
    return handler(url);
  }) as typeof fetch;
  restoreFetch = () => {
    globalThis.fetch = original;
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ZIPPOPOTAM_OK = {
  "post code": "75078",
  country: "United States",
  places: [
    {
      "place name": "Prosper",
      longitude: "-96.7785",
      latitude: "33.2362",
      state: "Texas",
      "state abbreviation": "TX",
    },
  ],
};

const NOMINATIM_OK = [
  {
    osm_type: "node",
    osm_id: 1,
    lat: "33.24",
    lon: "-96.78",
    name: "Cinemark Prosper",
    address: {
      house_number: "1300",
      road: "W Frontier Pkwy",
      city: "Prosper",
    },
  },
  {
    osm_type: "way",
    osm_id: 2,
    lat: "33.2",
    lon: "-96.82",
    name: "AMC Frisco",
    address: { city: "Frisco" },
  },
  // Duplicate of the first (same name + coords) — must be deduped.
  {
    osm_type: "node",
    osm_id: 3,
    lat: "33.24",
    lon: "-96.78",
    name: "Cinemark Prosper",
    address: { road: "W Frontier Pkwy" },
  },
  // Unnamed — must be skipped.
  { osm_type: "node", osm_id: 4, lat: "33.25", lon: "-96.79" },
];

function stubHappyPath(): void {
  stubFetch((url) => {
    if (url.startsWith("https://api.zippopotam.us/")) return jsonResponse(ZIPPOPOTAM_OK);
    if (url.startsWith("https://nominatim.openstreetmap.org/")) return jsonResponse(NOMINATIM_OK);
    throw new Error(`unexpected fetch: ${url}`);
  });
}

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});

describe("zipSchema", () => {
  it("accepts a 5-digit zip", () => {
    assert.equal(zipSchema.safeParse("75078").success, true);
  });
  for (const bad of ["7507", "750789", "abcde", "7507a", "", " 75078", "75078-1234"]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      assert.equal(zipSchema.safeParse(bad).success, false);
    });
  }
  it("rejects non-strings", () => {
    assert.equal(zipSchema.safeParse(undefined).success, false);
    assert.equal(zipSchema.safeParse(75078).success, false);
  });
});

describe("geocodeZip", () => {
  it("parses the Zippopotam response", async () => {
    stubFetch((url) => {
      assert.ok(url === "https://api.zippopotam.us/us/75078");
      return jsonResponse(ZIPPOPOTAM_OK);
    });
    const geo = await geocodeZip("75078");
    assert.equal(geo.zip, "75078");
    assert.equal(geo.lat, 33.2362);
    assert.equal(geo.lon, -96.7785);
    assert.equal(geo.city, "Prosper");
  });

  it("throws ZipNotFoundError on 404", async () => {
    stubFetch(() => new Response("not found", { status: 404 }));
    await assert.rejects(() => geocodeZip("00000"), ZipNotFoundError);
  });

  it("throws UpstreamError on 500", async () => {
    stubFetch(() => new Response("boom", { status: 500 }));
    await assert.rejects(() => geocodeZip("75078"), UpstreamError);
  });

  it("throws UpstreamError on network failure", async () => {
    stubFetch(() => {
      throw new Error("socket hang up");
    });
    await assert.rejects(() => geocodeZip("75078"), UpstreamError);
  });
});

describe("fetchCinemas", () => {
  it("parses nodes and ways, skips unnamed, builds provider ids", async () => {
    stubFetch(() => jsonResponse(NOMINATIM_OK));
    const cinemas = await fetchCinemas(33.2362, -96.7785);
    assert.equal(cinemas.length, 3); // dedupe happens separately
    const byId = new Map(cinemas.map((c) => [c.providerId, c]));
    assert.equal(byId.get("osm:node/1")?.name, "Cinemark Prosper");
    assert.equal(byId.get("osm:node/1")?.address, "1300 W Frontier Pkwy");
    assert.equal(byId.get("osm:node/1")?.city, "Prosper");
    assert.equal(byId.get("osm:way/2")?.lat, 33.2);
    assert.equal(byId.get("osm:way/2")?.address, "");
  });

  it("throws UpstreamError on HTTP error", async () => {
    stubFetch(() => new Response("overloaded", { status: 504 }));
    await assert.rejects(() => fetchCinemas(0, 0), UpstreamError);
  });

  it("throws UpstreamError on network failure", async () => {
    stubFetch(() => {
      throw new Error("timeout");
    });
    await assert.rejects(() => fetchCinemas(0, 0), UpstreamError);
  });
});

describe("dedupeCinemas", () => {
  const mk = (name: string, lat: number, lon: number, id: string): RawCinema => ({
    providerId: id,
    name,
    address: "",
    city: "",
    lat,
    lon,
  });

  it("removes same-name/same-coords duplicates", () => {
    const cinemas = [
      mk("Cinemark", 33.24001, -96.78001, "osm:node/1"),
      mk("cinemark ", 33.24002, -96.78002, "osm:way/2"), // rounds to same 4dp
      mk("AMC", 33.2, -96.82, "osm:node/3"),
    ];
    const out = dedupeCinemas(cinemas);
    assert.equal(out.length, 2);
    assert.equal(out[0]?.providerId, "osm:node/1"); // first wins
    assert.equal(out[1]?.providerId, "osm:node/3");
  });

  it("keeps same name at different locations", () => {
    const cinemas = [mk("Cinemark", 33.24, -96.78, "a"), mk("Cinemark", 33.3, -96.9, "b")];
    assert.equal(dedupeCinemas(cinemas).length, 2);
  });
});

describe("haversineKm", () => {
  it("is zero for the same point", () => {
    assert.equal(haversineKm(33.24, -96.78, 33.24, -96.78), 0);
  });

  it("matches the known NYC–LA distance (~3936 km)", () => {
    const km = haversineKm(40.7128, -74.006, 34.0522, -118.2437);
    assert.ok(km > 3900 && km < 3970, `expected ~3936, got ${km}`);
  });
});

describe("isCacheFresh", () => {
  const now = new Date("2026-10-03T12:00:00Z");
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

  it("is fresh at 29 days", () => {
    assert.equal(isCacheFresh(daysAgo(29), now), true);
  });
  it("is stale at 31 days", () => {
    assert.equal(isCacheFresh(daysAgo(31), now), false);
  });
});

describe("theaters route", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    await app.register(theatersRoutes, { prefix: "/api/v1" });
  });

  it("400s when zip is missing", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/theaters" });
    assert.equal(res.statusCode, 400);
  });

  it("400s when zip is malformed", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/theaters?zip=abc" });
    assert.equal(res.statusCode, 400);
  });

  it("404s for an unknown zip", async () => {
    stubFetch((url) => {
      assert.ok(url.startsWith("https://api.zippopotam.us/"));
      return new Response("not found", { status: 404 });
    });
    const res = await app.inject({ method: "GET", url: "/api/v1/theaters?zip=00000" });
    assert.equal(res.statusCode, 404);
  });

  it("502s when geocoding fails", async () => {
    stubFetch(() => {
      throw new Error("dns failure");
    });
    const res = await app.inject({ method: "GET", url: "/api/v1/theaters?zip=75078" });
    assert.equal(res.statusCode, 502);
  });

  it("502s when Nominatim fails", async () => {
    stubFetch((url) => {
      if (url.startsWith("https://api.zippopotam.us/")) return jsonResponse(ZIPPOPOTAM_OK);
      return new Response("overloaded", { status: 504 });
    });
    const res = await app.inject({ method: "GET", url: "/api/v1/theaters?zip=75078" });
    assert.equal(res.statusCode, 502);
  });

  it("returns theaters sorted by distance (no DB → in-memory rows)", async () => {
    stubHappyPath();
    const res = await app.inject({ method: "GET", url: "/api/v1/theaters?zip=75078" });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      zip: string;
      theaters: { id: string; name: string; address: string; city: string; distanceKm: number }[];
    };
    assert.equal(body.zip, "75078");
    assert.equal(body.theaters.length, 2);
    const [first, second] = body.theaters;
    assert.equal(first?.name, "Cinemark Prosper");
    assert.equal(first?.address, "1300 W Frontier Pkwy");
    assert.equal(first?.city, "Prosper");
    assert.equal(second?.name, "AMC Frisco");
    assert.ok(
      (first?.distanceKm ?? 0) <= (second?.distanceKm ?? 0),
      "theaters must be sorted by distance",
    );
  });
});
