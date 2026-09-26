-- One free trial per IP (in addition to the existing per-account/email check
-- in lib/subscription.hasUsedTrial). A hashed IP (HMAC, never the raw address)
-- is stored on the subscription row when a trial is granted, so a later signup
-- from the same IP is offered no trial. See lib/trial-ip.ts.
ALTER TABLE "subscriptions" ADD COLUMN "trialIpHash" text;--> statement-breakpoint
CREATE INDEX "subscriptions_trial_ip" ON "subscriptions" USING btree ("trialIpHash");
