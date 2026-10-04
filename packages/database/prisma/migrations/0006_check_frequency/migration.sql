-- User-configurable monitoring schedule per watch.
ALTER TABLE "MovieWatch" ADD COLUMN "checkFrequency" TEXT NOT NULL DEFAULT 'every_15_min';
ALTER TABLE "MovieWatch" ADD COLUMN "lastCheckedAt" TIMESTAMP(3);
