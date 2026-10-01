ALTER TABLE "affiliates" ADD COLUMN "autoPayout" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "affiliates" ADD COLUMN "autoPayoutAllowed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "affiliates" ADD COLUMN "manualPayoutAllowed" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "affiliates" ADD COLUMN "autoPayoutThreshold" numeric;--> statement-breakpoint
ALTER TABLE "affiliates" ADD COLUMN "minPayoutOverride" numeric;--> statement-breakpoint
ALTER TABLE "affiliates" ADD COLUMN "maxPayoutOverride" numeric;--> statement-breakpoint
ALTER TABLE "affiliate_payout_methods" ADD COLUMN "nickname" text;--> statement-breakpoint
ALTER TABLE "affiliate_payout_methods" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "affiliate_payout_methods" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "affiliate_payout_methods" ADD COLUMN "holdUntil" timestamp;--> statement-breakpoint
ALTER TABLE "affiliate_payout_methods" ADD COLUMN "verifiedAt" timestamp;--> statement-breakpoint
ALTER TABLE "affiliate_payout_methods" ADD COLUMN "updatedAt" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "affiliate_payouts" ADD COLUMN "mode" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "affiliate_payouts" ADD COLUMN "fee" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "affiliate_payouts" ADD COLUMN "netAmount" numeric;--> statement-breakpoint
ALTER TABLE "affiliate_payouts" ADD COLUMN "network" text;--> statement-breakpoint
ALTER TABLE "affiliate_payouts" ADD COLUMN "asset" text;--> statement-breakpoint
ALTER TABLE "affiliate_payouts" ADD COLUMN "transactionHash" text;--> statement-breakpoint
ALTER TABLE "affiliate_payouts" ADD COLUMN "heldFrom" text;--> statement-breakpoint
ALTER TABLE "affiliate_payouts" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "affiliate_payouts" ADD COLUMN "approvedBy" text;--> statement-breakpoint
ALTER TABLE "affiliate_payouts" ADD COLUMN "approvedAt" timestamp;--> statement-breakpoint
ALTER TABLE "affiliate_payouts" ADD COLUMN "submittedAt" timestamp;--> statement-breakpoint
ALTER TABLE "affiliate_payouts" ADD COLUMN "completedAt" timestamp;--> statement-breakpoint
ALTER TABLE "affiliate_payouts" ADD COLUMN "failedAt" timestamp;--> statement-breakpoint
ALTER TABLE "affiliate_payouts" ADD COLUMN "lastCheckedAt" timestamp;--> statement-breakpoint
UPDATE "affiliate_payouts" SET "netAmount" = "amount" WHERE "netAmount" IS NULL;--> statement-breakpoint
UPDATE "affiliate_payouts" SET "completedAt" = "processedAt" WHERE "status" = 'paid' AND "completedAt" IS NULL;--> statement-breakpoint
UPDATE "affiliate_payouts" SET "failedAt" = "processedAt" WHERE "status" = 'failed' AND "failedAt" IS NULL;--> statement-breakpoint
UPDATE "affiliate_payout_methods" SET "verifiedAt" = "createdAt" WHERE "status" = 'active' AND "verifiedAt" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_payouts_tx" ON "affiliate_payouts" USING btree ("transactionHash");--> statement-breakpoint
CREATE TABLE "affiliate_payout_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"payoutId" integer NOT NULL,
	"provider" text NOT NULL,
	"providerTransactionId" text,
	"network" text,
	"asset" text,
	"amount" numeric NOT NULL,
	"destination" text NOT NULL,
	"transactionHash" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"failureReason" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"submittedAt" timestamp,
	"confirmedAt" timestamp
);--> statement-breakpoint
CREATE INDEX "affiliate_payout_tx_payout" ON "affiliate_payout_transactions" USING btree ("payoutId");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_payout_tx_hash" ON "affiliate_payout_transactions" USING btree ("transactionHash");--> statement-breakpoint
CREATE TABLE "affiliate_payout_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"affiliateId" integer NOT NULL,
	"payoutId" integer,
	"methodId" integer,
	"actorType" text NOT NULL,
	"actorId" text,
	"action" text NOT NULL,
	"previous" jsonb,
	"next" jsonb,
	"reason" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "affiliate_payout_events_affiliate" ON "affiliate_payout_events" USING btree ("affiliateId","createdAt");--> statement-breakpoint
CREATE INDEX "affiliate_payout_events_payout" ON "affiliate_payout_events" USING btree ("payoutId");
