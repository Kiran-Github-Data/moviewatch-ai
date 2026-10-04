import "dotenv/config";
import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { loadEnv } from "./lib/env.js";
import { notFound, sendError } from "./lib/errors.js";
import { healthRoutes } from "./routes/health.js";
import { moviesRoutes } from "./routes/movies.js";
import { theatersRoutes } from "./routes/theaters.js";
import { protectedRoutes } from "./routes/protected.js";
import { paymentsWebhookRoutes } from "./routes/payments.js";
import { DatabaseNotConfiguredError } from "@moviewatch/database";
import { TmdbNotConfiguredError } from "@moviewatch/tmdb";

const env = loadEnv();

const app = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
    // Redaction is enforced at emit time. Field list grows with the schema —
    // credential/session material must NEVER reach logs (PLAN.md §7).
    redact: {
      paths: [
        "req.headers.authorization",
        "*.password",
        "*.cookie",
        "*.session",
        "*.client_secret",
        "*.payment_method",
      ],
      censor: "[REDACTED]",
    },
  },
});

await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, { origin: [env.WEB_ORIGIN], credentials: false });
await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

// Public
await app.register(healthRoutes, { prefix: "/api/v1" });
await app.register(moviesRoutes, { prefix: "/api/v1" });
await app.register(theatersRoutes, { prefix: "/api/v1" });
// Stripe webhook is public but signature-verified (fail closed without secret).
await app.register(paymentsWebhookRoutes, { prefix: "/api/v1" });
// Protected (verified Clerk JWT)
await app.register(protectedRoutes, {
  prefix: "/api/v1",
  jwksUrl: env.CLERK_JWKS_URL,
  issuer: env.CLERK_ISSUER,
  clerkSecretKey: env.CLERK_SECRET_KEY,
});

app.setNotFoundHandler(notFound);
app.setErrorHandler((err: FastifyError, _request, reply) => {
  if (err instanceof DatabaseNotConfiguredError || err instanceof TmdbNotConfiguredError) {
    return sendError(reply, 503, err.message);
  }
  const status = typeof err.statusCode === "number" ? err.statusCode : 500;
  if (status >= 500) {
    app.log.error(err);
  }
  return sendError(reply, status, status === 500 ? "Internal server error" : err.message);
});

await app.listen({ port: env.PORT, host: "0.0.0.0" });
