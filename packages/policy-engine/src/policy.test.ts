import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  enforceGlobalCaps,
  mintPolicy,
  policyHash,
  policyTermsHash,
  signPolicy,
  verifyPolicySignature,
  PolicyError,
  PolicySigningNotConfiguredError,
  MAX_TXN_CENTS,
} from "./policy.js";

const SECRET = "test-signing-secret";
const baseInput = {
  watchId: "watch_1",
  userId: "user_1",
  tmdbId: 42,
  preferences: [
    { maxTicketPriceCents: 2000, ticketCount: 2, theaterIds: ["t1", "t2"] },
    { maxTicketPriceCents: 2500, ticketCount: 2, theaterIds: ["t2", "t3"] },
  ],
  expiresAt: "2027-01-01T00:00:00.000Z",
};

describe("policy engine", () => {
  it("mints a verifiable policy", () => {
    const { document, signature } = mintPolicy(baseInput, SECRET);
    assert.equal(document.version, 1);
    assert.equal(document.maxTicketPriceCents, 2500, "takes the max across preferences");
    assert.equal(document.maxTotalCents, 5000);
    assert.equal(document.maxTickets, 2);
    assert.deepEqual(document.allowedTheaterIds, ["t1", "t2", "t3"], "dedupes theaters");
    assert.equal(verifyPolicySignature(document, signature, SECRET), true);
  });

  it("detects tampering", () => {
    const { document, signature } = mintPolicy(baseInput, SECRET);
    const tampered = { ...document, maxTotalCents: document.maxTotalCents + 100 };
    assert.equal(verifyPolicySignature(tampered, signature, SECRET), false);
  });

  it("rejects a wrong secret", () => {
    const { document, signature } = mintPolicy(baseInput, SECRET);
    assert.equal(verifyPolicySignature(document, signature, "other-secret"), false);
  });

  it("rejects malformed signatures", () => {
    const { document } = mintPolicy(baseInput, SECRET);
    assert.equal(verifyPolicySignature(document, "not-hex", SECRET), false);
    assert.equal(verifyPolicySignature(document, "", SECRET), false);
  });

  it("policyHash is stable for the same document", () => {
    const a = mintPolicy(baseInput, SECRET).document;
    const b = mintPolicy(baseInput, SECRET).document;
    // issuedAt differs, so strip it for the stability check
    const { issuedAt: _a, ...ra } = a;
    const { issuedAt: _b, ...rb } = b;
    assert.equal(policyHash({ ...ra, issuedAt: a.issuedAt }), policyHash({ ...rb, issuedAt: a.issuedAt }));
    assert.match(policyHash(a), /^[0-9a-f]{64}$/);
  });

  it("enforces the per-transaction hard cap", () => {
    assert.throws(
      () =>
        mintPolicy(
          {
            ...baseInput,
            preferences: [{ maxTicketPriceCents: MAX_TXN_CENTS + 1, ticketCount: 1, theaterIds: ["t1"] }],
          },
          SECRET,
        ),
      PolicyError,
    );
  });

  it("fail-closes on empty preferences", () => {
    assert.throws(() => mintPolicy({ ...baseInput, preferences: [] }, SECRET), PolicyError);
  });

  it("fail-closes on no theaters", () => {
    assert.throws(
      () =>
        mintPolicy(
          { ...baseInput, preferences: [{ maxTicketPriceCents: 1000, ticketCount: 2, theaterIds: [] }] },
          SECRET,
        ),
      PolicyError,
    );
  });

  it("fail-closes when the signing secret is missing", () => {
    const env = { ...process.env };
    delete env.POLICY_SIGNING_SECRET;
    const orig = process.env;
    process.env = env as NodeJS.ProcessEnv;
    try {
      assert.throws(() => mintPolicy(baseInput), PolicySigningNotConfiguredError);
      assert.throws(() => signPolicy(mintPolicy(baseInput, SECRET).document), PolicySigningNotConfiguredError);
    } finally {
      process.env = orig;
    }
  });

  it("policyTermsHash is stable across re-mints (ignores issuedAt)", () => {
    const a = mintPolicy(baseInput, SECRET).document;
    // simulate a later re-mint: same terms, different issuedAt
    const b = { ...a, issuedAt: "2030-05-05T00:00:00.000Z" };
    assert.equal(policyTermsHash(a), policyTermsHash(b));
    assert.notEqual(policyHash(a), policyHash(b), "full hash still binds issuedAt");
  });

  it("enforceGlobalCaps rejects over-cap documents", () => {
    const { document } = mintPolicy(baseInput, SECRET);
    assert.doesNotThrow(() => enforceGlobalCaps(document));
    assert.throws(
      () => enforceGlobalCaps({ ...document, maxTotalCents: MAX_TXN_CENTS + 1 }),
      PolicyError,
    );
  });
});
