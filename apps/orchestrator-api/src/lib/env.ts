import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CLERK_JWKS_URL: z.string().url(),
  CLERK_ISSUER: z.string().url(),
  // Clerk secret key — used to fetch user email from Clerk Backend API
  // (session tokens don't include email by default).
  CLERK_SECRET_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  // TMDB (Milestone 2). v4 read-access token preferred; v3 API key also works.
  // Optional at boot — /movies endpoints return 503 until configured.
  TMDB_READ_ACCESS_TOKEN: z.string().min(1).optional(),
  TMDB_API_KEY: z.string().min(1).optional(),
  // Policy signing (Milestone 3). Required to arm watches.
  POLICY_SIGNING_SECRET: z.string().min(32, "use at least 32 characters"),
  // Email (Milestone 5). Optional at boot — notifications are skipped
  // (best-effort) until configured.
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  // Stripe (Milestone 5). Optional at boot — payment endpoints return 503
  // until configured. Never log these values (see logger redaction).
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  // LangGraph deep agent (Milestone 6). Optional at boot — the agent
  // scheduler logs a warning and idles when unset. Never log this value.
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  AGENT_MODEL: z.string().min(1).optional(),
  AGENT_CRON: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n  ${issues.join("\n  ")}`);
  }
  return parsed.data;
}
