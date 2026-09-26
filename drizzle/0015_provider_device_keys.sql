-- Keys for desktop add-ons that post fills to TradeLoop — the NinjaTrader
-- add-on first (lib/ninjatrader, docs/integrations/ninjatrader.md). One row
-- per downloaded add-on; only a SHA-256 hash of the key is stored, and a
-- revoked key stops working at once. The fills themselves go into the
-- provider_* tables (migration 0014) under a "ninjatrader" connection.
CREATE TABLE "provider_device_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"provider" text NOT NULL,
	"keyHash" text NOT NULL,
	"keyHint" text NOT NULL,
	"label" text,
	"clientVersion" text,
	"lastSeenAt" timestamp,
	"lastSyncAt" timestamp,
	"lastStatus" text,
	"lastError" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"revokedAt" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_device_keys_hash" ON "provider_device_keys" USING btree ("keyHash");--> statement-breakpoint
CREATE INDEX "provider_device_keys_user" ON "provider_device_keys" USING btree ("userId","provider");--> statement-breakpoint
-- RLS on, like every other table: Supabase's public API roles see nothing.
-- Only the app reads this table, so the sync VPS role gets no grant.
ALTER TABLE "provider_device_keys" ENABLE ROW LEVEL SECURITY;
