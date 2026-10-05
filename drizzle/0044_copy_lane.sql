-- Copy Trading's fast lane. The app marks the accounts of groups that are
-- switched on; the copy lane on the sync server gives each a terminal of its
-- own and says so here, with when it last read the account.
ALTER TABLE "metatrader_connections" ADD COLUMN IF NOT EXISTS "copyRole" text;
--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN IF NOT EXISTS "copySlot" text;
--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN IF NOT EXISTS "copySeenAt" timestamp;
