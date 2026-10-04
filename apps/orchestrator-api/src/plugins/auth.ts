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
}

export interface VerifiedClaims {
  clerkUserId: string;
  email: string;
}

/**
 * Pure JWT verifier — split out so it can be unit-tested with a local
 * key set (see auth.test.ts). Rejects: bad signature, expiry, wrong issuer,
 * missing sub/email claims.
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
    if (!clerkUserId || !email) {
      throw Object.assign(new Error("Token missing sub/email claims"), { statusCode: 401 });
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
      const { clerkUserId, email } = await verify(token);

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
