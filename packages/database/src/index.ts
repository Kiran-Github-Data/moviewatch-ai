import { PrismaClient } from "@prisma/client";

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not set. Provision a Postgres database (e.g. Neon) to enable persistence.");
    this.name = "DatabaseNotConfiguredError";
  }
}

let cached: PrismaClient | undefined;

/**
 * Lazy Prisma singleton. Throws DatabaseNotConfiguredError when
 * DATABASE_URL is missing so routes can degrade gracefully (503)
 * instead of crashing the process at import time.
 */
export function getPrisma(): PrismaClient {
  if (!process.env.DATABASE_URL) throw new DatabaseNotConfiguredError();
  cached ??= new PrismaClient({ log: ["warn", "error"] });
  return cached;
}

export * from "@prisma/client";
