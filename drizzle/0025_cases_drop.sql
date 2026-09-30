-- Cases Drop: a limited promotional "free case" system. A drop has a fixed
-- number of cases (reward slots, pre-shuffled); a user claims one case per drop
-- and gets that slot's reward as a unique, individually-expiring prize code.
-- App-owned (no VPS sync role), so no RLS grants.

CREATE TABLE "drops" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"totalCases" integer NOT NULL,
	"claimedCases" integer DEFAULT 0 NOT NULL,
	"startAt" timestamp,
	"endAt" timestamp,
	"prizeExpirationDays" integer DEFAULT 14 NOT NULL,
	"createdBy" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "drops_status" ON "drops" USING btree ("status");--> statement-breakpoint

CREATE TABLE "drop_rewards" (
	"id" serial PRIMARY KEY NOT NULL,
	"dropId" integer NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"discountPercent" integer,
	"subscriptionPlan" text,
	"subscriptionMonths" integer,
	"quantity" integer NOT NULL,
	"probability" integer DEFAULT 0 NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "drop_rewards_drop" ON "drop_rewards" USING btree ("dropId");--> statement-breakpoint

CREATE TABLE "drop_reward_slots" (
	"id" serial PRIMARY KEY NOT NULL,
	"dropId" integer NOT NULL,
	"rewardId" integer NOT NULL,
	"slotIndex" integer NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"claimedBy" text,
	"claimedAt" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "drop_reward_slots_drop_index" ON "drop_reward_slots" USING btree ("dropId","slotIndex");--> statement-breakpoint
CREATE INDEX "drop_reward_slots_pick" ON "drop_reward_slots" USING btree ("dropId","status");--> statement-breakpoint

CREATE TABLE "drop_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"dropId" integer NOT NULL,
	"userId" text NOT NULL,
	"rewardId" integer NOT NULL,
	"rewardSlotId" integer NOT NULL,
	"prizeCode" text NOT NULL,
	"claimedAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"redeemedAt" timestamp,
	"status" text DEFAULT 'active' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "drop_claims_drop_user" ON "drop_claims" USING btree ("dropId","userId");--> statement-breakpoint
CREATE UNIQUE INDEX "drop_claims_code" ON "drop_claims" USING btree ("prizeCode");--> statement-breakpoint
CREATE INDEX "drop_claims_user" ON "drop_claims" USING btree ("userId");--> statement-breakpoint

-- Seed the live launch drop: 40 cases = 2× Free Essential, 20× 45% OFF,
-- 14× 55% OFF, 4× 70% OFF, slots shuffled with random(). Idempotent: only
-- seeds when no drop exists yet, so re-running (or a manual create first) is
-- safe.
WITH seed AS (
	SELECT NOT EXISTS (SELECT 1 FROM "drops") AS go
), d AS (
	INSERT INTO "drops" ("name","description","status","totalCases","claimedCases","startAt","prizeExpirationDays","createdBy")
	SELECT 'TradeLoop Launch Case Drop', 'One case. Big rewards. Claim your free TradeLoop case and discover your reward.', 'active', 40, 0, now(), 14, 'system'
	FROM seed WHERE seed.go
	RETURNING id
), r AS (
	INSERT INTO "drop_rewards" ("dropId","name","type","discountPercent","subscriptionPlan","subscriptionMonths","quantity","probability","sortOrder")
	SELECT d.id, x.name, x.type, x.discount, x.plan, x.months, x.qty, x.prob, x.ord
	FROM d CROSS JOIN (VALUES
		('1 Month Free TradeLoop Essential','free_subscription',NULL::integer,'essential'::text,1,2,5,0),
		('45% OFF','discount',45,NULL::text,NULL::integer,20,50,1),
		('55% OFF','discount',55,NULL::text,NULL::integer,14,35,2),
		('70% OFF','discount',70,NULL::text,NULL::integer,4,10,3)
	) AS x(name,type,discount,plan,months,qty,prob,ord)
	RETURNING id, "dropId", quantity
), expanded AS (
	SELECT r."dropId", r.id AS reward_id, generate_series(1, r.quantity) AS n FROM r
), shuffled AS (
	SELECT "dropId", reward_id, row_number() OVER (ORDER BY random()) AS slot_index FROM expanded
)
INSERT INTO "drop_reward_slots" ("dropId","rewardId","slotIndex","status")
SELECT "dropId", reward_id, slot_index, 'available' FROM shuffled;
