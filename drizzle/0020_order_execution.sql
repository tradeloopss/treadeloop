-- Order execution: the one write path from TradeLoop to a broker. The app
-- writes a rule-checked command; a per-broker executor (the MT5 worker, the
-- Rithmic order plant) picks it up and records the result. Nothing runs unless
-- an account has execution enabled via a stored trading credential. See
-- lib/order-execution.

-- The master/trading password on an MT connection (investor password can't
-- trade). Null keeps the account read-only.
ALTER TABLE "metatrader_connections" ADD COLUMN "tradingPasswordEnc" text;--> statement-breakpoint

CREATE TABLE "order_commands" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"accountId" integer NOT NULL,
	"broker" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"positionRef" text,
	"orderRef" text,
	"symbol" text,
	"side" text,
	"volume" numeric(18, 4),
	"price" numeric(18, 6),
	"stopLoss" numeric(18, 6),
	"takeProfit" numeric(18, 6),
	"orderType" text,
	"ruleCheck" jsonb,
	"brokerRef" text,
	"resultMessage" text,
	"brokerResult" jsonb,
	"leaseUntil" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "order_commands_user" ON "order_commands" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "order_commands_due" ON "order_commands" USING btree ("broker","status","leaseUntil");--> statement-breakpoint
CREATE INDEX "order_commands_account" ON "order_commands" USING btree ("accountId");--> statement-breakpoint

-- RLS on. The VPS worker (tradeloop_sync) executes commands: it reads pending
-- ones and its account's trading credential, and writes back the result.
ALTER TABLE "order_commands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tradeloop_sync') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "order_commands" TO tradeloop_sync;
    GRANT USAGE, SELECT ON SEQUENCE "order_commands_id_seq" TO tradeloop_sync;
    CREATE POLICY tradeloop_sync_all ON "order_commands" FOR ALL TO tradeloop_sync USING (true) WITH CHECK (true);
  END IF;
END $$;
