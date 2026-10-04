-- Milestone 4: per-dimension ranked preferences.
-- Replaces the two-row (rank 1|2) outing model with one row per watch
-- carrying first-choice (rank 1) and backup (rank 2) per dimension.

-- Drop the old composite unique constraint
DROP INDEX IF EXISTS "BookingPreference_watchId_rank_key";

-- Drop old columns
ALTER TABLE "BookingPreference"
  DROP COLUMN IF EXISTS "rank",
  DROP COLUMN IF EXISTS "theaterIds",
  DROP COLUMN IF EXISTS "daysOfWeek",
  DROP COLUMN IF EXISTS "timeWindows",
  DROP COLUMN IF EXISTS "formats";

-- Add ranked dimension columns
ALTER TABLE "BookingPreference"
  ADD COLUMN "theatersRank1" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "theatersRank2" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "daysRank1" INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN "daysRank2" INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN "timeWindowsRank1" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "timeWindowsRank2" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "formatsRank1" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "formatsRank2" TEXT[] NOT NULL DEFAULT '{}';

-- One preference row per watch
CREATE UNIQUE INDEX "BookingPreference_watchId_key" ON "BookingPreference"("watchId");
