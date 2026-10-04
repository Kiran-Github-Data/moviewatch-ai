import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";
import { createTokenVerifier } from "./auth.js";

const ISSUER = "https://test.clerk.accounts.dev";

async function makeVerifier() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const localJwks = createLocalJWKSet({ keys: [{ ...jwk, kid: "test-key" }] });
  const verify = createTokenVerifier({ issuer: ISSUER, localJwks });

  async function sign(claims: Record<string, unknown>, kid = "test-key") {
    return await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  }
  return { verify, sign, privateKey };
}

describe("createTokenVerifier", () => {
  it("accepts a valid token", async () => {
    const { verify, sign } = await makeVerifier();
    const token = await sign({ sub: "user_123", email: "a@b.com" });
    const claims = await verify(token);
    assert.equal(claims.clerkUserId, "user_123");
    assert.equal(claims.email, "a@b.com");
  });

  it("rejects an expired token", async () => {
    const { verify, privateKey } = await makeVerifier();
    const token = await new SignJWT({ sub: "user_123", email: "a@b.com" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime("-1m")
      .sign(privateKey);
    await assert.rejects(() => verify(token), /Invalid or expired token/);
  });

  it("rejects a token with the wrong issuer", async () => {
    const { verify, privateKey } = await makeVerifier();
    const token = await new SignJWT({ sub: "user_123", email: "a@b.com" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://evil.example.com")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    await assert.rejects(() => verify(token), /Invalid or expired token/);
  });

  it("rejects a token signed by an unknown key", async () => {
    const { verify } = await makeVerifier();
    const { privateKey: other } = await generateKeyPair("RS256");
    const token = await new SignJWT({ sub: "user_123", email: "a@b.com" })
      .setProtectedHeader({ alg: "RS256", kid: "other-key" })
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(other);
    await assert.rejects(() => verify(token), /Invalid or expired token/);
  });

  it("accepts a token missing the email claim (email fetched via Backend API)", async () => {
    const { verify, sign } = await makeVerifier();
    const token = await sign({ sub: "user_123" });
    const claims = await verify(token);
    assert.equal(claims.clerkUserId, "user_123");
    assert.equal(claims.email, undefined);
  });

  it("rejects garbage", async () => {
    const { verify } = await makeVerifier();
    await assert.rejects(() => verify("not.a.jwt"), /Invalid or expired token/);
  });
});
