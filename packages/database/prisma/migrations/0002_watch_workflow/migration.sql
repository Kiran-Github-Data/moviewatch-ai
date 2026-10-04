-- Milestone 3: watch creation workflow.
-- MovieWatch + BookingPreference + AuditLog.

CREATE TABLE "MovieWatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "tmdbId" INTEGER NOT NULL,
  "movieTitle" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'CREATED',
  "zip" TEXT NOT NULL,
  "armedAt" TIMESTAMPTZ,
  "expiresAt" TIMESTAMPTZ,
  "cadenceMinutes" INTEGER NOT NULL DEFAULT 1440,
  "policyDocument" TEXT,
  "policyVersion" INTEGER NOT NULL DEFAULT 0,
  "policySignature" TEXT,
  "consentRecord" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "MovieWatch_idempotencyKey_key" ON "MovieWatch"("idempotencyKey");
CREATE INDEX "MovieWatch_userId_status_idx" ON "MovieWatch"("userId", "status");
CREATE INDEX "MovieWatch_tmdbId_idx" ON "MovieWatch"("tmdbId");

CREATE TABLE "BookingPreference" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "watchId" TEXT NOT NULL REFERENCES "MovieWatch"("id") ON DELETE CASCADE,
  "rank" INTEGER NOT NULL,
  "theaterIds" TEXT[] NOT NULL DEFAULT '{}',
  "daysOfWeek" INTEGER[] NOT NULL DEFAULT '{}',
  "dateFrom" TIMESTAMPTZ,
  "dateTo" TIMESTAMPTZ,
  "timeWindows" TEXT[] NOT NULL DEFAULT '{}',
  "formats" TEXT[] NOT NULL DEFAULT '{}',
  "ticketCount" INTEGER NOT NULL DEFAULT 2,
  "maxTicketPriceCents" INTEGER NOT NULL,
  "seatRules" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "BookingPreference_watchId_rank_key" ON "BookingPreference"("watchId", "rank");

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "policyVersion" INTEGER,
  "prevHash" TEXT,
  "hash" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");
