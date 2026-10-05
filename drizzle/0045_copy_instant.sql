-- Copy Trading: copying on the sync server itself, the instant a leader trades.
-- The app writes each leader a plan the copy lane can act on alone; every
-- order carries a reference that is unique here, so the lane and the app's
-- engine can never both send the same one; and the lane records what it
-- decided and how long each part took.
ALTER TABLE "metatrader_connections" ADD COLUMN IF NOT EXISTS "copyPlan" jsonb;
--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN IF NOT EXISTS "copyPingMs" integer;
--> statement-breakpoint
ALTER TABLE "order_commands" ADD COLUMN IF NOT EXISTS "clientRef" text;
--> statement-breakpoint
ALTER TABLE "order_commands" ADD COLUMN IF NOT EXISTS "lane" jsonb;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_commands_client_ref" ON "order_commands" ("clientRef") WHERE "clientRef" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "copy_orders" ADD COLUMN IF NOT EXISTS "tradeloopMs" integer;
