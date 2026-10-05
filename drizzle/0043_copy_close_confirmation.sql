-- Copy Trading, live mode: a follower's position is closed when its broker
-- says so, not when a close was sent. The position remembers that a close is
-- wanted, and how many times it has been tried.
ALTER TABLE "copy_positions" ADD COLUMN IF NOT EXISTS "closeRequestedAt" timestamp;
--> statement-breakpoint
ALTER TABLE "copy_positions" ADD COLUMN IF NOT EXISTS "closeAttempts" integer DEFAULT 0 NOT NULL;
