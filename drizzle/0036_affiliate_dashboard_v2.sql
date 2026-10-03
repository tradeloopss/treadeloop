-- Affiliate Dashboard V2 (beta). Each affiliate's choice of dashboard
-- (null = the program default), whether they appear on the public leaderboard
-- (off unless they opt in), and the feedback the beta collects.
ALTER TABLE "affiliates" ADD COLUMN IF NOT EXISTS "dashboardVersion" text;--> statement-breakpoint
ALTER TABLE "affiliates" ADD COLUMN IF NOT EXISTS "leaderboardPublic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "affiliate_feedback" (
  "id" serial PRIMARY KEY NOT NULL,
  "affiliateId" integer NOT NULL,
  "rating" text NOT NULL,
  "message" text,
  "page" text,
  "version" text DEFAULT 'v2' NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "affiliate_feedback_created" ON "affiliate_feedback" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "affiliate_feedback_affiliate" ON "affiliate_feedback" USING btree ("affiliateId","createdAt");--> statement-breakpoint
-- Same boundary as every affiliate table: row-level security on, no policy for
-- the sync server's role.
ALTER TABLE "affiliate_feedback" ENABLE ROW LEVEL SECURITY;
