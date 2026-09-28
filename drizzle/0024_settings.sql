-- Settings section backend: the public profile + preference groups a user
-- edits under /settings, plus saved CSV import schemas and reusable trade
-- templates. All app-owned (no VPS sync role touches them), so no RLS grants.

CREATE TABLE "user_settings" (
	"userId" text PRIMARY KEY NOT NULL,
	"username" text,
	"bio" text,
	"tradingStrategy" text,
	"yearsTrading" integer,
	"social" jsonb,
	"privacy" jsonb,
	"theme" jsonb,
	"calculations" jsonb,
	"orderGrouping" jsonb,
	"notifications" jsonb,
	"preferences" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "csv_schemas" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"broker" text,
	"mapping" jsonb NOT NULL,
	"delimiter" text DEFAULT ',' NOT NULL,
	"dateFormat" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "csv_schemas_user" ON "csv_schemas" USING btree ("userId");--> statement-breakpoint

CREATE TABLE "trade_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text,
	"side" text,
	"quantity" numeric,
	"fields" jsonb,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "trade_templates_user" ON "trade_templates" USING btree ("userId");
