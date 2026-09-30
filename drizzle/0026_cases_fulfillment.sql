-- Cases Drop fulfillment: when a prize is claimed, a discount reward creates a
-- real promo code in billing and a free-subscription reward grants the plan
-- immediately. Track the outcome on the claim so admins can see (and retry)
-- what was provisioned.

ALTER TABLE "drop_claims" ADD COLUMN "fulfillmentStatus" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "drop_claims" ADD COLUMN "fulfillmentRef" text;
