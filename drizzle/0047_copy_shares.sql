-- Sharing a strategy with friends (lib/copy/shares.ts): a trader lets the
-- people they invite copy one of their Leader accounts onto accounts of their
-- own. Broker accounts only, on both sides: a prop-firm account is never
-- shared and never follows one (lib/compliance/kind.ts).
--
-- copy_shares: one per shared account. The link carries the token; "revoked"
-- ends it for everyone. copy_share_members: who accepted. A friend never gets
-- anything of the owner's but the trades themselves: no credential, no balance.
CREATE TABLE IF NOT EXISTS "copy_shares" (
	"id" serial PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"accountId" integer NOT NULL,
	"name" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"maxFriends" integer DEFAULT 10 NOT NULL,
	"attestedAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "copy_shares_token" ON "copy_shares" ("token");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "copy_shares_account" ON "copy_shares" ("accountId") WHERE "status" <> 'revoked';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_shares_owner" ON "copy_shares" ("ownerId");
--> statement-breakpoint
ALTER TABLE "copy_shares" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "copy_share_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"shareId" integer NOT NULL,
	"userId" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joinedAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "copy_share_members_unique" ON "copy_share_members" ("shareId","userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "copy_share_members_user" ON "copy_share_members" ("userId");
--> statement-breakpoint
ALTER TABLE "copy_share_members" ENABLE ROW LEVEL SECURITY;
