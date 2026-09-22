ALTER TABLE "trades" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "backtestSessionId" integer;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backtest_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text,
	"symbol" text NOT NULL,
	"market" text DEFAULT 'futures' NOT NULL,
	"provider" text DEFAULT 'yahoo' NOT NULL,
	"timeframe" text DEFAULT '5m' NOT NULL,
	"executionTimeframe" text DEFAULT '5m' NOT NULL,
	"rangeStart" timestamp NOT NULL,
	"rangeEnd" timestamp NOT NULL,
	"currentTime" timestamp NOT NULL,
	"startingBalance" numeric(18, 2) DEFAULT '50000' NOT NULL,
	"currentBalance" numeric(18, 2) DEFAULT '50000' NOT NULL,
	"speed" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"randomMode" boolean DEFAULT false NOT NULL,
	"accountId" integer,
	"simulatePropRules" boolean DEFAULT false NOT NULL,
	"openOrders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"openPosition" jsonb,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
