-- Provider rules: what a broker or prop firm lets a copier do with its accounts
-- (lib/compliance). One row per published version of a provider's rule set; the
-- one in force is the newest, and a provider with no row uses the set built
-- into lib/compliance/rules.ts. Nothing is ever edited in place or deleted:
-- who published which rules, and when, stays readable.
CREATE TABLE IF NOT EXISTS "provider_rule_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"version" integer NOT NULL,
	"ruleSet" jsonb NOT NULL,
	"publishedById" text NOT NULL,
	"publishedByEmail" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "provider_rule_sets_version" ON "provider_rule_sets" ("provider","version");
--> statement-breakpoint
ALTER TABLE "provider_rule_sets" ENABLE ROW LEVEL SECURITY;
