-- PropFirm Max: a normalized, versioned, sourced prop-firm rule catalog that
-- feeds the config-driven rule engine (lib/propmax/*). It lives ALONGSIDE the
-- existing prop_firm_rules table (migration 0006) — the old /propfirm tracker
-- is untouched; the new /propfirm-max page reads this set.
--
-- Chain: prop_firm -> prop_program -> prop_rule_version (dated, sourced,
-- engine-ready rules JSONB). A user's account binds to one firm/program and is
-- pinned to a specific rule_version (prop_account). prop_snapshot is daily
-- history; prop_alert is fired threshold crossings.

CREATE TABLE "prop_firm" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"assetClass" text DEFAULT 'futures' NOT NULL,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "prop_firm_slug" ON "prop_firm" USING btree ("slug");--> statement-breakpoint

CREATE TABLE "prop_program" (
	"id" serial PRIMARY KEY NOT NULL,
	"firmId" integer NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"assetClass" text DEFAULT 'futures' NOT NULL,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "prop_program_firm_slug" ON "prop_program" USING btree ("firmId","slug");--> statement-breakpoint
CREATE INDEX "prop_program_firm" ON "prop_program" USING btree ("firmId");--> statement-breakpoint

CREATE TABLE "prop_rule_version" (
	"id" serial PRIMARY KEY NOT NULL,
	"programId" integer NOT NULL,
	"accountSize" integer,
	"phase" text DEFAULT 'evaluation' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"rules" jsonb NOT NULL,
	"sourceName" text NOT NULL,
	"sourceUrl" text,
	"sourceType" text DEFAULT 'official_rules' NOT NULL,
	"confidence" text DEFAULT 'medium' NOT NULL,
	"verifiedAt" timestamp,
	"effectiveFrom" timestamp DEFAULT now() NOT NULL,
	"effectiveTo" timestamp,
	"changeReason" text,
	"caveat" text,
	"createdBy" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "prop_rule_version_program" ON "prop_rule_version" USING btree ("programId");--> statement-breakpoint
CREATE INDEX "prop_rule_version_lookup" ON "prop_rule_version" USING btree ("programId","accountSize","phase","effectiveTo");--> statement-breakpoint

CREATE TABLE "prop_account" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"accountId" integer NOT NULL,
	"firmId" integer,
	"programId" integer,
	"ruleVersionId" integer,
	"accountSize" integer,
	"phase" text DEFAULT 'evaluation' NOT NULL,
	"detectionSource" text DEFAULT 'manual' NOT NULL,
	"detectionConfidence" text DEFAULT 'high' NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"openingBalanceAdjustment" numeric(18, 2),
	"breachReasonTag" text,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "prop_account_account" ON "prop_account" USING btree ("accountId");--> statement-breakpoint
CREATE INDEX "prop_account_user" ON "prop_account" USING btree ("userId");--> statement-breakpoint

CREATE TABLE "prop_snapshot" (
	"id" serial PRIMARY KEY NOT NULL,
	"propAccountId" integer NOT NULL,
	"userId" text NOT NULL,
	"date" text NOT NULL,
	"balance" numeric(18, 2),
	"equity" numeric(18, 2),
	"highWaterMark" numeric(18, 2),
	"riskStatus" text,
	"evaluation" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "prop_snapshot_account_date" ON "prop_snapshot" USING btree ("propAccountId","date");--> statement-breakpoint
CREATE INDEX "prop_snapshot_user" ON "prop_snapshot" USING btree ("userId");--> statement-breakpoint

CREATE TABLE "prop_alert" (
	"id" serial PRIMARY KEY NOT NULL,
	"propAccountId" integer NOT NULL,
	"userId" text NOT NULL,
	"ruleType" text,
	"status" text NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"percentageUsed" numeric(6, 2),
	"dedupeKey" text NOT NULL,
	"acknowledgedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "prop_alert_dedupe" ON "prop_alert" USING btree ("dedupeKey");--> statement-breakpoint
CREATE INDEX "prop_alert_account" ON "prop_alert" USING btree ("propAccountId");--> statement-breakpoint
CREATE INDEX "prop_alert_user_unack" ON "prop_alert" USING btree ("userId","acknowledgedAt");--> statement-breakpoint

-- RLS on, like every table. The app connects as the table owner (bypasses
-- RLS); the VPS sync worker / evaluation cron runs as tradeloop_sync and gets
-- exactly the access it needs: READ the catalog + bindings to evaluate an
-- account, WRITE snapshots/alerts, and UPDATE an account's status on breach.
ALTER TABLE "prop_firm" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prop_program" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prop_rule_version" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prop_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prop_snapshot" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prop_alert" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tradeloop_sync') THEN
    -- Catalog + bindings: read-only for the worker.
    GRANT SELECT ON "prop_firm" TO tradeloop_sync;
    GRANT SELECT ON "prop_program" TO tradeloop_sync;
    GRANT SELECT ON "prop_rule_version" TO tradeloop_sync;
    CREATE POLICY tradeloop_sync_read ON "prop_firm" FOR SELECT TO tradeloop_sync USING (true);
    CREATE POLICY tradeloop_sync_read ON "prop_program" FOR SELECT TO tradeloop_sync USING (true);
    CREATE POLICY tradeloop_sync_read ON "prop_rule_version" FOR SELECT TO tradeloop_sync USING (true);
    -- Bindings: read + update status/phase on a breach.
    GRANT SELECT, UPDATE ON "prop_account" TO tradeloop_sync;
    CREATE POLICY tradeloop_sync_rw ON "prop_account" FOR ALL TO tradeloop_sync USING (true) WITH CHECK (true);
    -- Snapshots + alerts: the worker writes these every sync.
    GRANT SELECT, INSERT, UPDATE, DELETE ON "prop_snapshot" TO tradeloop_sync;
    GRANT USAGE, SELECT ON SEQUENCE "prop_snapshot_id_seq" TO tradeloop_sync;
    CREATE POLICY tradeloop_sync_all ON "prop_snapshot" FOR ALL TO tradeloop_sync USING (true) WITH CHECK (true);
    GRANT SELECT, INSERT, UPDATE, DELETE ON "prop_alert" TO tradeloop_sync;
    GRANT USAGE, SELECT ON SEQUENCE "prop_alert_id_seq" TO tradeloop_sync;
    CREATE POLICY tradeloop_sync_all ON "prop_alert" FOR ALL TO tradeloop_sync USING (true) WITH CHECK (true);
  END IF;
END $$;
