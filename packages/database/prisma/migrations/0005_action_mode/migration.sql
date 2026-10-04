-- Add actionMode to MovieWatch: "notify" (email alert) vs "autobook" (auto-purchase)
ALTER TABLE "MovieWatch" ADD COLUMN "actionMode" TEXT NOT NULL DEFAULT 'notify';
