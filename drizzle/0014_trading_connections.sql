-- Provider-neutral broker connections (Tradovate first; see lib/providers,
-- lib/tradovate and docs/integrations/tradovate.md): OAuth connections with
-- encrypted tokens, and the raw accounts / orders / executions / positions
-- each provider reports, idempotent by the provider's own ids.
CREATE TABLE "trading_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"providerUserId" text NOT NULL,
	"providerUserName" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"statusMessage" text,
	"syncStage" text,
	"accessTokenEnc" text,
	"refreshTokenEnc" text,
	"tokenExpiresAt" timestamp,
	"refreshExpiresAt" timestamp,
	"realtimeStatus" text DEFAULT 'offline' NOT NULL,
	"lastRealtimeEventAt" timestamp,
	"lastSyncAt" timestamp,
	"lastSyncStatus" text,
	"lastSyncError" text,
	"lastReconciledAt" timestamp,
	"lastReconcileSummary" jsonb,
	"errorCount" integer DEFAULT 0 NOT NULL,
	"nextSyncAt" timestamp,
	"leaseUntil" timestamp,
	"lastManualSyncAt" timestamp,
	"tradesDirtyAt" timestamp,
	"tradesBuiltAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"connectionId" integer NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"accountName" text NOT NULL,
	"accountType" text,
	"currency" text DEFAULT 'USD' NOT NULL,
	"balance" numeric(18, 2),
	"equity" numeric(18, 2),
	"availableMargin" numeric(18, 2),
	"status" text DEFAULT 'active' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"tradingAccountId" integer,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"connectionId" integer NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"providerOrderId" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"symbol" text,
	"contractId" text,
	"side" text,
	"quantity" numeric(18, 4),
	"orderType" text,
	"limitPrice" numeric(18, 6),
	"stopPrice" numeric(18, 6),
	"status" text,
	"submittedAt" timestamp (3),
	"rawData" jsonb,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"connectionId" integer NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"idempotencyKey" text NOT NULL,
	"providerExecutionId" text,
	"providerOrderId" text,
	"providerAccountId" text NOT NULL,
	"symbol" text NOT NULL,
	"contractMonth" text,
	"assetClass" text DEFAULT 'future' NOT NULL,
	"side" text NOT NULL,
	"quantity" numeric(18, 4) NOT NULL,
	"price" numeric(18, 6) NOT NULL,
	"pointValue" numeric(18, 4),
	"timestamp" timestamp (3) NOT NULL,
	"commission" numeric(18, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"rawData" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"connectionId" integer NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"contractId" text NOT NULL,
	"symbol" text,
	"netQuantity" numeric(18, 4) NOT NULL,
	"averagePrice" numeric(18, 6),
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trading_connections_user_provider_identity" ON "trading_connections" USING btree ("userId","provider","environment","providerUserId");--> statement-breakpoint
CREATE INDEX "trading_connections_due" ON "trading_connections" USING btree ("provider","status","nextSyncAt");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_accounts_identity" ON "provider_accounts" USING btree ("connectionId","environment","providerAccountId");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_orders_identity" ON "provider_orders" USING btree ("connectionId","environment","providerOrderId");--> statement-breakpoint
CREATE INDEX "provider_orders_account" ON "provider_orders" USING btree ("connectionId","environment","providerAccountId");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_executions_identity" ON "provider_executions" USING btree ("connectionId","idempotencyKey");--> statement-breakpoint
CREATE INDEX "provider_executions_account" ON "provider_executions" USING btree ("connectionId","environment","providerAccountId","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_positions_identity" ON "provider_positions" USING btree ("connectionId","environment","providerAccountId","contractId");--> statement-breakpoint
-- Same posture as every other table: RLS on, so Supabase's public API roles
-- see nothing; the sync VPS's own login (tradeloop_sync) gets an explicit
-- policy. Skipped where that role doesn't exist (local dev).
ALTER TABLE "trading_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provider_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provider_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provider_executions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "provider_positions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tradeloop_sync') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "trading_connections" TO tradeloop_sync;
    GRANT USAGE, SELECT ON SEQUENCE "trading_connections_id_seq" TO tradeloop_sync;
    CREATE POLICY tradeloop_sync_all ON "trading_connections" FOR ALL TO tradeloop_sync USING (true) WITH CHECK (true);
    GRANT SELECT, INSERT, UPDATE, DELETE ON "provider_accounts" TO tradeloop_sync;
    GRANT USAGE, SELECT ON SEQUENCE "provider_accounts_id_seq" TO tradeloop_sync;
    CREATE POLICY tradeloop_sync_all ON "provider_accounts" FOR ALL TO tradeloop_sync USING (true) WITH CHECK (true);
    GRANT SELECT, INSERT, UPDATE, DELETE ON "provider_orders" TO tradeloop_sync;
    GRANT USAGE, SELECT ON SEQUENCE "provider_orders_id_seq" TO tradeloop_sync;
    CREATE POLICY tradeloop_sync_all ON "provider_orders" FOR ALL TO tradeloop_sync USING (true) WITH CHECK (true);
    GRANT SELECT, INSERT, UPDATE, DELETE ON "provider_executions" TO tradeloop_sync;
    GRANT USAGE, SELECT ON SEQUENCE "provider_executions_id_seq" TO tradeloop_sync;
    CREATE POLICY tradeloop_sync_all ON "provider_executions" FOR ALL TO tradeloop_sync USING (true) WITH CHECK (true);
    GRANT SELECT, INSERT, UPDATE, DELETE ON "provider_positions" TO tradeloop_sync;
    GRANT USAGE, SELECT ON SEQUENCE "provider_positions_id_seq" TO tradeloop_sync;
    CREATE POLICY tradeloop_sync_all ON "provider_positions" FOR ALL TO tradeloop_sync USING (true) WITH CHECK (true);
  END IF;
END $$;
