-- Tradovate logins synced through NinjaTrader on the VPS (lib/ninjatrader,
-- worker/ninjatrader, docs/integrations/ninjatrader.md): the same idea as an
-- MT5 connection with a stored, encrypted password, but the "terminal" is
-- NinjaTrader — a Tradovate-sanctioned connection. The fills it relays land in
-- the provider_* tables (migration 0014) under the user's "ninjatrader"
-- trading_connection.
CREATE TABLE "ninjatrader_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"username" text NOT NULL,
	"passwordEnc" text NOT NULL,
	"connectionKind" text NOT NULL,
	"ntConnectionName" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"statusMessage" text,
	"nextSyncAt" timestamp,
	"leaseUntil" timestamp,
	"errorCount" integer DEFAULT 0 NOT NULL,
	"lastSeenAt" timestamp,
	"lastFillAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ninjatrader_connections_name" ON "ninjatrader_connections" USING btree ("ntConnectionName");--> statement-breakpoint
CREATE INDEX "ninjatrader_connections_user" ON "ninjatrader_connections" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "ninjatrader_connections_due" ON "ninjatrader_connections" USING btree ("status","nextSyncAt");--> statement-breakpoint
-- RLS on, like every table. The VPS worker's role (tradeloop_sync) gets an
-- explicit policy — it reads the encrypted password to provision NinjaTrader.
ALTER TABLE "ninjatrader_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tradeloop_sync') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ninjatrader_connections" TO tradeloop_sync;
    GRANT USAGE, SELECT ON SEQUENCE "ninjatrader_connections_id_seq" TO tradeloop_sync;
    CREATE POLICY tradeloop_sync_all ON "ninjatrader_connections" FOR ALL TO tradeloop_sync USING (true) WITH CHECK (true);
  END IF;
END $$;
