-- Verification codes for the two things on an affiliate account that move
-- money: confirming a payout, and adding a payout method. One row per code
-- asked for. An emailed code is kept only as a keyed hash; an authenticator
-- code isn't kept at all (the row then only counts the wrong tries).
CREATE TABLE IF NOT EXISTS "affiliate_action_codes" (
  "id" serial PRIMARY KEY NOT NULL,
  "affiliateId" integer NOT NULL,
  "purpose" text NOT NULL,
  "channel" text NOT NULL,
  "subject" text DEFAULT '' NOT NULL,
  "codeHash" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "usedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "affiliate_action_codes_affiliate" ON "affiliate_action_codes" USING btree ("affiliateId","purpose","createdAt");--> statement-breakpoint
-- Same boundary as every affiliate table: row-level security on, no policy for
-- the sync server's role.
ALTER TABLE "affiliate_action_codes" ENABLE ROW LEVEL SECURITY;
