-- PNL Cards (lib/pnl-cards): a trader's results as a card to share. One row is
-- one card: its figures as they stood when it was made (data), the layout, what
-- is switched on to be seen, and whether anyone but its owner may open it.
-- The link is the token and nothing else. Private until its owner shares it.
CREATE TABLE IF NOT EXISTS "pnl_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"token" text NOT NULL,
	"layout" text DEFAULT 'desktop' NOT NULL,
	"visibility" jsonb NOT NULL,
	"privacy" text DEFAULT 'private' NOT NULL,
	"scope" jsonb NOT NULL,
	"data" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pnl_cards_token" ON "pnl_cards" USING btree ("token");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pnl_cards_user" ON "pnl_cards" USING btree ("userId","createdAt");
--> statement-breakpoint
ALTER TABLE "pnl_cards" ENABLE ROW LEVEL SECURITY;
