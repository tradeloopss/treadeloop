-- Tiers that pay on a schedule and unlock perks.
--   ratePercent / introMonths / afterPercent   "30% for 9 months -> 15% lifetime"
--   perks     what reaching the tier unlocks: coupon, beta, freeAccount, prioritySupport
--   tagline   one line shown on the tier's card
--   style     the card's look: plain | bronze | silver | gold | diamond
ALTER TABLE "affiliate_tiers" ADD COLUMN "introMonths" integer;--> statement-breakpoint
ALTER TABLE "affiliate_tiers" ADD COLUMN "afterPercent" numeric;--> statement-breakpoint
ALTER TABLE "affiliate_tiers" ADD COLUMN "perks" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "affiliate_tiers" ADD COLUMN "tagline" text;--> statement-breakpoint
ALTER TABLE "affiliate_tiers" ADD COLUMN "style" text DEFAULT 'plain' NOT NULL;--> statement-breakpoint

-- When the "free account, for good" perk was given to an affiliate (once).
ALTER TABLE "affiliates" ADD COLUMN "freeAccountAt" timestamp;--> statement-breakpoint

-- Tickets answered first, and what a ticket is: support | feature_request.
ALTER TABLE "support_tickets" ADD COLUMN "priority" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "kind" text DEFAULT 'support' NOT NULL;--> statement-breakpoint

-- The old tiers (Starter, Growth, Pro, Elite) are replaced. A tier set by hand
-- on an affiliate pointed at one of them, so those go back to following the
-- affiliate's paying customers. Commissions already recorded keep their rate.
UPDATE "affiliates" SET "tierId" = NULL, "updatedAt" = now() WHERE "tierId" IS NOT NULL;--> statement-breakpoint
DELETE FROM "affiliate_tiers";--> statement-breakpoint

INSERT INTO "affiliate_tiers" ("name", "minCustomers", "ratePercent", "introMonths", "afterPercent", "perks", "tagline", "style", "sortOrder") VALUES
	('Bronze', 1, 20, NULL, NULL, '{}'::jsonb, 'Start your journey. Earn from your first referral!', 'bronze', 1),
	('Silver', 11, 30, 9, 15, '{"coupon": true}'::jsonb, NULL, 'silver', 11),
	('Gold', 100, 35, 12, 15, '{"coupon": true, "beta": true, "freeAccount": true, "prioritySupport": true}'::jsonb, NULL, 'gold', 100),
	('Diamond', 300, 40, 12, 20, '{"coupon": true, "beta": true, "freeAccount": true, "prioritySupport": true}'::jsonb, NULL, 'diamond', 300);
