-- Whether the password an account takes orders with has been put to its
-- broker, and what the broker said (lib/order-execution/trading-check.ts):
-- pending -> checking -> ok | read_only | rejected. The sync server asks once
-- when the password is saved (worker/mt5: /check), and a real order's outcome
-- writes it too. Before this a password was taken on trust, and its trader
-- found out at the first trade that was not copied.
ALTER TABLE "metatrader_connections" ADD COLUMN IF NOT EXISTS "tradingCheck" text;
--> statement-breakpoint
ALTER TABLE "metatrader_connections" ADD COLUMN IF NOT EXISTS "tradingCheckAt" timestamp;
--> statement-breakpoint
-- The passwords saved before now have never been asked about: asked now.
UPDATE "metatrader_connections" SET "tradingCheck" = 'pending' WHERE "tradingPasswordEnc" IS NOT NULL AND "tradingCheck" IS NULL AND "platform" = 'mt5';
