import fp from "fastify-plugin";
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from "jose";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthContext } from "@moviewatch/contracts";
import { getPrisma } from "@moviewatch/database";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext;
  }
}

interface AuthPluginOptions {
  jwksUrl: string;
  issuer: string;
  clerkSecretKey: string;
}

export interface VerifiedClaims {
  clerkUserId: string;
  /** May be undefined — Clerk session tokens don't include email by default. */
  email?: string;
}

/**
 * Fetch the user's primary email from Clerk's Backend API.
 * Session tokens don't include email by default (requires dashboard config),
 * so we look it up via the Backend API using the verified user ID.
 */
async function fetchClerkEmail(
  clerkUserId: string,
  secretKey: string,
): Promise<string | undefined> {
  try {
    const res = await fetch(`https://api.clerk.com/v1/users/${clerkUserId}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      email_addresses?: Array<{ id: string; email_address: string }>;
      primary_email_address_id?: string;
    };
    const primary = data.email_addresses?.find(
      (e) => e.id === data.primary_email_address_id,
    );
    return primary?.email_address ?? data.email_addresses?.[0]?.email_address;
  } catch {
    return undefined;
  }
}

/**
 * Pure JWT verifier — split out so it can be unit-tested with a local
 * key set (see auth.test.ts). Rejects: bad signature, expiry, wrong issuer,
 * missing sub claim. Email is optional (fetched via Backend API if absent).
 */
export function createTokenVerifier(opts: {
  issuer: string;
  jwksUrl?: string;
  localJwks?: ReturnType<typeof createLocalJWKSet>;
}) {
  const jwks =
    opts.localJwks ?? createRemoteJWKSet(new URL(opts.jwksUrl ?? ""));

  return async function verify(token: string): Promise<VerifiedClaims> {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, jwks, { issuer: opts.issuer }));
    } catch {
      throw Object.assign(new Error("Invalid or expired token"), { statusCode: 401 });
    }

    const clerkUserId = payload.sub;
    const email = typeof payload.email === "string" ? payload.email : undefined;
    if (!clerkUserId) {
      throw Object.assign(new Error("Token missing sub claim"), { statusCode: 401 });
    }
    return { clerkUserId, email };
  };
}

/**
 * Verifies the Clerk session JWT (RS256 via the Clerk JWKS endpoint) and
 * attaches an AuthContext. On first sight of a Clerk user we upsert the
 * local User row — the local id is what every other table references.
 *
 * Every protected route MUST re-check resource ownership
 * (e.g. watch.userId === request.auth.userId); this plugin only proves
 * *who* the caller is, not what they may touch.
 */
/**
 * Wrapped in fastify-plugin (no encapsulation) so the onRequest hook applies
 * to every route in the registering context — i.e. all protected routes —
 * while public routes registered outside that context stay open.
 */
export const authPlugin = fp(
  async function authPlugin(app: FastifyInstance, opts: AuthPluginOptions) {
    const verify = createTokenVerifier({ issuer: opts.issuer, jwksUrl: opts.jwksUrl });

    app.addHook("onRequest", async (request: FastifyRequest) => {
      const header = request.headers.authorization;
      if (!header?.startsWith("Bearer ")) {
        throw Object.assign(new Error("Missing bearer token"), { statusCode: 401 });
      }
      const token = header.slice("Bearer ".length);
      const { clerkUserId, email: tokenEmail } = await verify(token);

      // Token may not include email (requires Clerk dashboard config);
      // fall back to Clerk Backend API lookup.
      let email = tokenEmail;
      if (!email) {
        email = await fetchClerkEmail(clerkUserId, opts.clerkSecretKey);
      }
      if (!email) {
        throw Object.assign(new Error("Could not determine user email"), { statusCode: 401 });
      }

      const user = await getPrisma().user.upsert({
        where: { clerkUserId },
        update: { email },
        create: { clerkUserId, email },
        select: { id: true, clerkUserId: true, email: true },
      });

      request.auth = { userId: user.id, clerkUserId: user.clerkUserId, email: user.email };
    });
  },
  { name: "moviewatch-auth" },
);
