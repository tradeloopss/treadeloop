ALTER TABLE "affiliate_payout_transactions" ADD COLUMN "signedTx" text;--> statement-breakpoint
ALTER TABLE "affiliate_payout_transactions" ADD COLUMN "expiresAt" timestamp;
