-- Edge Lab and Psychology (beta). Nothing here copies a trade: every table
-- hangs off the existing "trades" row by its id, or holds something the trader
-- saved (a hypothesis, a monitored edge, a rule, a check-in).

-- What a trader said about one trade: before it (the pre-trade check-in) and
-- after it (the post-trade review). One row per trade.
CREATE TABLE IF NOT EXISTS "trade_psychology" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "tradeId" integer NOT NULL,
  "emotionBefore" text,
  "confidenceBefore" integer,
  "focusBefore" integer,
  "stressBefore" integer,
  "reason" text,
  "planBefore" boolean,
  "emotionAfter" text,
  "planFollowed" boolean,
  "interference" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "notes" text,
  "checkinId" integer,
  "reviewedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trade_psychology_trade" ON "trade_psychology" USING btree ("tradeId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_psychology_user" ON "trade_psychology" USING btree ("userId");--> statement-breakpoint

-- A check-in: before a trade (linked to the trade once it exists), or the
-- day's morning / evening one.
CREATE TABLE IF NOT EXISTS "psych_checkins" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "kind" text NOT NULL,
  "day" text NOT NULL,
  "emotion" text,
  "confidence" integer,
  "focus" integer,
  "stress" integer,
  "reason" text,
  "planFollowing" boolean,
  "answers" jsonb,
  "tradeId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "psych_checkins_user" ON "psych_checkins" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "psych_checkins_day" ON "psych_checkins" USING btree ("userId","kind","day");--> statement-breakpoint

-- An idea a trader wants tested ("EURUSD does better in London, long").
CREATE TABLE IF NOT EXISTS "edge_hypotheses" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "name" text NOT NULL,
  "statement" text,
  "conditions" jsonb NOT NULL,
  "result" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edge_hypotheses_user" ON "edge_hypotheses" USING btree ("userId","updatedAt");--> statement-breakpoint

-- An edge the trader is watching: its conditions, and how it looked when saved.
CREATE TABLE IF NOT EXISTS "edge_monitors" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "name" text NOT NULL,
  "conditions" jsonb NOT NULL,
  "baseline" jsonb,
  "playbookId" integer,
  "notifyInApp" boolean DEFAULT true NOT NULL,
  "notifyEmail" boolean DEFAULT false NOT NULL,
  "lastStatus" text,
  "lastCheckedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edge_monitors_user" ON "edge_monitors" USING btree ("userId","createdAt");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "edge_alerts" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "monitorId" integer,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "href" text,
  "dedupeKey" text NOT NULL,
  "readAt" timestamp,
  "emailedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "edge_alerts_dedupe" ON "edge_alerts" USING btree ("dedupeKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "edge_alerts_user" ON "edge_alerts" USING btree ("userId","createdAt");--> statement-breakpoint

-- A rule a trader set for themselves, from a leak or a behaviour pattern.
CREATE TABLE IF NOT EXISTS "trading_rules" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "text" text NOT NULL,
  "source" text DEFAULT 'manual' NOT NULL,
  "conditions" jsonb,
  "active" boolean DEFAULT true NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trading_rules_user" ON "trading_rules" USING btree ("userId","createdAt");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "psych_challenges" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "key" text NOT NULL,
  "days" integer DEFAULT 7 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "startedAt" timestamp DEFAULT now() NOT NULL,
  "endedAt" timestamp
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "psych_challenges_user" ON "psych_challenges" USING btree ("userId","startedAt");--> statement-breakpoint

-- Results of the heavier analyses, kept until the trader's trades change
-- ("fingerprint"), so a page load doesn't redo them.
CREATE TABLE IF NOT EXISTS "analytics_cache" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "key" text NOT NULL,
  "fingerprint" text NOT NULL,
  "payload" jsonb NOT NULL,
  "computedAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_cache_key" ON "analytics_cache" USING btree ("userId","key");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "feature_feedback" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "feature" text NOT NULL,
  "rating" text,
  "message" text,
  "page" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feature_feedback_created" ON "feature_feedback" USING btree ("createdAt");--> statement-breakpoint

-- What the market was doing on a day, per instrument, worked out from daily
-- price history. Shared by every trader of that instrument.
CREATE TABLE IF NOT EXISTS "market_regimes" (
  "id" serial PRIMARY KEY NOT NULL,
  "symbol" text NOT NULL,
  "day" text NOT NULL,
  "trend" text NOT NULL,
  "volatility" text NOT NULL,
  "range" text NOT NULL,
  "computedAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_regimes_symbol_day" ON "market_regimes" USING btree ("symbol","day");--> statement-breakpoint

-- How far a trade went for and against the trader while it was open, measured
-- from price history. One row per trade; "status" says why there is no figure.
CREATE TABLE IF NOT EXISTS "trade_excursions" (
  "tradeId" integer PRIMARY KEY NOT NULL,
  "userId" text NOT NULL,
  "mae" numeric,
  "mfe" numeric,
  "maeR" numeric,
  "mfeR" numeric,
  "timeframe" text,
  "status" text DEFAULT 'ok' NOT NULL,
  "computedAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_excursions_user" ON "trade_excursions" USING btree ("userId");--> statement-breakpoint

ALTER TABLE "trade_psychology" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "psych_checkins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "edge_hypotheses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "edge_monitors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "edge_alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trading_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "psych_challenges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analytics_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "feature_feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "market_regimes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trade_excursions" ENABLE ROW LEVEL SECURITY;
