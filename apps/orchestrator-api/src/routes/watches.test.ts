import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import "../plugins/auth.js"; // loads the FastifyRequest.auth augmentation
import { watchesRoutes } from "./watches.js";

// Route validation must fail fast without a database: these tests run
// with DATABASE_URL unset, so 400s prove validation precedes DB access
// and 503s prove the graceful degradation.
delete process.env.DATABASE_URL;

let app: FastifyInstance;

before(async () => {
  app = Fastify();
  app.addHook("onRequest", async (req) => {
    req.auth = { userId: "user_test", clerkUserId: "clerk_test", email: "t@example.com" };
  });
  await app.register(watchesRoutes, { prefix: "/api/v1" });
});

const validCreate = {
  tmdbId: 42,
  movieTitle: "Test Movie",
  zip: "75078",
  preferences: [
    {
      rank: 1,
      theaterIds: ["theater_1"],
      timeWindows: ["evening"],
      ticketCount: 2,
      maxTicketPriceCents: 2000,
    },
  ],
};

const validArm = {
  acceptedPolicyHash: "a".repeat(64),
  consent: { accepted: true, summary: "Up to $40 total, 2 tickets, Theater 1." },
};

describe("watches routes", () => {
  it("rejects creating a watch with an empty body", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/watches", payload: {} });
    assert.equal(res.statusCode, 400);
  });

  it("rejects duplicate preference ranks", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/watches",
      payload: {
        ...validCreate,
        preferences: [
          { ...validCreate.preferences[0], rank: 1 },
          { ...validCreate.preferences[0], rank: 1 },
        ],
      },
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /distinct/);
  });

  it("rejects a bad ZIP", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/watches",
      payload: { ...validCreate, zip: "7507" },
    });
    assert.equal(res.statusCode, 400);
  });

  it("returns 503 (not 500) for a valid create without a database", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/watches", payload: validCreate });
    assert.equal(res.statusCode, 503);
  });

  it("rejects arming without any consent payload", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/watches/w1/arm", payload: {} });
    assert.equal(res.statusCode, 400);
    assert.match(res.body, /consent/i);
  });

  it("rejects arming with consent.accepted false", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/watches/w1/arm",
      payload: { ...validArm, consent: { accepted: false, summary: "no" } },
    });
    assert.equal(res.statusCode, 400);
  });

  it("rejects arming with a malformed policy hash", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/watches/w1/arm",
      payload: { ...validArm, acceptedPolicyHash: "not-a-hash" },
    });
    assert.equal(res.statusCode, 400);
  });

  it("returns 503 (not 500) for a well-formed arm without a database", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/watches/w1/arm",
      payload: validArm,
    });
    assert.equal(res.statusCode, 503);
  });

  it("rejects patching with an invalid body", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/api/v1/watches/w1",
      payload: { zip: "abc" },
    });
    assert.equal(res.statusCode, 400);
  });
});
