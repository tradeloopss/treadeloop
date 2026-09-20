CREATE TABLE "tradingview_pairings" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"token" text NOT NULL,
	"label" text,
	"extensionVersion" text,
	"lastSeenAt" timestamp,
	"lastSyncAt" timestamp,
	"lastStatus" text,
	"lastError" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tradingview_pairings_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "tradingview_connections" ADD COLUMN "kind" text DEFAULT 'webhook' NOT NULL;--> statement-breakpoint
ALTER TABLE "tradingview_connections" ADD COLUMN "pairingId" integer;--> statement-breakpoint
ALTER TABLE "tradingview_connections" ADD COLUMN "externalAccountId" text;--> statement-breakpoint
ALTER TABLE "tradingview_fills" ADD COLUMN "market" text;
