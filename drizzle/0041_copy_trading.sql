-- Copy Trading. A copy group has one leader account and one or more follower
-- accounts; every table here hangs off the existing "trading_accounts" row by
-- its id. No broker credential is stored here: orders to a follower go through
-- the existing order queue ("order_commands"), with its own rule guard.

CREATE TABLE IF NOT EXISTS "copy_groups" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "name" text NOT NULL,
  "leaderAccountId" integer NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_groups_user" ON "copy_groups" ("userId", "createdAt");
--> statement-breakpoint
ALTER TABLE "copy_groups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A follower of a group: how much it copies, and the limits it copies within.
CREATE TABLE IF NOT EXISTS "copy_group_followers" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "groupId" integer NOT NULL,
  "accountId" integer NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "sizingMode" text DEFAULT 'same' NOT NULL,
  "percentage" numeric(12, 4),
  "multiplier" numeric(12, 4),
  "fixedQuantity" numeric(18, 4),
  "riskPercentage" numeric(8, 4),
  "customFactor" numeric(12, 4),
  "minQuantity" numeric(18, 4),
  "maxPositionSize" numeric(18, 4),
  "maxDailyLoss" numeric(18, 2),
  "maxExposure" numeric(8, 4),
  "roundingRule" text DEFAULT 'nearest' NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "copy_group_followers_unique" ON "copy_group_followers" ("groupId", "accountId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_group_followers_user" ON "copy_group_followers" ("userId");
--> statement-breakpoint
ALTER TABLE "copy_group_followers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A contract a group copies, with the specification it was imported with.
CREATE TABLE IF NOT EXISTS "copy_group_contracts" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "groupId" integer NOT NULL,
  "symbol" text NOT NULL,
  "root" text NOT NULL,
  "name" text NOT NULL,
  "exchange" text,
  "type" text NOT NULL,
  "expiration" text,
  "tickSize" numeric(18, 8) NOT NULL,
  "tickValue" numeric(18, 6),
  "pointValue" numeric(18, 6),
  "contractMultiplier" numeric(18, 6) NOT NULL,
  "minimumQuantity" numeric(18, 4) NOT NULL,
  "quantityStep" numeric(18, 4) NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "copy_group_contracts_unique" ON "copy_group_contracts" ("groupId", "symbol");
--> statement-breakpoint
ALTER TABLE "copy_group_contracts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- What a group copies (one row per group): order types, and when.
CREATE TABLE IF NOT EXISTS "copy_rules" (
  "groupId" integer PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "marketOrders" boolean DEFAULT true NOT NULL,
  "limitOrders" boolean DEFAULT true NOT NULL,
  "stopOrders" boolean DEFAULT true NOT NULL,
  "stopLoss" boolean DEFAULT true NOT NULL,
  "takeProfit" boolean DEFAULT true NOT NULL,
  "modifications" boolean DEFAULT true NOT NULL,
  "partialClose" boolean DEFAULT true NOT NULL,
  "fullClose" boolean DEFAULT true NOT NULL,
  "cancel" boolean DEFAULT true NOT NULL,
  "trailingStop" boolean DEFAULT true NOT NULL,
  "direction" text DEFAULT 'both' NOT NULL,
  "symbolScope" text DEFAULT 'selected' NOT NULL,
  "hoursFrom" text,
  "hoursTo" text,
  "days" jsonb DEFAULT '[1,2,3,4,5]'::jsonb NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copy_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- The group's own defaults for risk (one row per group).
CREATE TABLE IF NOT EXISTS "copy_risk_limits" (
  "groupId" integer PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "defaultMode" text DEFAULT 'same' NOT NULL,
  "defaultRatio" numeric(12, 4) DEFAULT '1' NOT NULL,
  "globalRiskPct" numeric(8, 4) DEFAULT '1' NOT NULL,
  "respectPropSync" boolean DEFAULT true NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copy_risk_limits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A follower trading the leader's symbol under another name (NQ -> MNQ).
CREATE TABLE IF NOT EXISTS "copy_symbol_mappings" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "followerId" integer NOT NULL,
  "leaderSymbol" text NOT NULL,
  "followerSymbol" text NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "copy_symbol_mappings_unique" ON "copy_symbol_mappings" ("followerId", "leaderSymbol");
--> statement-breakpoint
ALTER TABLE "copy_symbol_mappings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- What an account is used for in Copy Trading, and its last connection test.
CREATE TABLE IF NOT EXISTS "copy_account_prefs" (
  "accountId" integer PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "role" text DEFAULT 'unassigned' NOT NULL,
  "lastLatencyMs" integer,
  "lastHeartbeatAt" timestamp,
  "lastTestStatus" text,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_account_prefs_user" ON "copy_account_prefs" ("userId");
--> statement-breakpoint
ALTER TABLE "copy_account_prefs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- A position the engine is managing: the leader's, and each follower's copy of it.
CREATE TABLE IF NOT EXISTS "copy_positions" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "groupId" integer NOT NULL,
  "accountId" integer NOT NULL,
  "role" text NOT NULL,
  "symbol" text NOT NULL,
  "side" text NOT NULL,
  "quantity" numeric(18, 4) NOT NULL,
  "entryPrice" numeric(18, 8),
  "stopLoss" numeric(18, 8),
  "takeProfit" numeric(18, 8),
  "positionRef" text,
  "leaderPositionId" integer,
  "correlationId" text,
  "version" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "simulated" boolean DEFAULT true NOT NULL,
  "realizedPnl" numeric(18, 2),
  "openedAt" timestamp DEFAULT now() NOT NULL,
  "closedAt" timestamp,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_positions_group" ON "copy_positions" ("groupId", "status");
--> statement-breakpoint
-- One open row per position of the leader: two engine runs at the same moment
-- cannot both start copying the same position.
CREATE UNIQUE INDEX IF NOT EXISTS "copy_positions_leader_open" ON "copy_positions" ("groupId", "positionRef") WHERE "role" = 'leader' AND "status" = 'open';
--> statement-breakpoint
ALTER TABLE "copy_positions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- One order to one follower, made from one leader event. "correlationId" is
-- unique: the same leader event can never produce a second order for the same
-- follower, whatever is retried.
CREATE TABLE IF NOT EXISTS "copy_orders" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "groupId" integer NOT NULL,
  "correlationId" text NOT NULL,
  "masterOrderId" text NOT NULL,
  "masterAccountId" integer NOT NULL,
  "followerAccountId" integer NOT NULL,
  "action" text NOT NULL,
  "symbol" text NOT NULL,
  "leaderSymbol" text NOT NULL,
  "side" text NOT NULL,
  "quantity" numeric(18, 4) NOT NULL,
  "leaderQuantity" numeric(18, 4),
  "requestedPrice" numeric(18, 8),
  "executionPrice" numeric(18, 8),
  "stopLoss" numeric(18, 8),
  "takeProfit" numeric(18, 8),
  "status" text DEFAULT 'pending' NOT NULL,
  "reason" text,
  "decision" jsonb,
  "slippage" numeric(18, 8),
  "latencyMs" integer,
  "simulated" boolean DEFAULT true NOT NULL,
  "orderCommandId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "copy_orders_correlation" ON "copy_orders" ("correlationId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_orders_group" ON "copy_orders" ("groupId", "createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_orders_user" ON "copy_orders" ("userId", "createdAt");
--> statement-breakpoint
ALTER TABLE "copy_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- The activity log, errors included: what happened, why, and what to do.
CREATE TABLE IF NOT EXISTS "copy_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "groupId" integer,
  "accountId" integer,
  "level" text DEFAULT 'info' NOT NULL,
  "code" text NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "action" text,
  "masterOrderId" text,
  "data" jsonb,
  "readAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_events_user" ON "copy_events" ("userId", "createdAt");
--> statement-breakpoint
ALTER TABLE "copy_events" ENABLE ROW LEVEL SECURITY;
