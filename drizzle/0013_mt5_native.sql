-- MetaTrader moves off MetaApi onto our own MT5 terminals on the sync VPS
-- (worker/mt5). There were no MetaApi connections to carry over, and a leftover
-- row couldn't sync without MetaApi anyway, so any are cleared.
DELETE FROM "metatrader_connections";--> statement-breakpoint
ALTER TABLE "metatrader_connections" DROP COLUMN "metaApiAccountId";--> statement-breakpoint
ALTER TABLE "metatrader_connections" DROP COLUMN "tokenEnc";--> statement-breakpoint
ALTER TABLE "metatrader_connections" DROP COLUMN "tokenExpiresAt";--> statement-breakpoint
ALTER TABLE "metatrader_connections" DROP COLUMN "lastSyncFrom";--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN "passwordEnc" text NOT NULL;--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN "statusMessage" text;--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN "historyFrom" timestamp;--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN "brokerName" text;--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN "holderName" text;--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN "balance" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN "equity" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN "openPositions" integer;--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN "serverTimeZone" text;--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN "nextSyncAt" timestamp;--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN "leaseUntil" timestamp;--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN "errorCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN "lastDealTime" timestamp;--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN "dealsChangedAt" timestamp;--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN "normalizedAt" timestamp;--> statement-breakpoint
CREATE TABLE "metatrader_deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"connectionId" integer NOT NULL,
	"ticket" text NOT NULL,
	"orderTicket" text,
	"positionId" text,
	"time" timestamp (3) NOT NULL,
	"type" integer NOT NULL,
	"entry" integer NOT NULL,
	"symbol" text,
	"volume" numeric(18, 4) DEFAULT '0' NOT NULL,
	"price" numeric(18, 6) DEFAULT '0' NOT NULL,
	"profit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"commission" numeric(18, 2) DEFAULT '0' NOT NULL,
	"swap" numeric(18, 2) DEFAULT '0' NOT NULL,
	"fee" numeric(18, 2) DEFAULT '0' NOT NULL,
	"stopLoss" numeric(18, 6),
	"takeProfit" numeric(18, 6),
	"raw" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "metatrader_deals_connection_ticket" ON "metatrader_deals" USING btree ("connectionId","ticket");--> statement-breakpoint
CREATE INDEX "metatrader_deals_connection_position" ON "metatrader_deals" USING btree ("connectionId","positionId");--> statement-breakpoint
CREATE INDEX "metatrader_deals_connection_created" ON "metatrader_deals" USING btree ("connectionId","createdAt");--> statement-breakpoint
-- Same posture as the other tables (0000_init): RLS on, so Supabase's public
-- API roles see nothing. The sync VPS's own login (tradeloop_sync) gets an
-- explicit policy; skipped where that role doesn't exist (local dev).
ALTER TABLE "metatrader_deals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tradeloop_sync') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "metatrader_deals" TO tradeloop_sync;
    GRANT USAGE, SELECT ON SEQUENCE "metatrader_deals_id_seq" TO tradeloop_sync;
    CREATE POLICY tradeloop_sync_all ON "metatrader_deals" FOR ALL TO tradeloop_sync USING (true) WITH CHECK (true);
  END IF;
END $$;
