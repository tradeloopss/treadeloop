-- Affiliate / partner program: applications, links, campaigns, click and
-- referral attribution, the commission ledger, coupons, payouts, fraud
-- signals, notifications, resources and announcements. App-owned tables (no
-- VPS sync role touches them), so no RLS grants.

CREATE TABLE "affiliates" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"tierId" integer,
	"firstName" text NOT NULL,
	"lastName" text NOT NULL,
	"email" text NOT NULL,
	"country" text,
	"website" text,
	"socials" jsonb,
	"audienceSize" text,
	"trafficSource" text,
	"promotionMethod" text,
	"reason" text,
	"payoutHold" boolean DEFAULT false NOT NULL,
	"fraudLock" boolean DEFAULT false NOT NULL,
	"payoutCurrency" text DEFAULT 'usd' NOT NULL,
	"notifications" jsonb,
	"rejectionReason" text,
	"reviewedBy" text,
	"approvedAt" timestamp,
	"onboardedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "affiliates_user" ON "affiliates" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliates_code" ON "affiliates" USING btree ("code");--> statement-breakpoint
CREATE INDEX "affiliates_status" ON "affiliates" USING btree ("status");--> statement-breakpoint

CREATE TABLE "affiliate_tiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"minCustomers" integer DEFAULT 0 NOT NULL,
	"ratePercent" numeric NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "affiliate_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"affiliateId" integer NOT NULL,
	"campaignId" integer,
	"couponId" integer,
	"ratePercent" numeric NOT NULL,
	"durationMonths" integer,
	"startsAt" timestamp,
	"endsAt" timestamp,
	"enabled" boolean DEFAULT true NOT NULL,
	"note" text,
	"createdBy" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "affiliate_rules_affiliate" ON "affiliate_rules" USING btree ("affiliateId");--> statement-breakpoint

CREATE TABLE "affiliate_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"affiliateId" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"landingPage" text DEFAULT '/' NOT NULL,
	"utmSource" text,
	"utmMedium" text,
	"utmCampaign" text,
	"utmContent" text,
	"status" text DEFAULT 'active' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "affiliate_campaigns_affiliate" ON "affiliate_campaigns" USING btree ("affiliateId");--> statement-breakpoint

CREATE TABLE "affiliate_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"affiliateId" integer NOT NULL,
	"campaignId" integer,
	"token" text NOT NULL,
	"landingPage" text DEFAULT '/' NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_links_token" ON "affiliate_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "affiliate_links_affiliate" ON "affiliate_links" USING btree ("affiliateId");--> statement-breakpoint

CREATE TABLE "affiliate_clicks" (
	"id" serial PRIMARY KEY NOT NULL,
	"affiliateId" integer NOT NULL,
	"campaignId" integer,
	"linkId" integer,
	"visitorId" text NOT NULL,
	"ipHash" text,
	"landingPage" text,
	"referrer" text,
	"utmSource" text,
	"utmMedium" text,
	"utmCampaign" text,
	"utmContent" text,
	"device" text,
	"country" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "affiliate_clicks_affiliate_time" ON "affiliate_clicks" USING btree ("affiliateId","createdAt");--> statement-breakpoint
CREATE INDEX "affiliate_clicks_visitor" ON "affiliate_clicks" USING btree ("visitorId","affiliateId");--> statement-breakpoint

CREATE TABLE "affiliate_referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"publicId" text NOT NULL,
	"affiliateId" integer NOT NULL,
	"userId" text NOT NULL,
	"campaignId" integer,
	"linkId" integer,
	"couponId" integer,
	"clickId" integer,
	"source" text DEFAULT 'link' NOT NULL,
	"status" text DEFAULT 'signup' NOT NULL,
	"plan" text,
	"billing" text,
	"country" text,
	"device" text,
	"landingPage" text,
	"revenue" numeric DEFAULT '0' NOT NULL,
	"clickedAt" timestamp,
	"firstPaymentAt" timestamp,
	"lastPaymentAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_referrals_user" ON "affiliate_referrals" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_referrals_public" ON "affiliate_referrals" USING btree ("publicId");--> statement-breakpoint
CREATE INDEX "affiliate_referrals_affiliate" ON "affiliate_referrals" USING btree ("affiliateId","createdAt");--> statement-breakpoint

CREATE TABLE "affiliate_conversions" (
	"id" serial PRIMARY KEY NOT NULL,
	"referralId" integer NOT NULL,
	"affiliateId" integer NOT NULL,
	"type" text NOT NULL,
	"amount" numeric,
	"paymentId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "affiliate_conversions_referral" ON "affiliate_conversions" USING btree ("referralId");--> statement-breakpoint
CREATE INDEX "affiliate_conversions_affiliate_time" ON "affiliate_conversions" USING btree ("affiliateId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_conversions_payment" ON "affiliate_conversions" USING btree ("type","paymentId");--> statement-breakpoint

CREATE TABLE "affiliate_commissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"affiliateId" integer NOT NULL,
	"referralId" integer,
	"type" text NOT NULL,
	"amount" numeric NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"status" text NOT NULL,
	"baseAmount" numeric,
	"ratePercent" numeric,
	"ruleSource" text,
	"paymentId" text,
	"idempotencyKey" text NOT NULL,
	"holdUntil" timestamp,
	"approvedAt" timestamp,
	"availableAt" timestamp,
	"paidAt" timestamp,
	"payoutId" integer,
	"reversesId" integer,
	"note" text,
	"createdBy" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_commissions_idem" ON "affiliate_commissions" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE INDEX "affiliate_commissions_affiliate" ON "affiliate_commissions" USING btree ("affiliateId","createdAt");--> statement-breakpoint
CREATE INDEX "affiliate_commissions_status" ON "affiliate_commissions" USING btree ("status","holdUntil");--> statement-breakpoint
CREATE INDEX "affiliate_commissions_payment" ON "affiliate_commissions" USING btree ("paymentId");--> statement-breakpoint

CREATE TABLE "affiliate_coupons" (
	"id" serial PRIMARY KEY NOT NULL,
	"affiliateId" integer NOT NULL,
	"campaignId" integer,
	"code" text NOT NULL,
	"discountType" text DEFAULT 'percent' NOT NULL,
	"discountValue" numeric NOT NULL,
	"durationMonths" integer DEFAULT 1 NOT NULL,
	"plan" text,
	"expiresAt" timestamp,
	"usageLimit" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"whopPromoId" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_coupons_code" ON "affiliate_coupons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "affiliate_coupons_affiliate" ON "affiliate_coupons" USING btree ("affiliateId");--> statement-breakpoint

CREATE TABLE "affiliate_payout_methods" (
	"id" serial PRIMARY KEY NOT NULL,
	"affiliateId" integer NOT NULL,
	"type" text NOT NULL,
	"label" text NOT NULL,
	"details" text NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "affiliate_payout_methods_affiliate" ON "affiliate_payout_methods" USING btree ("affiliateId");--> statement-breakpoint

CREATE TABLE "affiliate_payouts" (
	"id" serial PRIMARY KEY NOT NULL,
	"affiliateId" integer NOT NULL,
	"amount" numeric NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"methodId" integer,
	"methodType" text NOT NULL,
	"methodLabel" text NOT NULL,
	"provider" text DEFAULT 'manual' NOT NULL,
	"providerRef" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"idempotencyKey" text NOT NULL,
	"failureReason" text,
	"note" text,
	"processedBy" text,
	"requestedAt" timestamp DEFAULT now() NOT NULL,
	"processedAt" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_payouts_idem" ON "affiliate_payouts" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE INDEX "affiliate_payouts_affiliate" ON "affiliate_payouts" USING btree ("affiliateId","requestedAt");--> statement-breakpoint
CREATE INDEX "affiliate_payouts_status" ON "affiliate_payouts" USING btree ("status");--> statement-breakpoint

CREATE TABLE "affiliate_fraud_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"affiliateId" integer NOT NULL,
	"referralId" integer,
	"type" text NOT NULL,
	"risk" text DEFAULT 'low' NOT NULL,
	"details" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"dedupeKey" text NOT NULL,
	"resolvedBy" text,
	"resolvedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_fraud_dedupe" ON "affiliate_fraud_signals" USING btree ("dedupeKey");--> statement-breakpoint
CREATE INDEX "affiliate_fraud_status" ON "affiliate_fraud_signals" USING btree ("status","createdAt");--> statement-breakpoint

CREATE TABLE "affiliate_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"affiliateId" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"readAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "affiliate_notifications_affiliate" ON "affiliate_notifications" USING btree ("affiliateId","createdAt");--> statement-breakpoint

CREATE TABLE "affiliate_resources" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"url" text,
	"previewUrl" text,
	"content" text,
	"published" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdBy" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "affiliate_announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" text DEFAULT 'update' NOT NULL,
	"summary" text,
	"content" text NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"publishedAt" timestamp,
	"createdBy" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "affiliate_announcement_reads" (
	"id" serial PRIMARY KEY NOT NULL,
	"announcementId" integer NOT NULL,
	"affiliateId" integer NOT NULL,
	"readAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "affiliate_announcement_reads_pair" ON "affiliate_announcement_reads" USING btree ("announcementId","affiliateId");--> statement-breakpoint

-- Starting tiers. These are ordinary rows — admins edit, reorder, disable or
-- delete them at /admin/affiliates/rules.
INSERT INTO "affiliate_tiers" ("name","minCustomers","ratePercent","sortOrder") VALUES
	('Starter', 0, 20, 0),
	('Growth', 10, 25, 1),
	('Pro', 50, 30, 2),
	('Elite', 100, 35, 3);
