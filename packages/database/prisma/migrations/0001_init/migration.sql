-- Baseline migration: foundation entities (Milestones 1–2).
-- Applied with: pnpm --filter @moviewatch/database exec prisma migrate deploy
-- (requires DATABASE_URL; not yet applied — no database provisioned).

CREATE TABLE "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "clerkUserId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "displayName" TEXT,
  "notifyPush" BOOLEAN NOT NULL DEFAULT true,
  "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
  "notifySms" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_clerkUserId_idx" ON "User"("clerkUserId");

CREATE TABLE "Movie" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tmdbId" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "releaseDate" TIMESTAMPTZ,
  "posterPath" TEXT,
  "backdropPath" TEXT,
  "overview" TEXT,
  "runtime" INTEGER,
  "genres" TEXT[] NOT NULL DEFAULT '{}',
  "trailerKey" TEXT,
  "popularity" DOUBLE PRECISION,
  "voteAverage" DOUBLE PRECISION,
  "detailsJson" TEXT,
  "tmdbCacheExpiresAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "Movie_tmdbId_key" ON "Movie"("tmdbId");
CREATE INDEX "Movie_releaseDate_idx" ON "Movie"("releaseDate");
CREATE INDEX "Movie_popularity_idx" ON "Movie"("popularity");

CREATE TABLE "Theater" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "providerTheaterId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "address" TEXT,
  "city" TEXT,
  "zip" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "Theater_provider_providerTheaterId_key" ON "Theater"("provider", "providerTheaterId");
CREATE INDEX "Theater_zip_idx" ON "Theater"("zip");
