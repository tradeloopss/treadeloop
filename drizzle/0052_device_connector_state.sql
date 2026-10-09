-- NinjaTrader connector — device state + pairing codes (Phase 1).
--
-- Extends the existing add-on device model (provider_device_keys, migration
-- 0015) in place rather than adding a second device system: a per-install id
-- and OS kept across key rotation, a device lifecycle status, the broker/NT
-- connected flags the add-on can report (null = unknown, never a false
-- "connected"), a last-heartbeat time, pending-queue depth and an error count.
-- Existing rows keep working: `status` is backfilled from what we already know
-- (revoked / seen-before / never-seen) and nothing else changes.
--
-- ninjatrader_pair_codes backs the new "ABC-123" onboarding option. The
-- plaintext code is never stored — only its SHA-256 hash — and a code is
-- single-use (consumedAt) and short-lived (expiresAt). The keyed add-on
-- download still works unchanged; pairing is an additional path.
ALTER TABLE "provider_device_keys" ADD COLUMN IF NOT EXISTS "os" text;--> statement-breakpoint
ALTER TABLE "provider_device_keys" ADD COLUMN IF NOT EXISTS "installationId" text;--> statement-breakpoint
ALTER TABLE "provider_device_keys" ADD COLUMN IF NOT EXISTS "lastHeartbeatAt" timestamp;--> statement-breakpoint
ALTER TABLE "provider_device_keys" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'pairing' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_device_keys" ADD COLUMN IF NOT EXISTS "ntConnected" boolean;--> statement-breakpoint
ALTER TABLE "provider_device_keys" ADD COLUMN IF NOT EXISTS "brokerConnected" boolean;--> statement-breakpoint
ALTER TABLE "provider_device_keys" ADD COLUMN IF NOT EXISTS "queueDepth" integer;--> statement-breakpoint
ALTER TABLE "provider_device_keys" ADD COLUMN IF NOT EXISTS "errorCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- backfill the lifecycle status for rows that existed before this column
UPDATE "provider_device_keys" SET "status" = 'revoked' WHERE "revokedAt" IS NOT NULL;--> statement-breakpoint
UPDATE "provider_device_keys" SET "status" = 'connected' WHERE "revokedAt" IS NULL AND "lastSeenAt" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "provider_device_keys_status" ON "provider_device_keys" USING btree ("provider","status");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ninjatrader_pair_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"codeHash" text NOT NULL,
	"label" text,
	"expiresAt" timestamp NOT NULL,
	"consumedAt" timestamp,
	"deviceKeyId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ninjatrader_pair_codes_hash" ON "ninjatrader_pair_codes" USING btree ("codeHash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ninjatrader_pair_codes_user" ON "ninjatrader_pair_codes" USING btree ("userId");--> statement-breakpoint
-- RLS on, like every other table: Supabase's public API roles see nothing.
-- Only the app reads this table, so the sync VPS role gets no grant.
ALTER TABLE "ninjatrader_pair_codes" ENABLE ROW LEVEL SECURITY;
