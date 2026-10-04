import type { FastifyInstance } from "fastify";
import { authPlugin } from "../plugins/auth.js";
import { watchesRoutes } from "./watches.js";
import { paymentsRoutes } from "./payments.js";

interface ProtectedRoutesOptions {
  jwksUrl: string;
  issuer: string;
  clerkSecretKey: string;
}

/**
 * All routes in this plugin require a verified Clerk JWT. Fastify
 * encapsulation means the auth onRequest hook applies to every route
 * registered here — and to nothing outside it (e.g. /health stays public).
 */
export async function protectedRoutes(app: FastifyInstance, opts: ProtectedRoutesOptions) {
  await app.register(authPlugin, {
    jwksUrl: opts.jwksUrl,
    issuer: opts.issuer,
    clerkSecretKey: opts.clerkSecretKey,
  });

  // Authenticated probe: proves JWT verification + user upsert work.
  app.get("/me", async (request) => ({ user: request.auth }));

  // Milestone 3: watch lifecycle (auth hook from authPlugin applies here too).
  await app.register(watchesRoutes);

  // Milestone 5: saved cards for auto-booking.
  await app.register(paymentsRoutes);

  // Milestones 4+: provider-accounts, …
}
